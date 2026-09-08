import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release import Controller, Refused, Store, validate
from docker_adapter import members, write_source

REVISION = "a" * 40
IMAGE_A = "sha256:" + "1" * 64
IMAGE_B = "sha256:" + "2" * 64


class Adapter:
    def __init__(self):
        self.image = IMAGE_A
        self.next_image = IMAGE_B
        self.calls = []
        self.fail = set()
        self.closed = False
        self.active = 0

    def call(self, name):
        self.calls.append(name)
        if name in self.fail:
            raise Refused("injected_" + name)

    def cleanup_builds(self):
        self.call("cleanup")

    def prepare(self, revision, operation):
        self.call("prepare")
        return {"imageId": self.next_image, "evidenceHash": hashlib.sha256(revision.encode()).hexdigest()}

    def verify_image(self, image):
        self.call("verify")

    def current_image(self):
        return self.image

    def require_compatible(self, revision, action):
        self.call("compatible")

    def close_admission(self, operation):
        self.call("close")
        self.closed = True

    def wait_drained(self):
        self.call("drain")
        if self.active:
            raise Refused("drain_timeout")

    def backup(self, operation):
        self.call("backup")
        return "b" * 64

    def activate(self, image):
        self.call("activate")
        self.image = image

    def health(self, image):
        self.call("health")
        if image == IMAGE_B and "candidate_health" in self.fail:
            raise Refused("health_check_failed")

    def open_admission(self, operation):
        self.call("open")
        self.closed = False


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name)
        self.adapter = Adapter()
        self.controller = Controller(self.store, self.adapter, "policy-v1")

    def request(self, action, role="developer", **fields):
        request = {"requestId": str(uuid.uuid4()), "action": action, **fields}
        self.controller.submit(request, role)
        self.controller.process()
        return self.store.operation(request["requestId"])

    def prepared(self, revision=REVISION):
        result = self.request("prepare", revision=revision)
        self.assertEqual(result["state"], "succeeded")
        return self.store.release(result["releaseId"])

    def approved(self, revision=REVISION):
        release = self.prepared(revision)
        result = self.request("approve", "owner", releaseId=release["releaseId"], manifestHash=release["manifestHash"])
        self.assertEqual(result["state"], "succeeded")
        return release

    def deploy(self, release, action="deploy"):
        return self.request(action, "owner" if action == "rollback" else "developer",
                            releaseId=release["releaseId"], manifestHash=release["manifestHash"])

    def test_approval_required_and_exact_manifest(self):
        release = self.prepared()
        self.assertEqual(self.deploy(release)["error"], "owner_approval_required")
        self.assertNotIn("activate", self.adapter.calls)
        with self.assertRaises(Refused):
            self.controller.submit({"action": "approve", "requestId": str(uuid.uuid4()),
                                    "releaseId": release["releaseId"], "manifestHash": release["manifestHash"]}, "developer")
        result = self.request("approve", "owner", releaseId=release["releaseId"], manifestHash="f" * 64)
        self.assertEqual(result["error"], "approval_invalidated")

    def test_revision_and_policy_changes_invalidate_approval(self):
        old = self.approved()
        new = self.prepared("b" * 40)
        self.assertNotEqual(new["releaseId"], old["releaseId"])
        self.assertEqual(self.deploy(new)["error"], "owner_approval_required")
        self.controller.policy_hash = "policy-v2"
        self.assertEqual(self.deploy(old)["error"], "approval_invalidated")

    def test_duplicate_request_returns_original_without_reexecution(self):
        request = {"requestId": str(uuid.uuid4()), "action": "prepare", "revision": REVISION}
        self.controller.submit(request, "developer")
        self.controller.process()
        first = self.controller.submit(request, "developer")
        self.controller.process()
        self.assertEqual(self.adapter.calls.count("prepare"), 1)
        self.assertEqual(first["state"], "succeeded")
        with self.assertRaises(Refused):
            self.controller.submit({**request, "revision": "b" * 40}, "developer")

    def test_separate_request_for_same_deployment_is_noop(self):
        release = self.approved()
        self.assertEqual(self.deploy(release)["state"], "succeeded")
        self.assertEqual(self.deploy(release)["state"], "succeeded")
        self.assertEqual(self.adapter.calls.count("activate"), 1)

    def test_rollout_order_and_durable_history(self):
        release = self.approved()
        self.adapter.calls.clear()
        self.assertEqual(self.deploy(release)["state"], "succeeded")
        calls = self.adapter.calls
        for earlier, later in (("close", "drain"), ("drain", "backup"), ("backup", "activate"),
                               ("activate", "health"), ("health", "open")):
            self.assertLess(calls.index(earlier), calls.index(later))
        reopened = Store(self.temp.name)
        self.assertTrue(reopened.release(release["releaseId"])["approved"])
        self.assertIsNone(reopened.journal())
        self.assertFalse(self.adapter.closed)

    def test_active_work_prevents_switch_without_killing_work(self):
        release = self.approved()
        self.adapter.active = 1
        result = self.deploy(release)
        self.assertEqual(result["error"], "drain_timeout")
        self.assertEqual(self.adapter.image, IMAGE_A)
        self.assertNotIn("activate", self.adapter.calls)
        self.assertFalse(self.adapter.closed)

    def test_backup_failure_keeps_previous_application(self):
        release = self.approved()
        self.adapter.fail.add("backup")
        self.assertEqual(self.deploy(release)["state"], "failed")
        self.assertEqual(self.adapter.image, IMAGE_A)
        self.assertNotIn("activate", self.adapter.calls)

    def test_failed_health_restores_previous_image(self):
        release = self.approved()
        self.adapter.fail.add("candidate_health")
        self.assertEqual(self.deploy(release)["error"], "health_check_failed")
        self.assertEqual(self.adapter.image, IMAGE_A)
        self.assertIsNone(self.store.journal())

    def test_failed_recovery_remains_closed_and_blocks_next_deploy(self):
        release = self.approved()
        self.adapter.fail.add("health")
        self.assertEqual(self.deploy(release)["state"], "failed")
        self.assertTrue(self.adapter.closed)
        self.assertIsNotNone(self.store.journal())
        self.assertEqual(self.deploy(release)["error"], "recovery_required")
        self.adapter.fail.clear()
        self.assertEqual(self.request("recover", "owner")["state"], "succeeded")
        self.assertFalse(self.adapter.closed)

    def test_restart_never_replays_running_operation(self):
        release = self.approved()
        request = {"requestId": str(uuid.uuid4()), "action": "deploy",
                   "releaseId": release["releaseId"], "manifestHash": release["manifestHash"]}
        self.controller.submit(request, "developer")
        self.store.finish(request["requestId"], "running")
        self.store.journal({"phase": "switching", "operation": request["requestId"],
                            "previousImageId": IMAGE_A, "imageId": IMAGE_B})
        self.adapter.image = IMAGE_B
        restarted = Controller(Store(self.temp.name), self.adapter, "policy-v1")
        restarted.process()
        self.assertEqual(self.store.operation(request["requestId"])["state"], "interrupted")
        self.assertEqual(self.adapter.image, IMAGE_B)
        self.assertEqual(self.deploy(release)["error"], "recovery_required")
        self.assertEqual(self.request("recover", "owner")["state"], "succeeded")
        self.assertEqual(self.adapter.image, IMAGE_A)

    def test_only_previous_accepted_release_is_rollback_target(self):
        first = self.approved()
        self.assertEqual(self.deploy(first)["state"], "succeeded")
        self.adapter.next_image = "sha256:" + "3" * 64
        second = self.approved("b" * 40)
        self.assertEqual(self.deploy(second)["state"], "succeeded")
        self.assertEqual(self.deploy(second, "rollback")["error"], "not_previous_release")
        self.assertEqual(self.deploy(first, "rollback")["state"], "succeeded")
        self.assertEqual(self.adapter.image, IMAGE_B)

    def test_external_deployment_drift_is_refused(self):
        release = self.approved()
        self.deploy(release)
        self.adapter.image = IMAGE_A
        self.assertEqual(self.deploy(release)["error"], "deployment_drift")

    def test_process_lock_excludes_another_controller(self):
        with self.store.lock():
            with self.assertRaises(Refused):
                Controller(Store(self.temp.name), self.adapter, "policy-v1").process()

    def test_rejects_arbitrary_fields_and_non_commit_refs(self):
        for revision in ("main", "HEAD", "-x", "a" * 39, "a" * 41):
            with self.assertRaises(Refused):
                validate({"requestId": str(uuid.uuid4()), "action": "prepare", "revision": revision})
        with self.assertRaises(Refused):
            validate({"requestId": str(uuid.uuid4()), "action": "recover", "command": "anything"})


class ArchiveTests(unittest.TestCase):
    def archive(self, name, kind=tarfile.REGTYPE, target=""):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as tar:
            item = tarfile.TarInfo(name)
            item.type = kind
            item.linkname = target
            tar.addfile(item)
        return output.getvalue()

    def test_refuses_paths_links_secrets_and_dependencies(self):
        for name, kind, target in (
            ("../escape", tarfile.REGTYPE, ""), ("/escape", tarfile.REGTYPE, ""),
            (".env", tarfile.REGTYPE, ""), ("nested/.env.production", tarfile.REGTYPE, ""),
            ("node_modules/hook", tarfile.REGTYPE, ""), (".git/config", tarfile.REGTYPE, ""),
            ("link", tarfile.SYMTYPE, "/etc"), ("hard", tarfile.LNKTYPE, "/etc/passwd"),
        ):
            with self.subTest(name=name), self.assertRaises(Refused):
                members(self.archive(name, kind, target))

    def test_refuses_existing_symlink_ancestor(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as other:
            Path(root, "linked").symlink_to(other)
            with self.assertRaises(Refused):
                write_source(self.archive("linked/file"), Path(root))
