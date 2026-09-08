#!/usr/bin/env python3
"""Real Docker/backup/admission rehearsal. Creates only explicitly synthetic resources."""
import argparse
import hashlib
import json
import os
import secrets
import sys
import threading
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control import create_control_server
from docker_adapter import DockerAdapter, run
from production_gate import ProductionGate
from release import Controller, Refused, Store, canonical, digest

PROJECT = "manor-test-maintenance-guard"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--toolchain", required=True)
    parser.add_argument("--postgres-image", required=True)
    parser.add_argument("--backup-image", required=True)
    parser.add_argument("--state", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    state = Path(args.state)
    if state.exists() or run(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + PROJECT]).strip():
        raise RuntimeError("Use an unused synthetic project and state directory")
    state.mkdir(mode=0o700, parents=True)
    network, volume, database = PROJECT + "-computers", PROJECT + "-data", PROJECT + "-db"
    images = []
    server = None
    adapter = None
    try:
        run(["docker", "network", "create", "--internal", network])
        run(["docker", "volume", "create", volume])
        for value in ("healthy-a", "healthy-b", "unhealthy"):
            # Fixed synthetic metadata only; never evaluate a candidate Dockerfile.
            container = run(["docker", "create", args.toolchain, "node", "--version"]).decode().strip()
            try:
                images.append(run(["docker", "commit", "--change", "ENV FIXTURE_HEALTH=" + value,
                                   "--change", "LABEL manor.synthetic.guard=true", container],
                                  timeout=180).decode().strip())
            finally:
                run(["docker", "rm", container])
        run(["docker", "run", "--rm", "--network", "none", "--mount", "type=volume,src=" + volume + ",dst=/data",
             args.backup_image, "sh", "-c", "printf 'synthetic storage only\\n' > /data/fixture.txt"])
        pgdata = state / "database"
        pgdata.mkdir(mode=0o700)
        run(["chown", "999:999", str(pgdata)])
        run(["docker", "run", "-d", "--name", database, "--network", "none", "--read-only", "--user", "999:999",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--memory-swap", "128m",
             "--cpus", "0.25", "--pids-limit", "64", "--mount", "type=bind,src=" + str(pgdata) + ",dst=/var/lib/postgresql/data",
             "--tmpfs", "/var/run/postgresql:rw,uid=999,gid=999,size=8m", "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
             args.postgres_image, "postgres", "-c", "shared_buffers=16MB", "-c", "max_connections=10"])
        import time
        for attempt in range(60):
            try:
                run(["docker", "exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"])
                break
            except Refused:
                if attempt == 59:
                    raise
                time.sleep(0.5)
        run(["docker", "exec", database, "psql", "-U", "postgres", "-c",
             "CREATE TABLE synthetic_guard(value text); INSERT INTO synthetic_guard VALUES ('preserve across releases');"])
        fixture = "require('node:http').createServer((q,r)=>{const ok=process.env.FIXTURE_HEALTH!=='unhealthy';r.writeHead(ok?200:503,{'content-type':'application/json'});r.end(JSON.stringify({ok,maintenanceAdmission:process.env.FIXTURE_HEALTH==='healthy-a'?undefined:true}))}).listen(3100,'0.0.0.0')"
        compose = state / "compose.json"
        compose.write_text(canonical({"services": {"app": {"image": images[0], "command": ["node", "-e", fixture],
            "user": "1000:1000", "read_only": True, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
            "mem_limit": "128m", "cpus": 0.25, "pids_limit": 64, "networks": ["computers"],
            "volumes": ["data:/data:ro"]}}, "networks": {"computers": {"external": True, "name": network}},
            "volumes": {"data": {"external": True, "name": volume}}}))
        env = state / "stack.env"
        env.write_text("SYNTHETIC=1\n")
        token = secrets.token_hex(32)
        token_file = state / "operator.token"
        token_file.write_text(token)
        policy = {"mode": "isolated", "stateDir": str(state / "release"), "project": PROJECT,
            "composeFile": str(compose), "envFile": str(env), "services": ["app"], "producerServices": ["app"],
            "gateStateDir": str(state / "gate"), "computerNetwork": network, "databaseContainer": database,
            "databaseUser": "postgres", "databaseName": "postgres", "postgresImage": args.postgres_image,
            "backupImage": args.backup_image, "dataVolume": volume, "backupReserveMb": 1152,
            "maintenanceTokenFile": str(token_file), "productionAdmission": True, "unguardedBootstrapImage": images[0],
            "healthProbe": {"service": "app", "port": 3100, "path": "/health"},
            "healthTimeoutSeconds": 2, "drainTimeoutSeconds": 1}
        gate = ProductionGate(policy)
        server = create_control_server(("127.0.0.1", 0), None, None, gate, {"operator": token}, unix=False)
        policy["maintenanceUrl"] = "http://127.0.0.1:" + str(server.server_address[1]) + "/v1/admission"
        threading.Thread(target=server.serve_forever, daemon=True).start()

        class FixtureAdapter(DockerAdapter):
            # Build isolation is exercised by smoke.py. This fixture isolates the
            # real admission, snapshot/restore, pause/resume and rollout mechanisms.
            def prepare(self, revision, _operation):
                return {"imageId": images[int(revision[0])], "evidenceHash": hashlib.sha256(revision.encode()).hexdigest()}

        adapter = FixtureAdapter(policy)
        bootstrap = DockerAdapter({**policy, "productionAdmission": False})
        bootstrap.activate(images[0])
        adapter.health(images[0])
        controller = Controller(Store(policy["stateDir"]), adapter, digest(policy))

        def request(action, expect="succeeded", **fields):
            body = {"requestId": str(uuid.uuid4()), "action": action, **fields}
            controller.submit(body, "owner")
            controller.process()
            outcome = controller.store.operation(body["requestId"])
            assert outcome["state"] == expect, outcome
            return outcome

        releases = []
        for index in range(3):
            release_id = request("prepare", revision=str(index) * 40)["releaseId"]
            release = controller.store.release(release_id)
            request("approve", releaseId=release_id, manifestHash=release["manifestHash"])
            releases.append({"releaseId": release_id, "manifestHash": release["manifestHash"]})
        # The pre-admission application remains stopped through the first backup.
        adapter.compose("stop", "app")
        assert adapter.current_image() == images[0]
        request("deploy", **releases[0])
        assert gate.action("status", {}, "operator") == {"closed": False, "active": 0}
        assert request("deploy", expect="failed", **releases[2])["error"] == "health_check_failed"
        assert adapter.current_image() == images[0]
        assert not gate.action("status", {}, "operator")["closed"]
        lease = {"id": str(uuid.uuid4()), "instance": adapter.compose("ps", "-q", "app").decode().strip()[:12]}
        gate.action("enter", lease, "application")
        assert request("deploy", expect="failed", **releases[1])["error"] == "drain_timeout"
        assert adapter.current_image() == images[0]
        assert not gate.action("status", {}, "operator")["closed"]
        gate.action("leave", lease, "application")
        request("deploy", **releases[1])
        assert adapter.current_image() == images[1]
        assert request("deploy", expect="failed", **releases[2])["error"] == "health_check_failed"
        assert adapter.current_image() == images[1]
        assert not controller.store.journal()
        assert not gate.action("status", {}, "operator")["closed"]
        print("real admission, drain refusal, verified database restore, storage backup and failed-health rollback: passed", flush=True)

        interrupted = str(uuid.uuid4())
        gate.action("close", {"operation": interrupted}, "operator")
        receipt = gate.action("backup", {"operation": interrupted}, "operator")
        controller.store.journal({"operation": interrupted, "releaseId": releases[2]["releaseId"],
            "previousImageId": images[1], "imageId": images[2], "phase": "switching",
            "backupReceipt": receipt["receipt"], "accepted": controller.store.deployment()["current"]})
        adapter.activate(images[2])
        controller = Controller(Store(policy["stateDir"]), adapter, digest(policy))
        request("recover")
        assert adapter.current_image() == images[1]
        adapter.health(images[1])
        assert not controller.store.journal()
        assert not gate.action("status", {}, "operator")["closed"]
        data = run(["docker", "exec", database, "psql", "-U", "postgres", "-Atc", "SELECT value FROM synthetic_guard;"]).decode().strip()
        assert data == "preserve across releases"
        assert len(list((state / "gate").glob("*/database.dump"))) == 5
        assert all(not Path(path).exists() for path in (state / "gate").glob("*/restore.ext4"))
        verification = {"admission": "passed", "databaseRestore": "passed", "storageBackup": "passed",
                        "healthRollback": "passed", "restartRecovery": "passed", "productionTouched": False}
        (state / "verification.json").write_text(canonical(verification))
        print(canonical(verification), flush=True)
    finally:
        if adapter:
            with __import__("contextlib").suppress(Exception):
                adapter.compose("down", "--remove-orphans")
        if server:
            server.shutdown()
            server.server_close()
        for command in (["docker", "rm", "-f", database], ["docker", "network", "rm", network], ["docker", "volume", "rm", volume]):
            with __import__("contextlib").suppress(Exception):
                run(command)
        for image in images:
            with __import__("contextlib").suppress(Exception):
                run(["docker", "image", "rm", image])


if __name__ == "__main__":
    main()
