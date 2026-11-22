"""Trusted Linux/Docker adapter. Never load policy or Compose from candidate source."""
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import selectors
import signal
import tempfile
import tarfile
import time
import urllib.request
import urllib.error
from pathlib import Path

from release import COMMIT, IMAGE, Refused, canonical
from source_policy import automatic_source_compatible

MAX_ARCHIVE = 128 * 1024 * 1024
MIB = 1024 * 1024
# Optional operator policy limits for a reviewed build: field -> (default, minimum,
# maximum, refusal). An absent field keeps the default.
BUILD_LIMITS = {
    "buildMemoryMb": (1024, 128, 4096, "build_memory_out_of_bounds"),
    "artifactLimitMb": (128, 16, 1024, "artifact_limit_out_of_bounds"),
    "buildDiskMb": (3072, 1024, 8192, "build_disk_out_of_bounds"),
    "buildPidsLimit": (128, 64, 1024, "build_pids_limit_out_of_bounds"),
    "buildTimeoutSeconds": (1800, 60, 7200, "build_timeout_out_of_bounds"),
}


def build_limits(policy):
    limits = {}
    for key, (default, minimum, maximum, refusal) in BUILD_LIMITS.items():
        value = policy.get(key, default)
        if type(value) is not int or not minimum <= value <= maximum:
            raise Refused(refusal)
        limits[key] = value
    return limits


def run(argv, *, cwd=None, data=None, timeout=120, max_output=MAX_ARCHIVE):
    # Bound host memory, disk and time even when candidate tests print forever.
    # A binary file object becomes stdin as is; the caller keeps ownership of it.
    stream = hasattr(data, "read")
    with contextlib.nullcontext(data) if stream else tempfile.TemporaryFile() as source:
        if not stream:
            if data:
                source.write(data)
            source.seek(0)
        try:
            child = subprocess.Popen(
                argv, cwd=cwd, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "HOME": "/nonexistent",
                     "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
                     "GIT_NO_REPLACE_OBJECTS": "1", "GIT_TERMINAL_PROMPT": "0"},
            )
        except OSError:
            raise Refused("command_unavailable") from None
        output = bytearray()
        diagnostic = bytearray()
        total = 0
        deadline = time.monotonic() + timeout
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                selector.register(child.stderr, selectors.EVENT_READ)
                while selector.get_map():
                    if time.monotonic() >= deadline:
                        raise Refused("command_timeout")
                    for key, _ in selector.select(timeout=min(0.2, max(0, deadline-time.monotonic()))):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        total += len(chunk)
                        if total > max_output:
                            raise Refused("command_output_limit")
                        if key.fileobj is child.stdout:
                            output.extend(chunk)
                        else:
                            diagnostic.extend(chunk)
                            del diagnostic[:-6000]
            try:
                status = child.wait(timeout=max(0.01, deadline-time.monotonic()))
            except subprocess.TimeoutExpired:
                raise Refused("command_timeout") from None
            if status:
                error = Refused("command_failed")
                error.diagnostic = diagnostic.decode("utf-8", errors="replace")
                if output:
                    error.diagnostic += "\nOutput tail:\n" + output[-1800:].decode("utf-8", errors="replace")
                raise error
            return bytes(output)
        finally:
            if child.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            child.stdout.close()
            child.stderr.close()


