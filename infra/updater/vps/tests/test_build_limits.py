import contextlib
import io
import os
import shutil
import stat
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import docker_adapter
from docker_adapter import (MAX_ARCHIVE, MIB, DockerAdapter, artifact_archive, build_limits, check_members,
                            load_policy, members, run)
from release import Refused, canonical

REVISION = "a" * 40
TOOLCHAIN = "sha256:" + "a" * 64
CANDIDATE = "sha256:" + "c" * 64
LOCKFILE = b"lockfileVersion: synthetic\n"
BOUNDS = {
    "buildMemoryMb": (128, 4096, "build_memory_out_of_bounds"),
    "artifactLimitMb": (16, 1024, "artifact_limit_out_of_bounds"),
    "buildDiskMb": (1024, 8192, "build_disk_out_of_bounds"),
    "buildPidsLimit": (64, 1024, "build_pids_limit_out_of_bounds"),
    "buildTimeoutSeconds": (60, 7200, "build_timeout_out_of_bounds"),
}


def source(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, contents in files.items():
            item = tarfile.TarInfo(name)
            item.size = len(contents)
            tar.addfile(item, io.BytesIO(contents))
    return output.getvalue()


class FakeDocker:
    """Records Docker arguments and simulates only what preparation reads back."""

    def __init__(self, build_output=None, fail=None):
        self.calls = []
        self.build_output = build_output or {}
        self.fail = fail
        self.app = None
        self.streamed = None

    def __call__(self, *args, data=None, timeout=120, max_output=MAX_ARCHIVE):
        self.calls.append((args, {"timeout": timeout, "max_output": max_output}))
        if args[0] == self.fail:
            raise Refused("injected_" + self.fail)
        if args[:2] == ("image", "inspect"):
            return b'["node"]' if "Cmd" in args[3] else args[-1].encode()
        if args[0] == "create":
            return b"seed" if args[-1] == "true" else b"cleaner"
        if args[:2] == ("cp", "seed:/app/."):
            self.app = Path(args[2])
            (self.app / "pnpm-lock.yaml").write_bytes(LOCKFILE)
        if args[:2] == ("cp", "-"):
            self.streamed = data
            self.streamed_regular = stat.S_ISREG(os.fstat(data.fileno()).st_mode)
            with tarfile.open(fileobj=data) as tar:
                self.streamed_names = tar.getnames()
        if args[0] == "exec":
            for name, size in self.build_output.items():
                with (self.app / name).open("wb") as target:
                    target.truncate(size)
        if args[0] == "inspect":
            return b"0"
        if args[0] == "commit":
            return CANDIDATE.encode()
        return b""

    def find(self, first):
        return [(args, kwargs) for args, kwargs in self.calls if args[0] == first]


class BuildLimitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def policy(self, **limits):
        policy = {
            "stateDir": str(self.root / "state"), "repository": str(self.root / "repo"),
            "toolchainImage": TOOLCHAIN, "project": "manor-test-unit",
            "services": ["app"], "testCommand": ["true"], "buildCommand": ["build"],
            "maintenanceUrl": "http://127.0.0.1:18082", "healthUrl": "http://127.0.0.1:18083",
            "mode": "isolated", **limits,
        }
        for key in ("composeFile", "envFile", "ownerTokenFile", "developerTokenFile", "maintenanceTokenFile"):
            path = self.root / key
            path.write_text("synthetic-" + key + "-" * 40)
            path.chmod(0o600)
            policy[key] = str(path)
        return policy

    def load(self, policy):
        path = self.root / "policy.json"
        path.write_text(canonical(policy))
        path.chmod(0o600)
        return load_policy(path)

    @contextlib.contextmanager
    def fakes(self, adapter, fake, archive=None, quota=None):
        volume = self.root / "state" / "build"
        quota = quota or mock.Mock(side_effect=lambda state, name, size: volume.mkdir(exist_ok=True) or volume)
        with mock.patch.object(adapter, "docker", side_effect=fake), \
                mock.patch("docker_adapter.admission") as admission, \
                mock.patch("docker_adapter.source_archive",
                           return_value=archive or source({"pnpm-lock.yaml": LOCKFILE, "app.mjs": b"1"})), \
                mock.patch("docker_adapter.quota_directory", quota), \
                mock.patch("docker_adapter.run"):
            yield admission, quota

    def prepare(self, policy, build_output=None):
        adapter = DockerAdapter(policy)
        fake = FakeDocker(build_output)
        with self.fakes(adapter, fake) as (admission, quota), contextlib.ExitStack() as spool:
            result = adapter._prepare(REVISION, "operation", spool)
        return result, fake, admission, quota

    def spooled(self):
        return [p for p in (self.root / "state").iterdir() if p.name != "build"]

    def test_absent_fields_keep_todays_limits(self):
        policy = self.load(self.policy())
        self.assertEqual(build_limits(policy), {
            "buildMemoryMb": 1024, "artifactLimitMb": 128, "buildDiskMb": 3072,
            "buildPidsLimit": 128, "buildTimeoutSeconds": 1800})
        result, fake, admission, quota = self.prepare(policy)
        self.assertEqual(result["imageId"], CANDIDATE)
        admission.assert_called_once_with(Path(policy["stateDir"]), 1024, disk_mb=3072 + 256 + 128)
        quota.assert_called_once_with(Path(policy["stateDir"]), "build", 3072)
        build = next(args for args, _ in fake.find("create") if "--name" in args)
        acceptance = fake.find("run")[0]
        for args in (build, acceptance[0]):
            self.assertIn("1024m", args)
            self.assertEqual(args[args.index("--pids-limit") + 1], "128")
        self.assertIn("NODE_OPTIONS=--max-old-space-size=896", build)
        self.assertEqual([kwargs["timeout"] for _, kwargs in fake.find("exec")], [1800, 1800])
        self.assertEqual(acceptance[1]["timeout"], 1800)

    def test_each_field_is_bounded_and_integer(self):
        for key, (minimum, maximum, refusal) in BOUNDS.items():
            for value in (minimum, maximum):
                with self.subTest(key=key, value=value):
                    self.assertEqual(build_limits(self.load(self.policy(**{key: value})))[key], value)
            for value in (minimum - 1, maximum + 1, str(minimum), float(minimum), True, None):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(Refused, refusal):
                    self.load(self.policy(**{key: value}))

    def test_configured_limits_reach_build_acceptance_and_admission(self):
        policy = self.policy(buildMemoryMb=2048, buildDiskMb=4096, buildPidsLimit=256,
                             buildTimeoutSeconds=3600, artifactLimitMb=512)
        _, fake, admission, quota = self.prepare(policy)
        admission.assert_called_once_with(Path(policy["stateDir"]), 2048, disk_mb=4096 + 256 + 512)
        quota.assert_called_once_with(Path(policy["stateDir"]), "build", 4096)
        build = next(args for args, _ in fake.find("create") if "--name" in args)
        cleaner = next(args for args, _ in fake.find("create") if args[-1] != "true" and "--name" not in args)
        acceptance = fake.find("run")[0]
        for args in (build, acceptance[0]):
            self.assertEqual(args[args.index("--memory") + 1], "2048m")
            self.assertEqual(args[args.index("--memory-swap") + 1], "2048m")
            self.assertEqual(args[args.index("--pids-limit") + 1], "256")
        self.assertIn("NODE_OPTIONS=--max-old-space-size=1920", build)
        # The fixed cleaner helper is not a build container.
        self.assertEqual(cleaner[cleaner.index("--pids-limit") + 1], "64")
        self.assertEqual(cleaner[cleaner.index("--memory") + 1], "128m")
        self.assertEqual([kwargs["timeout"] for _, kwargs in fake.find("exec")], [3600, 3600])
        self.assertEqual([kwargs["max_output"] for _, kwargs in fake.find("exec")], [MIB, MIB])
        self.assertEqual(acceptance[1]["timeout"], 3600)
        self.assertEqual(acceptance[1]["max_output"], MIB)

    def test_whole_artifact_steps_have_longer_timeout_only(self):
        _, fake, _, _ = self.prepare(self.policy())
        timeouts = {args[:2]: kwargs["timeout"] for args, kwargs in fake.calls}
        self.assertEqual(timeouts[("cp", "-")], 600)
        self.assertEqual([kwargs["timeout"] for _, kwargs in fake.find("commit")], [600])
        for args, kwargs in fake.calls:
            if args[0] not in {"cp", "commit", "exec", "run"}:
                self.assertEqual(kwargs["timeout"], 120, args)
        # Streamed from the spooled file, not an in-memory copy.
        self.assertNotIsInstance(fake.streamed, (bytes, io.BytesIO))
        self.assertTrue(fake.streamed_regular)
        self.assertIn("app.mjs", fake.streamed_names)
        self.assertTrue(fake.streamed.closed)
        self.assertEqual(self.spooled(), [])

    def test_artifact_limit_is_configured(self):
        with self.assertRaisesRegex(Refused, "artifact_too_large"):
            self.prepare(self.policy(artifactLimitMb=16), {"dist.bin": 16 * MIB + 1})
        with self.assertRaisesRegex(Refused, "artifact_too_large"):
            self.prepare(self.policy(), {"dist.bin": MAX_ARCHIVE + 1})
        self.assertEqual(self.spooled(), [])
        # One file larger than the default limit passes the raised total and per-file limits.
        _, fake, _, _ = self.prepare(self.policy(artifactLimitMb=129), {"dist.bin": MAX_ARCHIVE + 1})
        self.assertIn("dist.bin", fake.streamed_names)

    def test_refusal_after_artifact_is_spooled_leaves_no_file(self):
        adapter = DockerAdapter(self.policy())
        fake = FakeDocker(fail="commit")
        created = []
        def spool_file(*args, **kwargs):
            created.append(artifact_archive(*args, **kwargs))
            return created[-1]
        with self.fakes(adapter, fake), mock.patch("workspace.heavy_lock", contextlib.nullcontext), \
                mock.patch.object(adapter, "_discard_build_volume"), \
                mock.patch("docker_adapter.artifact_archive", side_effect=spool_file):
            with self.assertRaisesRegex(Refused, "injected_commit"):
                adapter.prepare(REVISION, "operation")
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0].closed)
        self.assertEqual(self.spooled(), [])

    def test_source_archive_stays_fixed_whatever_the_policy(self):
        adapter = DockerAdapter(self.policy(artifactLimitMb=1024))
        with mock.patch.object(adapter, "docker", side_effect=FakeDocker()), \
                mock.patch("docker_adapter.admission"), contextlib.ExitStack() as spool, \
                mock.patch("docker_adapter.run", side_effect=[REVISION.encode(), b"x" * (MAX_ARCHIVE + 1)]) as command:
            with self.assertRaisesRegex(Refused, "source_too_large"):
                adapter._prepare(REVISION, "operation", spool)
        archive = command.call_args_list[1]
        self.assertIn("archive", archive.args[0])
        self.assertNotIn("max_output", archive.kwargs)
        oversized = self.root / "oversized"
        oversized.mkdir()
        with (oversized / "big").open("wb") as target:
            target.truncate(MAX_ARCHIVE + 1)
        with tarfile.open(self.root / "source.tar", "w") as tar:
            tar.add(oversized / "big", "big")
        with self.assertRaisesRegex(Refused, "regular_source_files_required"):
            members((self.root / "source.tar").read_bytes())

    def test_build_filesystem_of_another_size_is_recreated(self):
        state = self.root / "state"
        state.mkdir()
        disk = state / "build.ext4"
        volume = state / "build"
        for existing, configured, kept in ((3072, 4096, False), (4096, 4096, True), (4096, None, False)):
            with self.subTest(existing=existing, configured=configured):
                with disk.open("wb") as target:
                    target.truncate(existing * MIB)
                policy = self.policy() if configured is None else self.policy(buildDiskMb=configured)
                seen = []
                adapter = DockerAdapter(policy)
                def quota(_state, _name, size):
                    seen.append(disk.exists())
                    volume.mkdir(exist_ok=True)
                    return volume
                with self.fakes(adapter, FakeDocker(), quota=quota), contextlib.ExitStack() as spool:
                    adapter._prepare(REVISION, "operation", spool)
                self.assertEqual(seen, [kept])
                disk.unlink(missing_ok=True)
                shutil.rmtree(volume)


class ArtifactSpoolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tree = self.root / "tree"
        self.spool = self.root / "spool"
        (self.tree / "dist").mkdir(parents=True)
        (self.tree / "node_modules").mkdir()
        (self.tree / "node_modules" / "ignored.js").write_text("ignored")
        (self.tree / "dist" / "app.js").write_text("synthetic")
        self.spool.mkdir()

    def test_artifact_is_an_anonymous_file_in_the_given_directory(self):
        with mock.patch("docker_adapter.tempfile.TemporaryFile", wraps=tempfile.TemporaryFile) as opened:
            artifact = artifact_archive(self.tree, self.spool)
        opened.assert_called_once_with(dir=self.spool)
        with artifact:
            self.assertNotIsInstance(artifact, io.BytesIO)
            info = os.fstat(artifact.fileno())
            self.assertTrue(stat.S_ISREG(info.st_mode))
            self.assertEqual(info.st_dev, self.spool.stat().st_dev)
            self.assertEqual(info.st_nlink, 0)
            self.assertEqual(artifact.tell(), 0)
            with tarfile.open(fileobj=artifact) as tar:
                self.assertEqual(tar.getnames(), ["dist/app.js"])
                item = tar.getmember("dist/app.js")
                self.assertEqual((item.uid, item.gid, item.uname, item.gname), (1000, 1000, "", ""))
        self.assertTrue(artifact.closed)
        self.assertEqual(list(self.spool.iterdir()), [])

    def test_refused_artifact_closes_its_file(self):
        created, original = [], tempfile.TemporaryFile
        def opened(**kwargs):
            created.append(original(**kwargs))
            return created[-1]
        for refusal, prepare in (
            ("artifact_symlink_refused", lambda: (self.tree / "link").symlink_to(self.tree / "dist")),
            ("artifact_too_large", lambda: (self.tree / "link").unlink()),
        ):
            prepare()
            with self.subTest(refusal=refusal), \
                    mock.patch("docker_adapter.tempfile.TemporaryFile", side_effect=opened), \
                    self.assertRaisesRegex(Refused, refusal):
                artifact_archive(self.tree, self.spool, limit=4)
            self.assertTrue(created[-1].closed)
            self.assertEqual(list(self.spool.iterdir()), [])

    def test_streaming_validation_applies_the_members_rules(self):
        def archive(name, kind=tarfile.REGTYPE, target="", size=0):
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w") as tar:
                item = tarfile.TarInfo(name)
                item.type, item.linkname, item.size = kind, target, size
                tar.addfile(item, io.BytesIO(b"x" * size) if size else None)
            return output.getvalue()
        def spooled(data):
            file = tempfile.TemporaryFile(dir=self.spool)
            file.write(data)
            return file
        for name, kind, target, size in (
            ("../escape", tarfile.REGTYPE, "", 0), ("/escape", tarfile.REGTYPE, "", 0),
            (".env", tarfile.REGTYPE, "", 0), ("nested/.env.production", tarfile.REGTYPE, "", 0),
            ("node_modules/hook", tarfile.REGTYPE, "", 0), (".git/config", tarfile.REGTYPE, "", 0),
            ("link", tarfile.SYMTYPE, "/etc", 0), ("hard", tarfile.LNKTYPE, "/etc/passwd", 0),
            ("fifo", tarfile.FIFOTYPE, "", 0), ("large", tarfile.REGTYPE, "", 9),
        ):
            data = archive(name, kind, target, size)
            with self.subTest(name=name):
                with self.assertRaises(Refused) as expected:
                    members(data, 8)
                with spooled(data) as file, self.assertRaises(Refused) as streamed:
                    check_members(file, 8)
                self.assertEqual(str(streamed.exception), str(expected.exception))
        for data in (archive("ok", size=8), archive(".env.example"), archive("dir/", tarfile.DIRTYPE)):
            members(data, 8)
            with spooled(data) as file:
                check_members(file, 8)
                self.assertEqual(file.tell(), 0)

    def test_streaming_validation_reads_no_contents(self):
        with artifact_archive(self.tree, self.spool) as artifact, \
                mock.patch("docker_adapter.tarfile.TarFile.extractfile") as extract:
            check_members(artifact, MAX_ARCHIVE)
            extract.assert_not_called()


class StreamedInputTests(unittest.TestCase):
    echo = [sys.executable, "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())"]

    def test_file_object_is_the_child_stdin(self):
        with tempfile.TemporaryFile() as file, \
                mock.patch("docker_adapter.tempfile.TemporaryFile") as copied:
            file.write(b"synthetic-stream")
            file.seek(0)
            self.assertEqual(run(self.echo, data=file), b"synthetic-stream")
            copied.assert_not_called()
            self.assertFalse(file.closed)

    def test_bytes_input_is_unchanged(self):
        self.assertEqual(run(self.echo, data=b"synthetic-bytes"), b"synthetic-bytes")
        self.assertEqual(run(self.echo), b"")


if __name__ == "__main__":
    unittest.main()
