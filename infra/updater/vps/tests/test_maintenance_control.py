import concurrent.futures
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control import create_control_server
from production_gate import ProductionGate
from release import Controller, Refused, Store
from test_release import Adapter, REVISION
from workspace_broker import WorkspaceBroker
from source_policy import automatic_source_compatible


class AdmissionTests(unittest.TestCase):
    def test_only_verified_stopped_or_removed_containers_can_lose_a_lease(self):
        self.gate.policy["project"] = "manor-test-admission"
        self.gate.action("enter", self.lease, "application")
        self.gate.action("close", self.operation, "operator")
        def running(argv, **_kwargs):
            return ("a" * 64 + "\n").encode() if argv[1] == "ps" else json.dumps({"Running": True, "Restarting": False, "Pid": 123}).encode()
        with patch("production_gate.run", side_effect=running):
            self.assertEqual(self.gate.action("status", {}, "operator")["active"], 1)
        with patch("production_gate.run", side_effect=Refused("command_unavailable")):
            with self.assertRaises(Refused):
                self.gate.action("status", {}, "operator")
        with patch("production_gate.run", return_value=b""):
            self.assertEqual(self.gate.action("status", {}, "operator")["active"], 0)
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.policy = {"gateStateDir": self.temp.name}
        self.gate = ProductionGate(self.policy)
        self.operation = {"operation": str(uuid.uuid4())}
        self.lease = {"id": str(uuid.uuid4()), "instance": "a" * 12}

    def test_close_is_durable_and_never_expires_an_active_writer(self):
        self.gate.action("enter", self.lease, "application")
        self.gate.action("close", self.operation, "operator")
        restored = ProductionGate(self.policy)
        self.assertEqual(restored.action("status", {}, "operator"), {"closed": True, "active": 1})
        with self.assertRaisesRegex(Refused, "admission_closed"):
            restored.action("enter", {**self.lease, "id": str(uuid.uuid4())}, "application")
        with self.assertRaisesRegex(Refused, "safe_backup_boundary_required"):
            restored.action("backup", self.operation, "operator")
        restored.action("leave", self.lease, "application")
        restored.action("leave", self.lease, "application")
        self.assertEqual(restored.action("status", {}, "operator")["active"], 0)

    def test_restore_failure_survives_cleanup_failure_and_success_requires_cleanup(self):
        self.gate.policy.update({"databaseContainer": "synthetic-db", "databaseUser": "synthetic",
                                 "databaseName": "synthetic", "postgresImage": "synthetic-image"})
        self.gate.action("close", self.operation, "operator")
        restore = Path(self.temp.name) / "synthetic-restore"
        restore.mkdir()
        def command(argv, **_kwargs):
            if argv[:3] == ["docker", "ps", "-aq"]:
                return b"synthetic-container"
            if argv[:3] == ["docker", "rm", "-f"]:
                raise Refused("synthetic_cleanup_failure")
            return b""
        for restore_failure, expected in ((True, "database_restore_verification_failed"), (False, "backup_cleanup_failed")):
            calls = [None, OSError("synthetic restore failure") if restore_failure else None]
            with patch.object(self.gate, "producer_ids", return_value=[]), patch("production_gate.admission"), \
                    patch("production_gate.quota_directory", return_value=restore), \
                    patch("production_gate.run", side_effect=command), \
                    patch("production_gate.subprocess.run", side_effect=calls):
                with self.assertRaisesRegex(Refused, expected):
                    self.gate.action("backup", self.operation, "operator")
            with self.gate.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM backups").fetchone()[0], 0)

    def test_backup_failure_resumes_only_recorded_producers_without_receipt(self):
        self.gate.policy.update({"databaseContainer": "synthetic-db", "databaseUser": "synthetic", "databaseName": "synthetic"})
        self.gate.action("close", self.operation, "operator")
        container = "b" * 64
        with patch.object(self.gate, "producer_ids", return_value=[container]), \
                patch("production_gate.admission"), patch("production_gate.run", return_value=b"false") as command, \
                patch("production_gate.subprocess.run", side_effect=OSError("synthetic failure")):
            with self.assertRaisesRegex(Refused, "database_backup_failed"):
                self.gate.action("backup", self.operation, "operator")
            self.assertIn((["docker", "pause", container],), [call.args for call in command.call_args_list])
        with self.gate.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM backups").fetchone()[0], 0)
        with patch("production_gate.run", side_effect=[(container + "\n").encode(), b"true", b""]) as command:
            self.gate.action("open", self.operation, "operator")
            self.assertEqual(command.call_args_list[-1].args[0], ["docker", "unpause", container])
        self.assertFalse(self.gate.action("status", {}, "operator")["closed"])

    def test_backup_preserves_a_producer_already_paused_by_the_operator(self):
        self.gate.policy.update({"databaseContainer": "synthetic-db", "databaseUser": "synthetic", "databaseName": "synthetic"})
        self.gate.action("close", self.operation, "operator")
        container = "b" * 64
        with patch.object(self.gate, "producer_ids", return_value=[container]), \
                patch("production_gate.admission"), patch("production_gate.run", return_value=b"true") as command, \
                patch("production_gate.subprocess.run", side_effect=OSError("synthetic failure")):
            with self.assertRaisesRegex(Refused, "database_backup_failed"):
                self.gate.action("backup", self.operation, "operator")
            self.assertEqual(len(command.call_args_list), 1)
        restored = ProductionGate(self.policy)
        with patch("production_gate.run") as command:
            restored.action("open", self.operation, "operator")
            command.assert_not_called()
        self.assertFalse(restored.action("status", {}, "operator")["closed"])

    def test_application_cannot_close_open_backup_or_inspect_admission(self):
        for action in ("close", "open", "status", "backup"):
            with self.assertRaisesRegex(Refused, "operator_required"):
                self.gate.action(action, self.operation, "application")
        with self.assertRaisesRegex(Refused, "unauthorized"):
            self.gate.action("enter", self.lease, "workspace")

    def test_authenticated_health_probe_does_not_open_gate_or_create_writer(self):
        self.gate.action("close", self.operation, "operator")
        self.assertEqual(self.gate.action("probe", {}, "application"), {"ready": True})
        self.assertEqual(self.gate.action("status", {}, "operator"), {"closed": True, "active": 0})
        with self.assertRaisesRegex(Refused, "unauthorized"):
            self.gate.action("probe", {}, "workspace")

    def test_wrong_instance_cannot_finish_another_writer(self):
        self.gate.action("enter", self.lease, "application")
        self.gate.action("leave", {**self.lease, "instance": "b" * 12}, "application")
        self.assertEqual(self.gate.action("status", {}, "operator")["active"], 1)

    def test_close_and_entry_have_one_serialized_boundary(self):
        def enter(_):
            try:
                self.gate.action("enter", {**self.lease, "id": str(uuid.uuid4())}, "application")
                return 1
            except Refused:
                return 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            entries = [pool.submit(enter, i) for i in range(20)]
            self.gate.action("close", self.operation, "operator")
            accepted = sum(item.result() for item in entries)
        self.assertEqual(self.gate.action("status", {}, "operator"), {"closed": True, "active": accepted})

    def test_failed_drain_can_reopen_without_claiming_backup(self):
        self.gate.action("enter", self.lease, "application")
        self.gate.action("close", self.operation, "operator")
        with self.assertRaises(Refused):
            self.gate.action("backup", self.operation, "operator")
        self.assertEqual(self.gate.action("open", self.operation, "operator"), {"closed": False})
        self.assertEqual(self.gate.action("status", {}, "operator")["active"], 1)

    def test_other_operation_cannot_reopen_an_ongoing_release(self):
        self.gate.action("close", self.operation, "operator")
        with self.assertRaisesRegex(Refused, "release_operation_mismatch"):
            self.gate.action("open", {"operation": str(uuid.uuid4())}, "operator")
        with self.assertRaisesRegex(Refused, "another_release_pending"):
            self.gate.action("close", {"operation": str(uuid.uuid4())}, "operator")