def load_policy(filename, *, connected=False):
    path = Path(filename)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise Refused("policy_must_be_operator_owned")
    policy = json.loads(path.read_text())
    required = {"stateDir", "repository", "toolchainImage", "composeFile",
                "envFile", "project", "services", "testCommand", "buildCommand",
                "maintenanceUrl", "maintenanceTokenFile", "mode",
                "ownerTokenFile", "developerTokenFile"}
    if connected:
        required |= {"workspaceTokenFile", "applicationTokenFile", "operatorTokenFile",
                     "controlSocket", "workspaceStateDir", "gateStateDir"}
    if not required <= set(policy):
        raise Refused("incomplete_policy")
    if connected:
        for key in ("controlSocket", "workspaceStateDir", "gateStateDir"):
            if not isinstance(policy[key], str) or not Path(policy[key]).is_absolute():
                raise Refused("absolute_control_paths_required")
    if policy["mode"] not in {"isolated", "production"}:
        raise Refused("invalid_mode")
    if policy["mode"] == "production" and policy.get("productionReviewed") is not True:
        raise Refused("production_review_required")
    if policy.get("unguardedBootstrapImage") is not None and not IMAGE.fullmatch(policy["unguardedBootstrapImage"]):
        raise Refused("immutable_bootstrap_image_required")
    if not IMAGE.fullmatch(policy["toolchainImage"]):
        raise Refused("toolchain_must_be_immutable")
    if not re.fullmatch(r"manor-[a-z0-9-]{1,40}", policy["project"]):
        raise Refused("invalid_project")
    if policy["mode"] == "isolated" and not policy["project"].startswith("manor-test-"):
        raise Refused("isolated_project_required")
    private_files = ("composeFile", "envFile", "maintenanceTokenFile", "ownerTokenFile", "developerTokenFile")
    if connected:
        private_files += ("workspaceTokenFile", "applicationTokenFile", "operatorTokenFile")
    for key in private_files:
        try:
            info = Path(policy[key]).lstat()
        except (OSError, TypeError):
            raise Refused("deployment_config_unavailable") from None
        forbidden = 0o077 if key.endswith("TokenFile") else 0o022
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & forbidden:
            raise Refused("deployment_config_must_be_operator_owned")
    for key in (("healthUrl", "maintenanceUrl") if "healthUrl" in policy else ("maintenanceUrl",)):
        # The operator installs a loopback adapter/proxy; callers cannot choose URLs.
        if not re.fullmatch(r"http://127[.]0[.]0[.]1:[0-9]{1,5}(?:/[a-zA-Z0-9/_-]*)?", policy[key]):
            raise Refused("loopback_adapter_required")
    probe = policy.get("healthProbe")
    if probe is not None:
        if (not isinstance(probe, dict) or probe.get("service") not in policy["services"]
                or type(probe.get("port")) is not int or not 1 <= probe["port"] <= 65535
                or not re.fullmatch(r"/[a-zA-Z0-9/_-]*", probe.get("path", ""))):
            raise Refused("invalid_health_probe")
    elif "healthUrl" not in policy:
        raise Refused("health_probe_required")
    if not policy["services"] or any(not re.fullmatch(r"[a-z][a-z0-9_-]{0,30}", s) for s in policy["services"]):
        raise Refused("invalid_services")
    if any(s in {"postgres", "updater", "cloudflared", "caddy", "data-init"} for s in policy["services"]):
        raise Refused("application_services_only")
    for key in ("testCommand", "buildCommand"):
        if not isinstance(policy[key], list) or not policy[key] or any(not isinstance(x, str) for x in policy[key]):
            raise Refused("fixed_container_argv_required")
    build_limits(policy)
    return policy


def admission(directory, memory_mb=1024, reserve_mb=4096, disk_mb=2048):
    if shutil.disk_usage(directory).free < (reserve_mb + disk_mb) * MIB:
        raise Refused("insufficient_disk_headroom")
    memory = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    available = int(memory["MemAvailable"].split()[0]) * 1024
    if available < (memory_mb + 512) * MIB:
        raise Refused("insufficient_memory_headroom")


def source_archive(repository, revision):
    if not COMMIT.fullmatch(revision):
        raise Refused("exact_revision_required")
    base = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
            "-c", "safe.directory=" + repository, "-C", repository]
    actual = run(base + ["rev-parse", "--verify", revision + "^{commit}"]).decode().strip()
    if actual != revision:
        raise Refused("revision_not_found")
    archive = run(base + ["archive", "--format=tar", revision])
    if len(archive) > MAX_ARCHIVE:
        raise Refused("source_too_large")
    # Validate before copying to a privileged host directory.
    members(archive)
    return archive


def checked_member(member, limit):
    """Shared per-member rules; True for a regular file to keep, False for a directory."""
    path = Path(member.name)
    if (path.is_absolute() or ".." in path.parts
            or any(part in {".git", "node_modules"} for part in path.parts)
            or any(part == ".env" or (part.startswith(".env.") and not part.endswith(".example"))
                   for part in path.parts)):
        raise Refused("unsafe_source_path")
    if member.isdir():
        return False
    if not member.isfile() or member.size > limit:
        raise Refused("regular_source_files_required")
    return True


