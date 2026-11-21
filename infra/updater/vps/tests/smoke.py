#!/usr/bin/env python3
"""Explicit opt-in Docker/loop-device rehearsal using only synthetic resources."""
import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "fixtures"))
from docker_adapter import DockerAdapter, load_policy, run
from release import Controller, Store, canonical, digest
from workspace import Workspace, heavy_lock
from gate import Gate, start


def container_report(name, volume=None):
    """State and recent logs of a synthetic container, printed when a wait gives up."""
    lines = ["--- " + name]
    try:
        state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", name]))
        lines.append("state: " + json.dumps({key: state.get(key) for key in (
            "Status", "Running", "Restarting", "ExitCode", "OOMKilled", "Error", "StartedAt", "FinishedAt")}))
    except Exception as error:  # The report must never hide the original failure.
        lines.append("inspect failed: " + str(error))
    try:
        # Postgres logs to stderr, which run() keeps only for failures, so read both streams here.
        logs = subprocess.run(["docker", "logs", "--tail", "40", name], capture_output=True, timeout=30)
        lines.append("last log lines:\n" + (logs.stdout + logs.stderr).decode("utf-8", errors="replace"))
    except Exception as error:
        lines.append("logs failed: " + str(error))
    if volume is not None:
        usage = shutil.disk_usage(volume)
        lines.append("workspace filesystem: %d MiB used, %d MiB free of %d MiB" % (
            usage.used // 2**20, usage.free // 2**20, usage.total // 2**20))
        for part in ("repository.git", "tree", "postgres", "data"):
            try:
                size = run(["du", "-sm", str(Path(volume) / part)]).decode().split()[0]
                lines.append("  %s: %s MiB" % (part, size))
            except Exception:
                pass
    print("\n".join(lines), file=sys.stderr, flush=True)


def wait_until(check, attempts, delay, failure, containers):
    """Retries check; on giving up, reports each (name, volume) container, then raises."""
    for _ in range(attempts):
        try:
            check()
            return
        except Exception:
            time.sleep(delay)
    for name, volume in containers:
        container_report(name, volume)
    raise RuntimeError(failure)


def request(controller, action, **fields):
    operation = {"requestId": str(uuid.uuid4()), "action": action, **fields}
    controller.submit(operation, "owner")
    controller.process()
    result = controller.store.operation(operation["requestId"])
    if result["state"] != "succeeded":
        raise RuntimeError(canonical(result))
    return result


def approve(controller, revision):
    prepared = request(controller, "prepare", revision=revision)
    release = controller.store.release(prepared["releaseId"])
    config = json.loads(controller.adapter.docker("image", "inspect", "--format", "{{json .Config}}", release["imageId"]))
    assert config["User"] == "1000:1000"
    assert config["Labels"]["manor.release.build"] == "false"
    assert not (controller.adapter.state / "build.ext4").exists()
    request(controller, "approve", releaseId=release["releaseId"], manifestHash=release["manifestHash"])
    return release


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--toolchain", required=True)
    parser.add_argument("--postgres-image", required=True)
    parser.add_argument("--state", required=True)
    args = parser.parse_args()
    state = Path(args.state)
    if state.exists():
        raise RuntimeError("Use a new isolated state directory for each rehearsal")
    state.mkdir(mode=0o700, parents=True)
    workspace = Workspace(state / "workspaces", "rehearsal")
    with heavy_lock():
        workspace.create(args.repository, args.revision, args.toolchain, args.postgres_image, 18080)
    for name in (workspace.name, workspace.name + "-db"):
        container = json.loads(workspace.docker("inspect", name))[0]
        assert container["HostConfig"]["ReadonlyRootfs"]
        assert container["HostConfig"]["Memory"] > 0
        assert not any(mount["Destination"] == "/var/run/docker.sock" for mount in container["Mounts"])
    print("workspace: isolated source, synthetic Postgres, bounded storage and private bridge preview", flush=True)
    command = ["git", "-c", "user.name=Manor contributors", "-c", "user.email=contributors@example.invalid"]
    workspace.execute(command + ["config", "user.name", "Manor contributors"])
    workspace.execute(command + ["config", "user.email", "contributors@example.invalid"])
    # Wait for the brand-new synthetic database, without consulting production.
    volume = workspace.read()["volume"]
    wait_until(
        lambda: workspace.docker("exec", workspace.name + "-db", "pg_isready", "-h", "127.0.0.1",
                                 "-U", "synthetic", "-d", "synthetic"),
        60, 0.5, "Synthetic database did not become ready", [(workspace.name + "-db", volume)])
    workspace.docker("exec", workspace.name + "-db", "psql", "-U", "synthetic", "-d", "synthetic",
                     "-c", "CREATE TABLE rehearsal(value text); INSERT INTO rehearsal VALUES ('synthetic only');")
    workspace.execute(["python3", "-c",
                       "from pathlib import Path; Path('infra/updater/vps/fixtures/revision.txt').write_text('remote-edit\\n')"])
    workspace.execute(["python3", "-m", "unittest", "discover", "-s", "infra/updater/vps/tests"])
    workspace.execute(command + ["add", "infra/updater/vps/fixtures/revision.txt"])
    workspace.execute(command + ["commit", "-m", "Exercise synthetic remote development"])
    committed = workspace.submit(args.repository)["revision"]
    workspace.docker("exec", "-d", workspace.name, "node", "/app/infra/updater/vps/fixtures/app.mjs")
    config = workspace.read()
    preview_url = workspace.preview_url()
    def preview_health():
        with urllib.request.urlopen(preview_url + "/health", timeout=2):
            pass
    wait_until(preview_health, 30, 0.3, "Workspace preview did not answer",
               [(workspace.name, workspace.read()["volume"])])
    try:
        urllib.request.urlopen(preview_url, timeout=3)
        raise AssertionError("Preview allowed unauthenticated access")
    except urllib.error.HTTPError as error:
        assert error.code == 401
    preview_request = urllib.request.Request(preview_url, headers={"Authorization": "Bearer " + config["previewToken"]})
    with urllib.request.urlopen(preview_request, timeout=3) as response:
        assert "remote-edit" in response.read().decode()
    print("remote edit -> offline tests -> authenticated preview: passed", flush=True)
    release_rehearsal(state, args, committed, workspace)


def release_rehearsal(state, args, committed, workspace):
    # Suspend the preview during heavy builds and reuse the same shared job lock.
    workspace.suspend()
    workspace.docker("start", workspace.name + "-db")
    gate_token = secrets.token_hex(32)
    token_file = state / "maintenance.token"
    token_file.write_text(gate_token)
    token_file.chmod(0o600)
    gate = Gate(state / "gate", workspace.name + "-db")
    gate_server = start(gate, gate_token, 18082)
    try:
        env = state / "stack.env"
        env.write_text("PREVIEW_TOKEN=" + secrets.token_hex(32) + "\n")
        env.chmod(0o600)
        compose = state / "compose.json"
        compose.write_text(canonical({
            "services": {"app": {
                "image": args.toolchain,
                "command": ["node", "/app/infra/updater/vps/fixtures/app.mjs"],
                "user": "1000:1000", "read_only": True, "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"], "mem_limit": "128m",
                "cpus": 0.25, "pids_limit": 64,
                "environment": {"PREVIEW_TOKEN": "${PREVIEW_TOKEN}"},
                "networks": ["private"],
                "logging": {"driver": "local", "options": {"max-size": "1m", "max-file": "2"}},
            }},
            "networks": {"private": {"internal": True}},
        }))
        compose.chmod(0o600)
        credential_files = {}
        for role in ("owner", "developer"):
            path = state / (role + ".token")
            path.write_text(secrets.token_hex(32))
            path.chmod(0o600)
            credential_files[role + "TokenFile"] = str(path)
        policy = {
            **credential_files,
            "mode": "isolated", "stateDir": str(state / "controller"),
            "repository": args.repository, "toolchainImage": args.toolchain,
            "composeFile": str(compose), "envFile": str(env),
            "project": "manor-test-rehearsal", "services": ["app"],
            "testCommand": ["python3", "-m", "unittest", "discover", "-s", "infra/updater/vps/tests"],
            "buildCommand": ["node", "--check", "infra/updater/vps/fixtures/app.mjs"],
            "buildMemoryMb": 256,
            "maintenanceUrl": "http://127.0.0.1:18082",
            "maintenanceTokenFile": str(token_file),
            "healthProbe": {"service": "app", "port": 5173, "path": "/health"},
            "drainTimeoutSeconds": 3,
        }
        policy_file = state / "policy.json"
        policy_file.write_text(canonical(policy))
        policy_file.chmod(0o600)
        adapter = DockerAdapter(load_policy(policy_file))
        controller = Controller(Store(policy["stateDir"]), adapter, digest(policy))
        first = approve(controller, args.revision)
        adapter.activate(first["imageId"])  # Explicit synthetic initial stack bootstrap.
        adapter.health(first["imageId"])
        request(controller, "deploy", releaseId=first["releaseId"], manifestHash=first["manifestHash"])
        second = approve(controller, committed)
        gate.action("start", {"id": "synthetic-active-work"})
        blocked_id = str(uuid.uuid4())
        controller.submit({"requestId": blocked_id, "action": "deploy",
                           "releaseId": second["releaseId"], "manifestHash": second["manifestHash"]}, "developer")
        controller.process()
        assert controller.store.operation(blocked_id)["error"] == "drain_timeout"
        assert adapter.current_image() == first["imageId"]
        gate.action("finish", {"id": "synthetic-active-work"})
        deployed = request(controller, "deploy", releaseId=second["releaseId"], manifestHash=second["manifestHash"])
        assert adapter.current_image() == second["imageId"]
        # Polling through a fresh controller reads durable state; duplicate submission stays unchanged.
        restarted = Controller(Store(policy["stateDir"]), adapter, digest(policy))
        assert restarted.store.operation(deployed["requestId"])["state"] == "succeeded"
        duplicate = {"requestId": deployed["requestId"], "action": "deploy",
                     "releaseId": second["releaseId"], "manifestHash": second["manifestHash"]}
        restarted.submit(duplicate, "developer")
        restarted.process()
        request(restarted, "rollback", releaseId=first["releaseId"], manifestHash=first["manifestHash"])
        assert adapter.current_image() == first["imageId"]
        adapter.health(first["imageId"])
        print("isolated deployment, active-work refusal, verified backup, durable retry and application rollback: passed", flush=True)
        assert list((state / "gate").glob("*.dump"))
        receipt = {
            "remoteWorkflow": "passed", "deploymentRollback": "passed",
            "testedRevision": args.revision, "editedRevision": committed,
            "databaseRecovery": "not performed; verified synthetic dumps retained",
        }
        (state / "verification.json").write_text(canonical(receipt))
        print(canonical(receipt), flush=True)
    finally:
        gate_server.shutdown()


if __name__ == "__main__":
    main()
