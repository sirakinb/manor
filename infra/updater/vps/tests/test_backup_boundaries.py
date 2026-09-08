import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from production_gate import ProductionGate
from release import Refused


class BackupBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.policy = {
            "gateStateDir": str(self.root), "databaseContainer": "synthetic-db",
            "databaseUser": "synthetic", "databaseName": "synthetic",
            "postgresImage": "synthetic-postgres", "backupImage": "synthetic-backup",
            "dataVolume": "synthetic-data", "backupTimeoutSeconds": 900,
            "project": "manor-test-boundary", "services": ["app", "worker"],
        }
        self.gate = ProductionGate(self.policy)
        self.operation = {"operation": str(uuid.uuid4())}
        self.directory = self.root / self.operation["operation"]
        self.restore = self.directory / "restore"
        self.gate.action("close", self.operation, "operator")

    def quota(self, *_args):
        self.restore.mkdir()
        (self.directory / "restore.ext4").write_bytes(b"synthetic filesystem")
        return self.restore

    def command(self, argv, **_kwargs):
        if argv[0] == "umount":
            shutil.rmtree(self.restore / "database", ignore_errors=True)
        return b""

    def test_dump_restore_and_archive_share_the_configured_time_budget(self):
        now = [0]
        budgets = []
        def process(argv, **kwargs):
            budgets.append(kwargs["timeout"])
            now[0] += 100 if "pg_dump" in argv else 200
        def command(argv, **kwargs):
            if argv[-1].startswith("tar -czf"):
                budgets.append(kwargs["timeout"])
                (self.directory / "application.tar.gz").write_bytes(b"synthetic archive")
            return self.command(argv, **kwargs)
        with patch.object(self.gate, "producer_ids", return_value=[]), \
                patch("production_gate.admission"), patch("production_gate.time.monotonic", side_effect=lambda: now[0]), \
                patch("production_gate.quota_directory", side_effect=self.quota), \
                patch("production_gate.os.path.ismount", return_value=True), \
                patch("production_gate.run", side_effect=command), patch("production_gate.subprocess.run", side_effect=process):
            self.assertTrue(self.gate.action("backup", self.operation, "operator")["verified"])
        self.assertEqual(budgets, [900, 800, 600])
        self.assertFalse(self.restore.exists())
        self.assertFalse((self.directory / "restore.ext4").exists())

    def test_partial_restore_setup_is_cleaned_before_propagating_failure(self):
        original_mkdir = Path.mkdir
        for failure in ("quota", "mkdir", "chown"):
            def quota(*args):
                result = self.quota(*args)
                if failure == "quota":
                    raise Refused("synthetic_setup_failure")
                return result
            def mkdir(path, *args, **kwargs):
                if failure == "mkdir" and path == self.restore / "database":
                    raise OSError("synthetic_setup_failure")
                return original_mkdir(path, *args, **kwargs)
            def command(argv, **kwargs):
                if failure == "chown" and argv[0] == "chown":
                    raise Refused("synthetic_setup_failure")
                return self.command(argv, **kwargs)
            with patch.object(self.gate, "producer_ids", return_value=[]), \
                    patch("production_gate.admission"), patch("production_gate.quota_directory", side_effect=quota), \
                    patch.object(Path, "mkdir", mkdir), patch("production_gate.os.path.ismount", return_value=True), \
                    patch("production_gate.run", side_effect=command), patch("production_gate.subprocess.run"):
                with self.assertRaisesRegex((Refused, OSError), "synthetic_setup_failure"):
                    self.gate.action("backup", self.operation, "operator")
            self.assertFalse(self.restore.exists(), failure)
            self.assertFalse((self.directory / "restore.ext4").exists(), failure)

    def test_switch_and_recovery_only_unpause_services_owned_by_the_release(self):
        owned, prepaused = "a" * 64, "b" * 64
        with self.gate.connect() as db:
            db.execute("INSERT INTO paused VALUES (?)", (owned,))
            db.execute("INSERT INTO backups VALUES (?,?)", (self.operation["operation"], "synthetic"))
        unpaused = []
        def command(argv, **_kwargs):
            if argv[:3] == ["docker", "ps", "-q"]:
                self.assertIn("--no-trunc", argv)
                return (owned if argv[-1].endswith("=app") else prepaused).encode()
            if argv[:3] == ["docker", "ps", "-aq"]:
                return owned.encode()
            if argv[1] == "inspect":
                self.assertNotEqual(argv[-1], prepaused)
                return b"true"
            if argv[1] == "unpause":
                unpaused.append(argv[-1])
            return b""
        with patch("production_gate.run", side_effect=command):
            self.gate.action("switch", {}, "operator")
            restored = ProductionGate(self.policy)
            restored.action("switch", {}, "operator")
            restored.action("open", self.operation, "operator")
        self.assertEqual(unpaused, [owned, owned, owned])
        self.assertFalse(restored.action("status", {}, "operator")["closed"])