class BrokerTests(unittest.TestCase):
    def test_shared_native_schema_and_toolchain_changes_need_separate_release(self):
        self.assertTrue(automatic_source_compatible(["apps/web/src/example.ts", "packages/adapters/src/example.ts"]))
        for name in ("pnpm-workspace.yaml", "tsconfig.base.json", "turbo.json", "vitest.config.ts", ".npmrc", "Dockerfile", "apps/mobile/app/index.tsx", "packages/core/src/example.ts", "packages/contracts/src/example.ts", "packages/brands/src/example.ts",
                     "packages/db/prisma/schema.prisma", "pnpm-lock.yaml", "apps/web/package.json", "infra/updater/vps/release.py"):
            self.assertFalse(automatic_source_compatible(["apps/web/src/example.ts", name]))
        self.assertFalse(automatic_source_compatible([]))
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.policy = {"workspaceStateDir": self.temp.name}
        self.broker = WorkspaceBroker(self.policy)

    def command(self, **fields):
        return {"requestId": str(uuid.uuid4()), "workspaceId": "m" + "a" * 24, "action": "exec", "argv": ["git", "status"], **fields}

    def test_idempotency_and_conflicting_command_rejection(self):
        request = self.command()
        first = self.broker.submit(request)
        self.assertEqual(first, self.broker.submit(request))
        with self.assertRaisesRegex(Refused, "request_id_conflict"):
            self.broker.submit({**request, "argv": ["git", "diff"]})

    def test_restart_records_uncertain_command_without_replaying_it(self):
        request = self.command()
        self.broker.submit(request)
        with self.broker.connect() as db:
            db.execute("UPDATE operations SET state='running'")
        restarted = WorkspaceBroker(self.policy)
        self.assertEqual(restarted.submit(request)["state"], "interrupted")
        with patch.object(restarted, "execute") as execute:
            restarted.process()
            execute.assert_not_called()

    def test_no_host_paths_release_actions_or_unbounded_argv(self):
        for fields in ({"action": "deploy"}, {"workspaceId": "../../production"}, {"repository": "/production"},
                       {"argv": "sh"}, {"argv": []}, {"argv": ["x"] * 101}, {"argv": ["a\x00b"]}):
            with self.assertRaises(Refused):
                self.broker.submit(self.command(**fields))

    def test_broker_queue_is_bounded(self):
        for _ in range(8):
            self.broker.submit(self.command())
        with self.assertRaisesRegex(Refused, "workspace_queue_full"):
            self.broker.submit(self.command())


class ControlAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.controller = Controller(Store(root / "release"), Adapter(), "policy-v1")
        self.broker = WorkspaceBroker({"workspaceStateDir": str(root / "workspace")})
        self.gate = ProductionGate({"gateStateDir": str(root / "gate")})
        self.tokens = {role: role * 40 for role in ("workspace", "developer", "owner", "application", "operator")}
        self.server = create_control_server(("127.0.0.1", 0), self.controller, self.broker, self.gate, self.tokens, unix=False)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:" + str(self.server.server_address[1])

    def call(self, path, role, body=None):
        headers = {"Authorization": "Bearer " + self.tokens.get(role, "invalid"), "Content-Type": "application/json"}
        request = urllib.request.Request(self.base + path, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_workspace_credential_has_no_release_or_admission_authority(self):
        for role in ("workspace", "application"):
            status, _ = self.call("/v1/operations", role, {"action": "recover", "requestId": str(uuid.uuid4())})
            self.assertEqual(status, 409)
            self.assertEqual(self.call("/v1/releases", role)[0], 409)
        self.assertEqual(self.call("/v1/admission/open", "workspace", {})[0], 401)

    def test_developer_cannot_approve_even_when_replaying_owner_operation(self):
        body = {"action": "recover", "requestId": str(uuid.uuid4())}
        self.assertEqual(self.call("/v1/operations", "owner", body)[0], 200)
        self.assertEqual(self.call("/v1/operations", "developer", body)[1]["error"], "owner_required")

    def test_authentication_precedes_operation_lookup(self):
        self.assertEqual(self.call("/v1/workspaces/operations/missing", "invalid")[0], 401)
        self.assertEqual(self.call("/v1/history", "invalid")[0], 401)
        self.assertEqual(self.call("/v1/workspaces/operations", "owner", {})[0], 409)

    def test_developer_can_prepare_only_an_exact_revision(self):
        body = {"action": "prepare", "requestId": str(uuid.uuid4()), "revision": REVISION}
        self.assertEqual(self.call("/v1/operations", "developer", body)[1]["state"], "queued")
        self.assertEqual(self.call("/v1/operations", "developer", {**body, "revision": "main"})[0], 409)


if __name__ == "__main__":
    unittest.main()
