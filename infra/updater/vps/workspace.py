#!/usr/bin/env python3
"""Operator-only workspace lifecycle. Install a fixed wrapper before granting scoped access."""
import argparse
import contextlib
import fcntl
import json
import os
import re
import secrets
from pathlib import Path

from docker_adapter import admission, quota_directory, run
from release import Refused, canonical

HEAVY_LOCK = "/run/lock/manor-development-heavy.lock"


@contextlib.contextmanager
def heavy_lock():
    descriptor = os.open(HEAVY_LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("heavy_job_busy") from None
        stale = run(["docker", "ps", "-aq", "--filter", "label=manor.release.build=true"]).decode().split()
        for container in stale:
            run(["docker", "rm", "-f", container])
        yield


class Workspace:
    def __init__(self, state, workspace_id):
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,24}", workspace_id):
            raise Refused("invalid_workspace_id")
        self.state = Path(state)
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.workspace_id = workspace_id
        self.name = "manor-dev-" + workspace_id
        self.record = self.state / (workspace_id + ".json")

    def read(self):
        if not self.record.is_file():
            raise Refused("workspace_not_found")
        return json.loads(self.record.read_text())

    def docker(self, *args, **kwargs):
        return run(["docker", *args], **kwargs)

    def create(self, repository, revision, toolchain, postgres_image, port):
        from docker_adapter import source_archive
        from release import IMAGE
        if not IMAGE.fullmatch(toolchain) or not IMAGE.fullmatch(postgres_image):
            raise Refused("immutable_images_required")
        if not 18080 <= port <= 18089:
            raise Refused("preview_port_out_of_range")
        if self.record.exists():
            raise Refused("workspace_already_exists")
        # One initial workspace and its bounded jobs fit a small shared VPS.
        if list(self.state.glob("*.json")):
            raise Refused("workspace_limit_reached")
        admission(self.state, 256, disk_mb=512)
        source_archive(repository, revision)  # Fail closed on unsafe tracked paths.
        volume = quota_directory(self.state, self.workspace_id, 256)
        repository_path = volume / "repository.git"
        tree = volume / "tree"
        if repository_path.exists():
            raise Refused("partial_workspace_requires_operator_inspection")
        run(["git", "-c", "safe.directory=" + repository, "-c", "safe.directory=" + repository + "/.git", "clone", "--bare", "--no-hardlinks", repository, str(repository_path)])
        run(["git", "-c", "core.hooksPath=/dev/null", "--git-dir=" + str(repository_path),
             "worktree", "add", "-b", "workspace/" + self.workspace_id, str(tree), revision])
        # Rewrite absolute worktree pointers for the container's only mounted workspace.
        (tree / ".git").write_text("gitdir: /workspace/repository.git/worktrees/tree\n")
        (repository_path / "worktrees/tree/gitdir").write_text("/workspace/tree/.git\n")
        for name in ("data", "postgres"):
            (volume / name).mkdir(exist_ok=True)
        run(["chown", "-R", "1000:1000", str(volume)])
        run(["chown", "-R", "999:999", str(volume / "postgres")])
        (volume / "postgres").chmod(0o700)
        config = {
            "id": self.workspace_id, "volume": str(volume), "toolchain": toolchain,
            "postgresImage": postgres_image, "port": port, "password": secrets.token_hex(24),
            "previewToken": secrets.token_hex(24), "state": "provisioning",
        }
        self.record.write_text(canonical(config))
        self.record.chmod(0o600)
        self.docker("network", "create", "--internal", "--label", "manor.workspace=" + self.workspace_id, self.name)
        self.docker(
            "run", "-d", "--name", self.name + "-db", "--label", "manor.workspace=" + self.workspace_id,
            "--network", self.name, "--network-alias", "postgres", "--user", "999:999", "--read-only",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m,uid=999,gid=999",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--cpus", "0.25", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "64",
            "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=2",
            "--env", "POSTGRES_USER=synthetic", "--env", "POSTGRES_DB=synthetic",
            "--env", "POSTGRES_PASSWORD=" + config["password"],
            "--mount", "type=bind,src=" + str(volume / "postgres") + ",dst=/var/lib/postgresql/data",
            "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=8m",
            postgres_image, "postgres", "-c", "shared_buffers=16MB", "-c", "max_connections=10")
        self.start_container(config)
        config["state"] = "running"
        self.record.write_text(canonical(config))
        return self.status()

    def source_mounts(self, tree):
        # Overlay source around the toolchain's installed workspace node_modules.
        package_dirs = {path.parent.relative_to(tree) for path in tree.rglob("package.json")
                        if "node_modules" not in path.parts and ".git" not in path.parts}
        mounts = []

        def visit(relative):
            directory = tree / relative
            for child in directory.iterdir():
                rel = child.relative_to(tree)
                if child.name in {".git", "node_modules"}:
                    continue
                if not child.resolve().is_relative_to(tree.resolve()):
                    raise Refused("workspace_mount_escape")
                if child.is_dir() and any(package == rel or rel in package.parents for package in package_dirs):
                    visit(rel)
                else:
                    mounts.extend(["--mount", "type=bind,src=" + str(child) + ",dst=/app/" + str(rel)])
        visit(Path("."))
        return mounts

    def start_container(self, config):
        volume = Path(config["volume"])
        args = [
            "run", "-d", "--name", self.name, "--label", "manor.workspace=" + self.workspace_id,
            "--network", self.name, "--read-only", "--user", "1000:1000",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--cpus", "1", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "128",
            "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=2",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000",
            "--mount", "type=bind,src=" + str(volume) + ",dst=/workspace",
            "--workdir", "/workspace/tree",
            "--env", "DATABASE_URL=postgres://synthetic:" + config["password"] + "@postgres:5432/synthetic",
            "--env", "DATA_DIR=/workspace/data", "--env", "PREVIEW_TOKEN=" + config["previewToken"],
            "--env", "NODE_OPTIONS=--max-old-space-size=192",
        ]
        args += self.source_mounts(volume / "tree")
        self.docker(*args, config["toolchain"], "sleep", "infinity")

    def execute(self, command):
        if not command or len(command) > 100 or any(len(arg) > 32768 for arg in command):
            raise Refused("invalid_container_command")
        admission(self.state, 256, disk_mb=0)
        # This is container argv only. No arbitrary shell ever runs on the host.
        return self.docker("exec", "--user", "1000:1000", self.name, *command, timeout=1800)

    def suspend(self):
        config = self.read()
        self.docker("stop", "--time", "10", self.name)
        self.docker("stop", "--time", "30", self.name + "-db")
        config["state"] = "suspended"
        self.record.write_text(canonical(config))
        return self.status()

    def resume(self):
        config = self.read()
        admission(self.state, 256, disk_mb=0)
        quota_directory(self.state, self.workspace_id, 256)
        actual = self.docker("inspect", "--format", "{{.State.Running}}", self.name).decode().strip()
        if actual != "true":
            # Recreate source mounts after edits, validating all paths again.
            self.docker("rm", self.name)
            self.start_container(config)
        self.docker("start", self.name + "-db")
        config["state"] = "running"
        self.record.write_text(canonical(config))
        return self.status()

    def submit(self, repository):
        from release import COMMIT
        # Source Git is untrusted and runs only inside the sandbox.
        revision = self.execute(["git", "-c", "core.fsmonitor=false", "rev-parse", "HEAD"]).decode().strip()
        if not COMMIT.fullmatch(revision):
            raise Refused("invalid_revision")
        dirty = self.execute(["git", "-c", "core.fsmonitor=false", "status", "--porcelain"]).decode().strip()
        if dirty:
            raise Refused("commit_workspace_changes_first")
        data = self.execute(["git", "-c", "core.fsmonitor=false", "bundle", "create", "-", "HEAD"])
        if len(data) > 128 * 1024 * 1024:
            raise Refused("bundle_too_large")
        bundle = self.state / (self.workspace_id + ".bundle")
        bundle.write_bytes(data)
        run(["git", "-c", "core.hooksPath=/dev/null", "-c", "fetch.fsckObjects=true",
             "-c", "safe.directory=" + repository,
             "-C", repository, "fetch", str(bundle), "HEAD:refs/manor-workspaces/" + self.workspace_id + "/" + revision])
        return {"revision": revision}

    def preview_url(self):
        import ipaddress
        networks = json.loads(self.docker("inspect", "--format", "{{json .NetworkSettings.Networks}}", self.name))
        address = networks[self.name]["IPAddress"]
        if not ipaddress.ip_address(address).is_private:
            raise Refused("private_preview_required")
        return "http://" + address + ":5173"

    def status(self):
        config = self.read()
        return {"id": config["id"], "state": config["state"], "port": config["port"],
                "diskLimitMb": 256, "memoryLimitMb": 256, "database": "synthetic",
                "access": "authenticated SSH tunnel; preview also requires bearer token"}

    def destroy(self):
        # The record is removed last, so a missing record makes a completed retry a no-op.
        if not self.record.exists():
            return {"id": self.workspace_id, "state": "destroyed"}
        config = self.read()
        ids = self.docker("ps", "-aq", "--filter", "label=manor.workspace=" + self.workspace_id).decode().split()
        for container in ids:
            self.docker("rm", "-f", container)
        networks = self.docker("network", "ls", "-q", "--filter", "label=manor.workspace=" + self.workspace_id).decode().split()
        for network in networks:
            self.docker("network", "rm", network)
        volume = Path(config["volume"])
        if os.path.ismount(volume):
            run(["umount", str(volume)])
        if volume.exists():
            volume.rmdir()
        (self.state / (self.workspace_id + ".ext4")).unlink(missing_ok=True)
        self.record.unlink(missing_ok=True)
        return {"id": self.workspace_id, "state": "destroyed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, help="Operator-owned directory outside every workspace")
    parser.add_argument("--id", required=True)
    parser.add_argument("action", choices=["create", "status", "exec", "suspend", "resume", "submit", "destroy"])
    parser.add_argument("--repository")
    parser.add_argument("--revision")
    parser.add_argument("--toolchain")
    parser.add_argument("--postgres-image")
    parser.add_argument("--port", type=int, default=18080)
    args, trailing = parser.parse_known_args()
    if args.action != "exec" and trailing:
        parser.error("Unexpected arguments")
    args.argv = trailing
    workspace = Workspace(args.state, args.id)
    with heavy_lock():
        if args.action == "create":
            result = workspace.create(args.repository, args.revision, args.toolchain, args.postgres_image, args.port)
        elif args.action == "exec":
            command = args.argv[1:] if args.argv[:1] == ["--"] else args.argv
            print(workspace.execute(command).decode(), end="")
            return
        elif args.action == "submit":
            result = workspace.submit(args.repository)
        else:
            result = getattr(workspace, args.action)()
        print(canonical(result))


if __name__ == "__main__":
    main()