def members(archive, limit=MAX_ARCHIVE):
    result = []
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar:
            if checked_member(member, limit):
                result.append((member.name, tar.extractfile(member).read(), member.mode & 0o111))
    return result


def check_members(file, limit):
    """Apply the members() rules to a tar file without reading contents into memory."""
    file.seek(0)
    with tarfile.open(fileobj=file) as tar:
        for member in tar:
            checked_member(member, limit)
    file.seek(0)


def write_source(archive, destination):
    for name, contents, executable in members(archive):
        target = destination / name
        if not target.resolve().is_relative_to(destination.resolve()):
            raise Refused("unsafe_source_path")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)
        target.chmod(0o755 if executable else 0o644)


def clear_source(directory):
    """Keep installed dependencies, remove baseline source including deleted candidate files."""
    for entry in directory.iterdir():
        if entry.name == "node_modules":
            continue
        if entry.is_dir() and not entry.is_symlink():
            clear_source(entry)
            if not any(entry.iterdir()):
                entry.rmdir()
        else:
            entry.unlink()


def artifact_archive(directory, spool, limit=MAX_ARCHIVE):
    """Write the artifact tar to an anonymous file in spool; returns it open at the start."""
    output = tempfile.TemporaryFile(dir=spool)
    try:
        total = 0
        with tarfile.open(fileobj=output, mode="w") as tar:
            for root, dirs, files in os.walk(directory, followlinks=False):
                dirs[:] = [d for d in dirs if d != "node_modules"]
                for name in dirs + files:
                    path = Path(root) / name
                    if path.is_symlink():
                        raise Refused("artifact_symlink_refused")
                for name in files:
                    path = Path(root) / name
                    if not path.is_file():
                        raise Refused("artifact_special_file_refused")
                    total += path.stat().st_size
                    if total > limit:
                        raise Refused("artifact_too_large")
                    info = tar.gettarinfo(str(path), str(path.relative_to(directory)))
                    info.uid = info.gid = 1000
                    info.uname = info.gname = ""
                    with path.open("rb") as source:
                        tar.addfile(info, source)
        output.seek(0)
        return output
    except BaseException:
        output.close()
        raise


def quota_directory(state, name, size_mb):
    """A loop filesystem gives writable workspace data a hard disk bound on ext4 hosts."""
    root = state / name
    disk = state / (name + ".ext4")
    if not disk.exists():
        temporary = disk.with_suffix(".creating")
        try:
            with temporary.open("xb") as target:
                target.truncate(size_mb * MIB)
            run(["mkfs.ext4", "-q", "-m", "0", "-F", str(temporary)])
            temporary.replace(disk)
        finally:
            temporary.unlink(missing_ok=True)
    root.mkdir(exist_ok=True)
    if not os.path.ismount(root):
        run(["mount", "-o", "loop,nodev,nosuid", str(disk), str(root)])
    return root


