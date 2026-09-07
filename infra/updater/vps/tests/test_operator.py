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
from docker_adapter import load_policy
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
