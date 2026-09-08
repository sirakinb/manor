import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docker_adapter import DockerAdapter, load_policy
from release import Controller, Refused, Store, canonical, main, validate
from test_release import Adapter, REVISION
from workspace import Workspace


class OperatorBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def policy(self):
        policy = {
            "stateDir": str(self.root / "state"), "repository": str(self.root / "repo"),
            "toolchainImage": "sha256:" + "a" * 64, "project": "manor-test-unit",
            "services": ["app"], "testCommand": ["true"], "buildCommand": ["true"],
            "maintenanceUrl": "http://127.0.0.1:18082", "healthUrl": "http://127.0.0.1:18083",
            "mode": "isolated",
        }
        for key in ("composeFile", "envFile", "ownerTokenFile", "developerTokenFile", "maintenanceTokenFile"):
            path = self.root / key
            path.write_text("synthetic-" + key + "-" * 40)
            path.chmod(0o600)
            policy[key] = str(path)
        return policy

    def save_policy(self, policy):
        path = self.root / "policy.json"
        path.write_text(canonical(policy))
        path.chmod(0o600)
        return path

    def test_credentials_are_required(self):
        for key in ("ownerTokenFile", "developerTokenFile"):
            policy = self.policy()
            del policy[key]
            with self.assertRaisesRegex(Refused, "incomplete_policy"):
                load_policy(self.save_policy(policy))

    def test_credentials_must_be_private_regular_operator_files(self):
        for key in ("ownerTokenFile", "developerTokenFile", "maintenanceTokenFile"):
            policy = self.policy()
            filename = self.save_policy(policy)
            self.assertEqual(load_policy(filename), policy)
            token = Path(policy[key])
            for mode in (0o640, 0o620, 0o604, 0o602):
                token.chmod(mode)
                with self.assertRaisesRegex(Refused, "operator_owned"):
                    load_policy(filename)
            token.unlink()
            token.symlink_to(self.root / "envFile")
            with self.assertRaisesRegex(Refused, "operator_owned"):
                load_policy(filename)
            token.unlink()

    def test_missing_credential_file_is_a_controlled_error(self):
        policy = self.policy()
        Path(policy["ownerTokenFile"]).unlink()
        with self.assertRaisesRegex(Refused, "deployment_config_unavailable"):
            load_policy(self.save_policy(policy))

    def test_preselection_failure_retains_private_diagnostics_and_queue(self):
        store = Store(self.root / "state")
        adapter = Adapter()
        controller = Controller(store, adapter, "policy")
        request = {"requestId": "11111111-1111-4111-8111-111111111111", "action": "prepare", "revision": REVISION}
        controller.submit(request, "developer")
        with mock.patch.object(adapter, "cleanup_builds", side_effect=Refused("synthetic_cleanup_failure")):
            controller.poll()
        operation = store.operation(request["requestId"])
        self.assertEqual(operation["state"], "queued")
        self.assertIsNone(operation["error"])
        diagnostic = store.directory / "last-error.txt"
        self.assertIn("synthetic_cleanup_failure", diagnostic.read_text())
        self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)
        store.record_error(Refused("x" * 20000))
        self.assertLessEqual(diagnostic.stat().st_size, 8192)

    def test_private_diagnostics_remain_valid_json_with_escaped_output(self):
        store = Store(self.root / "state")
        error = Refused("💥" * 512)
        diagnostic = store.directory / "last-error.txt"
        for noisy in ("\x1b[31m💥" * 7000, "💥" * 200):
            error.diagnostic = noisy + "final_failure"
            store.record_error(error)
            self.assertLessEqual(diagnostic.stat().st_size, 8192)
            record = json.loads(diagnostic.read_text())
            self.assertEqual(record["code"], str(error))
            self.assertTrue(record["diagnostic"].endswith("final_failure"))
            self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)

    def test_stopped_bootstrap_requires_the_exact_image_and_no_live_process(self):
        old = "sha256:" + "b" * 64
        adapter = DockerAdapter({**self.policy(), "unguardedBootstrapImage": old})
        for image, state, accepted in (
            (old, {"Running": False, "Restarting": False, "Pid": 0}, True),
            ("sha256:" + "c" * 64, {"Running": False, "Restarting": False, "Pid": 0}, False),
            (old, {"Running": True, "Restarting": False, "Pid": 42}, False),
            (old, {"Running": False, "Restarting": True, "Pid": 0}, False),
            (old, {"Running": False, "Restarting": False, "Pid": 42}, False),
        ):
            with mock.patch.object(adapter, "compose", side_effect=[b"", b"synthetic-container"]), \
                    mock.patch.object(adapter, "docker", side_effect=[image.encode(), canonical(state).encode()]):
                if accepted:
                    self.assertEqual(adapter.current_image(), old)
                else:
                    with self.assertRaisesRegex(Refused, "stopped_bootstrap_image_required"):
                        adapter.current_image()
        with mock.patch.object(adapter, "compose", side_effect=[b"", b"one\ntwo"]):
            with self.assertRaisesRegex(Refused, "single_running_service_required"):
                adapter.current_image()
        adapter.policy.pop("unguardedBootstrapImage")
        with mock.patch.object(adapter, "compose", return_value=b"") as compose:
            with self.assertRaisesRegex(Refused, "single_running_service_required"):
                adapter.current_image()
            compose.assert_called_once()

    def test_history_cli_returns_operations(self):
        directory = self.root / "state"
        controller = Controller(Store(directory), Adapter(), "policy")
        request = {"requestId": "11111111-1111-4111-8111-111111111111", "action": "prepare", "revision": REVISION}
        controller.submit(request, "developer")
        output = io.StringIO()
        with mock.patch("sys.argv", ["release.py", "--policy", "unused", "history"]), \
                mock.patch("docker_adapter.load_policy", return_value={"stateDir": str(directory), "project": "manor-test-unit"}), \
                contextlib.redirect_stdout(output):
            main()
        self.assertEqual(json.loads(output.getvalue())[0]["requestId"], request["requestId"])

    def test_destroy_after_reboot_and_repeated_destroy(self):
        workspace = Workspace(self.root, "unit")
        volume = self.root / "unit"
        volume.mkdir()
        workspace.record.write_text(canonical({"volume": str(volume)}))
        (self.root / "unit.ext4").write_bytes(b"synthetic")
        with mock.patch.object(workspace, "docker", return_value=b""), \
                mock.patch("workspace.run") as command, mock.patch("workspace.os.path.ismount", return_value=False):
            self.assertEqual(workspace.destroy()["state"], "destroyed")
            self.assertEqual(workspace.destroy()["state"], "destroyed")
            command.assert_not_called()
        self.assertFalse(workspace.record.exists())
        self.assertFalse(volume.exists())
        self.assertFalse((self.root / "unit.ext4").exists())

    def test_destroy_resumes_after_files_are_already_removed(self):
        workspace = Workspace(self.root, "unit")
        workspace.record.write_text(canonical({"volume": str(self.root / "unit")}))
        with mock.patch.object(workspace, "docker", return_value=b""):
            self.assertEqual(workspace.destroy()["state"], "destroyed")
        self.assertFalse(workspace.record.exists())

    def test_backup_timeout_uses_operator_budget(self):
        for configured, expected in ((None, 600), (900, 900)):
            policy = self.policy()
            if configured is not None:
                policy["backupTimeoutSeconds"] = configured
            adapter = DockerAdapter(policy)
            with mock.patch("docker_adapter.urllib.request.urlopen", return_value=io.BytesIO(b'{"verified":true}')) as call:
                self.assertEqual(adapter.maintenance("backup"), {"verified": True})
                self.assertEqual(call.call_args.kwargs["timeout"], expected)
            with mock.patch("docker_adapter.urllib.request.urlopen", return_value=io.BytesIO(b'{"closed":true}')) as call:
                adapter.maintenance("close")
                self.assertEqual(call.call_args.kwargs["timeout"], 10)

    def test_automatic_rollback_requires_ancestry_and_compatible_source(self):
        policy = {**self.policy(), "mode": "production", "compatibilityPolicy": "unchanged-schema-and-toolchain-v1"}
        adapter = DockerAdapter(policy)
        base, previous = "a" * 40, "b" * 40
        with mock.patch.object(adapter, "current_image", return_value="sha256:" + "c" * 64), \
                mock.patch.object(adapter, "docker", return_value=json.dumps(["GIT_SHA=" + base]).encode()), \
                mock.patch("docker_adapter.run", side_effect=[b"", b"apps/web/src/fix.ts\0"]) as command:
            adapter.require_compatible(previous, "rollback")
            self.assertEqual(command.call_args_list[0].args[0][-4:], ["merge-base", "--is-ancestor", previous, base])
        with mock.patch.object(adapter, "current_image", return_value="sha256:" + "c" * 64), \
                mock.patch.object(adapter, "docker", return_value=json.dumps(["GIT_SHA=" + base]).encode()), \
                mock.patch("docker_adapter.run", side_effect=[b"", b"packages/db/prisma/schema.prisma\0"]):
            with self.assertRaisesRegex(Refused, "separate_operator_release_required"):
                adapter.require_compatible(previous, "rollback")

    def test_only_exact_reviewed_bootstrap_image_may_lack_admission_health(self):
        old, candidate = "sha256:" + "a" * 64, "sha256:" + "b" * 64
        adapter = DockerAdapter({**self.policy(), "productionAdmission": True, "unguardedBootstrapImage": old,
                                 "healthProbe": {"service": "app", "port": 3100, "path": "/health"}, "healthTimeoutSeconds": 0.01})
        def legacy_probe(*args, **_kwargs):
            if "maintenanceAdmission" in args[-1]:
                raise Refused("legacy_image_has_no_guard")
            return b""
        with mock.patch.object(adapter, "compose", return_value=b"synthetic"), \
                mock.patch.object(adapter, "docker", side_effect=legacy_probe), \
                mock.patch.object(adapter, "current_image", return_value=old):
            adapter.health(old)
        with mock.patch.object(adapter, "compose", return_value=b"synthetic"), \
                mock.patch.object(adapter, "docker", side_effect=legacy_probe), \
                mock.patch.object(adapter, "current_image", return_value=candidate):
            with self.assertRaisesRegex(Refused, "health_check_failed"):
                adapter.health(candidate)

    def test_failed_provisioning_retains_cleanup_record(self):
        workspace = Workspace(self.root, "partial")
        with mock.patch("workspace.admission"), mock.patch("docker_adapter.source_archive"), \
                mock.patch("workspace.quota_directory", side_effect=Refused("synthetic_quota_failure")):
            with self.assertRaisesRegex(Refused, "synthetic_quota_failure"):
                workspace.create("synthetic", REVISION, "sha256:" + "a" * 64, "sha256:" + "b" * 64, 18080)
        self.assertEqual(workspace.read()["state"], "provisioning")
        with mock.patch.object(workspace, "docker", return_value=b""):
            self.assertEqual(workspace.destroy()["state"], "destroyed")

    def test_request_id_schema_matches_canonical_runtime_ids(self):
        schema = json.loads((Path(__file__).resolve().parents[4] / "packages/contracts/release-v1.schema.json").read_text())
        valid = "abcdefab-1234-4234-9234-123456789abc"
        values = [valid, valid.upper(), "urn:uuid:" + valid, valid + "\n", valid.replace("-", "")]
        for branch in schema["oneOf"]:
            definition = branch["properties"]["requestId"]
            for value in values:
                accepted = len(value) <= definition["maxLength"] and bool(re.match(definition["pattern"], value))
                request = {"requestId": value, "action": "prepare", "revision": REVISION}
                try:
                    validate(request)
                    runtime = True
                except Refused:
                    runtime = False
                self.assertEqual(accepted, runtime)