class DockerAdapter:
    def __init__(self, policy):
        self.policy = policy
        self.state = Path(policy["stateDir"])
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.label = "manor.release.project=" + policy["project"]

    def docker(self, *args, data=None, timeout=120, max_output=MAX_ARCHIVE):
        return run(["docker", *args], data=data, timeout=timeout, max_output=max_output)

    def cleanup_builds(self):
        from workspace import heavy_lock
        with heavy_lock():
            self._cleanup_builds()
            self._discard_build_volume()

    def _discard_build_volume(self):
        volume = self.state / "build"
        disk = self.state / "build.ext4"
        if os.path.ismount(volume):
            run(["umount", str(volume)])
        if volume.exists():
            volume.rmdir()
        disk.unlink(missing_ok=True)

    def _cleanup_builds(self):
        ids = self.docker("ps", "-aq", "--filter", "label=" + self.label,
                          "--filter", "label=manor.release.build=true").decode().split()
        for container in ids:
            self.docker("rm", "-f", container)

    def verify_image(self, image):
        if not isinstance(image, str) or not IMAGE.fullmatch(image):
            raise Refused("immutable_image_required")
        actual = self.docker("image", "inspect", "--format", "{{.Id}}", image).decode().strip()
        if actual != image:
            raise Refused("image_missing")

    def prepare(self, revision, operation):
        from workspace import heavy_lock
        # The spool closes, and so removes, the artifact file on every path.
        with heavy_lock(), contextlib.ExitStack() as spool:
            try:
                return self._prepare(revision, operation, spool)
            finally:
                self._cleanup_builds()
                self._discard_build_volume()

    def _prepare(self, revision, operation, spool):
        development = self.docker("ps", "--filter", "label=manor.workspace", "--format", "{{.Names}}").decode().split()
        if any(not name.endswith("-db") for name in development):
            raise Refused("suspend_workspace_before_build")
        limits = build_limits(self.policy)
        memory, disk = limits["buildMemoryMb"], limits["buildDiskMb"]
        pids, timeout = str(limits["buildPidsLimit"]), limits["buildTimeoutSeconds"]
        allocated = shutil.disk_usage(self.state / "build").used // MIB if os.path.ismount(self.state / "build") else 0
        artifact_limit = limits["artifactLimitMb"] * MIB
        # The artifact is spooled to the state disk beside the build filesystem.
        admission(self.state, memory, disk_mb=max(0, disk - allocated) + 256 + limits["artifactLimitMb"])
        self.verify_image(self.policy["toolchainImage"])
        archive = source_archive(self.policy["repository"], revision)
        name = self.policy["project"] + "-build"
        self._cleanup_builds()
        leftover = self.state / "build.ext4"
        if leftover.exists() and leftover.stat().st_size != disk * MIB:
            # Scratch left by an interrupted build at another configured size is
            # never reused; it holds nothing that outlives a preparation.
            self._discard_build_volume()
        volume = quota_directory(self.state, "build", disk)
        app = volume / "app"
        # Discard every dependency modification from prior untrusted builds.
        if app.exists():
            shutil.rmtree(app)
        app.mkdir()
        seed = self.docker("create", "--label", self.label, "--label", "manor.release.build=true",
                           self.policy["toolchainImage"], "true").decode().strip()
        try:
            self.docker("cp", seed + ":/app/.", str(app), timeout=600)
        finally:
            self.docker("rm", seed)
        (volume / "lockfile").write_bytes((app / "pnpm-lock.yaml").read_bytes())
        lockfile = dict((n, data) for n, data, _ in members(archive) if n == "pnpm-lock.yaml").get("pnpm-lock.yaml")
        if lockfile != (volume / "lockfile").read_bytes():
            raise Refused("toolchain_dependency_lock_mismatch")
        clear_source(app)
        write_source(archive, app)
        del archive, lockfile
        run(["chown", "-R", "1000:1000", str(app)], timeout=120)
        self.docker("create", "--name", name, "--label", self.label,
                    "--label", "manor.release.build=true",
                    "--network", "none", "--read-only", "--user", "1000:1000",
                    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                    "--cpus", "1", "--memory", str(memory) + "m",
                    "--memory-swap", str(memory) + "m", "--pids-limit", pids,
                    "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=2",
                    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=64m,uid=1000,gid=1000",
                    "--mount", "type=bind,src=" + str(app) + ",dst=/app",
                    "--workdir", "/app", "--env", "NODE_OPTIONS=--max-old-space-size=" + str(max(64, memory - 128)),
                    "--env", "RAKAZO_ALLOW_DEV_SECRETS=1",
                    "--env", "GIT_SHA=" + revision,
                    self.policy["toolchainImage"], "sleep", "infinity")
        evidence = hashlib.sha256()
        try:
            self.docker("start", name)
            # Generate/build source first so checks can import generated clients. The
            # same checks run again against the immutable final image below.
            for command in (self.policy["buildCommand"], self.policy["testCommand"]):
                output = self.docker("exec", name, *command, timeout=timeout, max_output=MIB)
                evidence.update(canonical(command).encode())
                evidence.update(output)
            # Stop untrusted processes before reading their output (no symlink/write races).
            self.docker("stop", "--time", "0", name)
            artifact = spool.enter_context(artifact_archive(app, self.state, artifact_limit))
            check_members(artifact, artifact_limit)
            artifact_digest = hashlib.sha256()
            for chunk in iter(lambda: artifact.read(MIB), b""):
                artifact_digest.update(chunk)
            artifact.seek(0)
        finally:
            self.docker("rm", "-f", name)
        # A small image layer on the trusted toolchain; no candidate Dockerfile is evaluated.
        cleaner = (
            "const fs=require('fs');function clean(p){for(const n of fs.readdirSync(p)){"
            "if(n==='node_modules')continue;const q=p+'/'+n;"
            "if(fs.lstatSync(q).isDirectory()){clean(q);if(!fs.readdirSync(q).length)fs.rmdirSync(q)}"
            "else fs.unlinkSync(q)}}clean('/app')"
        )
        image_container = self.docker(
            "create", "--label", self.label, "--label", "manor.release.build=true",
            # Only this fixed cleaner has DAC override, inside an unmounted, networkless
            # helper. Toolchains may own /app as root or as the non-root app user.
            "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
            "--security-opt", "no-new-privileges", "--memory", "128m", "--memory-swap", "128m",
            "--cpus", "1", "--pids-limit", "64",
            self.policy["toolchainImage"], "node", "-e", cleaner).decode().strip()
        try:
            self.docker("start", "-a", image_container)
            code = self.docker("inspect", "--format", "{{.State.ExitCode}}", image_container).decode().strip()
            if code != "0":
                raise Refused("image_preparation_failed")
            self.docker("cp", "-", image_container + ":/app", data=artifact, timeout=600)
            original_command = json.loads(self.docker("image", "inspect", "--format", "{{json .Config.Cmd}}",
                                                       self.policy["toolchainImage"]))
            image = self.docker("commit", "--change", "ENV GIT_SHA=" + revision,
                                "--change", "LABEL manor.release.build=false",
                                "--change", "USER 1000:1000",
                                "--change", "CMD " + json.dumps(original_command),
                                image_container, self.policy["project"] + "-candidate:" + operation,
                                timeout=600).decode().strip()
        finally:
            self.docker("rm", "-f", image_container)
        self.verify_image(image)
        # Acceptance runs against the actual immutable image returned to the approver.
        acceptance = self.policy["project"] + "-acceptance"
        try:
            output = self.docker(
                "run", "--rm", "--name", acceptance, "--label", self.label,
                "--label", "manor.release.build=true", "--network", "none", "--read-only",
                "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--cpus", "1", "--memory", str(memory) + "m", "--memory-swap", str(memory) + "m",
                "--pids-limit", pids, "--workdir", "/app",
                "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=64m,uid=1000,gid=1000",
                image, *self.policy["testCommand"], timeout=timeout, max_output=MIB)
            evidence.update(output)
        finally:
            self._cleanup_builds()
        evidence.update(artifact_digest.digest())
        return {"imageId": image, "evidenceHash": evidence.hexdigest()}

    def compose(self, *args, image=None):
        # Same private/application-only boundary as core compose-update.ts; no --build or pull.
        argv = ["docker", "compose", "-p", self.policy["project"],
                "--env-file", self.policy["envFile"], "-f", self.policy["composeFile"]]
        if image:
            override = self.state / "image.json"
            override.write_text(canonical({"services": {s: {"image": image} for s in self.policy["services"]}}))
            argv += ["-f", str(override)]
        return run(argv + list(args), timeout=600)

    def current_image(self):
        images = set()
        for service in self.policy["services"]:
            container = self.compose("ps", "-q", service).decode().strip()
            stopped_bootstrap = not container and self.policy.get("unguardedBootstrapImage")
            if stopped_bootstrap:
                # Initial writers predate admission. Keep them stopped across backup
                # and replacement; only the operator-pinned old image may use this.
                container = self.compose("ps", "--all", "-q", service).decode().strip()
            if not container or "\n" in container:
                raise Refused("single_running_service_required")
            image = self.docker("inspect", "--format", "{{.Image}}", container).decode().strip()
            if stopped_bootstrap:
                state = json.loads(self.docker("inspect", "--format", "{{json .State}}", container))
                if (image != self.policy["unguardedBootstrapImage"] or state.get("Running") is not False
                        or state.get("Restarting") is not False or state.get("Pid") != 0):
                    raise Refused("stopped_bootstrap_image_required")
            images.add(image)
        if len(images) != 1:
            raise Refused("mixed_application_images")
        return images.pop()

    def activate(self, image):
        self.verify_image(image)
        if self.policy.get("productionAdmission") is True:
            # Resume application processes behind closed admission before Compose
            # replaces them. Ancillary producers stay frozen until release completes.
            self.maintenance("switch")
        self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never",
                     "--wait", "--wait-timeout", "120", *self.policy["services"], image=image)

    def health(self, image):
        if self.current_image() != image:
            raise Refused("deployed_image_mismatch")
        deadline = time.monotonic() + self.policy.get("healthTimeoutSeconds", 30)
        while time.monotonic() < deadline:
            try:
                probe = self.policy.get("healthProbe")
                if probe:
                    container = self.compose("ps", "-q", probe["service"]).decode().strip()
                    url = "http://127.0.0.1:" + str(probe["port"]) + probe["path"]
                    require_guard = "||s.maintenanceAdmission!==true" if self.policy.get("productionAdmission") is True and image != self.policy.get("unguardedBootstrapImage") else ""
                    code = "fetch(" + json.dumps(url) + ",{redirect:'error',signal:AbortSignal.timeout(3000)}).then(async r=>{const s=await r.json();if(!r.ok||s.ok!==true" + require_guard + ")process.exit(1)}).catch(()=>process.exit(1))"
                    self.docker("exec", container, "node", "-e", code, timeout=5, max_output=MIB)
                    return
                with urllib.request.urlopen(self.policy["healthUrl"], timeout=3) as response:
                    if response.status == 200 and json.load(response).get("ok") is True:
                        return
            except Exception:
                pass
            time.sleep(0.5)
        raise Refused("health_check_failed")

    def maintenance(self, action, payload=None):
        token = Path(self.policy["maintenanceTokenFile"]).read_text().strip()
        request = urllib.request.Request(
            self.policy["maintenanceUrl"].rstrip("/") + "/" + action,
            data=canonical(payload or {}).encode(), method="POST",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        )
        try:
            timeout = self.policy.get("backupTimeoutSeconds", 600) if action == "backup" else 10
            with urllib.request.urlopen(request, timeout=timeout) as response:
                value = json.load(response)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except urllib.error.HTTPError as response:
            error = Refused("maintenance_adapter_unavailable")
            error.diagnostic = response.read(4096).decode("utf-8", errors="replace")
            response.close()
            raise error from None
        except Exception:
            raise Refused("maintenance_adapter_unavailable") from None

    def close_admission(self, operation):
        if self.maintenance("close", {"operation": operation}).get("closed") is not True:
            raise Refused("admission_not_closed")

    def wait_drained(self):
        deadline = time.monotonic() + self.policy.get("drainTimeoutSeconds", 60)
        while time.monotonic() < deadline:
            state = self.maintenance("status")
            if state.get("closed") is not True:
                raise Refused("admission_not_closed")
            if state.get("active") == 0:
                return
            time.sleep(0.5)
        raise Refused("drain_timeout")

    def backup(self, operation):
        response = self.maintenance("backup", {"operation": operation})
        receipt = response.get("receipt")
        if response.get("verified") is not True or not isinstance(receipt, str) or not re.fullmatch(r"[0-9a-f]{64}", receipt):
            raise Refused("backup_unverified")
        return receipt

    def open_admission(self, operation):
        if self.maintenance("open", {"operation": operation}).get("closed") is not False:
            raise Refused("admission_not_open")

    def require_compatible(self, revision, action):
        # No automatic database restore. Production must explicitly allow the tested commit.
        if self.policy["mode"] != "production" or revision in self.policy.get("schemaCompatibleRevisions", []):
            return
        if self.policy.get("compatibilityPolicy") != "unchanged-schema-and-toolchain-v1":
            raise Refused("database_recovery_review_required")
        environment = json.loads(self.docker("image", "inspect", "--format", "{{json .Config.Env}}", self.current_image()))
        base = next((value.removeprefix("GIT_SHA=") for value in environment if value.startswith("GIT_SHA=")), "")
        if not COMMIT.fullmatch(base):
            raise Refused("running_revision_unknown")
        git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
               "-c", "safe.directory=" + self.policy["repository"], "-C", self.policy["repository"]]
        ancestor, descendant = (revision, base) if action == "rollback" else (base, revision)
        run(git + ["merge-base", "--is-ancestor", ancestor, descendant])
        changed = run(git + ["diff", "--name-only", "-z", base, revision], max_output=65536).decode().split("\x00")
        if not automatic_source_compatible(changed):
            raise Refused("separate_operator_release_required")
