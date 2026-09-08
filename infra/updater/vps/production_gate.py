"""Durable admission and operator-only backup boundary for production."""
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import threading
from pathlib import Path

from docker_adapter import admission, quota_directory, run
from release import Refused, canonical


class ProductionGate:
    def __init__(self, policy):
        self.policy = policy
        self.state = Path(policy["gateStateDir"])
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS gate(id INTEGER PRIMARY KEY, closed INTEGER NOT NULL, operation TEXT);
              INSERT OR IGNORE INTO gate VALUES(1,0,NULL);
              CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, instance TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS paused(id TEXT PRIMARY KEY);
              CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, receipt TEXT NOT NULL);
            """)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.state / "admission.sqlite", timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def action(self, action, payload, role):
        if role == "application":
            if action not in {"enter", "leave", "probe"}:
                raise Refused("operator_required")
        elif role != "operator":
            raise Refused("unauthorized")
        with self.lock:
            if action == "backup":
                return self.backup(payload)
            if action == "open":
                return self.open(payload)
            if action == "switch":
                return self.switch()
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                closed, operation = db.execute("SELECT closed,operation FROM gate WHERE id=1").fetchone()
                if action == "probe":
                    return {"ready": True}
                if action in {"enter", "leave"}:
                    lease = payload.get("id", "")
                    instance = payload.get("instance", "")
                    if not isinstance(lease, str) or not re.fullmatch(r"[0-9a-f-]{36}", lease) or not isinstance(instance, str) or not re.fullmatch(r"[0-9a-f]{12,64}", instance):
                        raise Refused("invalid_lease")
                    if action == "leave":
                        db.execute("DELETE FROM leases WHERE id=? AND instance=?", (lease, instance))
                        return {"released": True}
                    if closed:
                        raise Refused("admission_closed")
                    old = db.execute("SELECT instance FROM leases WHERE id=?", (lease,)).fetchone()
                    if old and old[0] != instance:
                        raise Refused("lease_conflict")
                    db.execute("INSERT OR IGNORE INTO leases VALUES (?,?)", (lease, instance))
                    return {"accepted": True}
                if action == "close":
                    requested = payload.get("operation", "")
                    if not isinstance(requested, str) or not re.fullmatch(r"[0-9a-f-]{36}", requested):
                        raise Refused("invalid_operation")
                    if closed and operation != requested:
                        raise Refused("another_release_pending")
                    db.execute("UPDATE gate SET closed=1,operation=? WHERE id=1", (requested,))
                    return {"closed": True}
                if action == "status":
                    # No time-based expiry: a delayed writer must never outlive its
                    # lease. A removed/stopped container cannot retain a live writer.
                    if closed and self.policy.get("project"):
                        for (instance,) in db.execute("SELECT DISTINCT instance FROM leases").fetchall():
                            ids = run(["docker", "ps", "-aq", "--no-trunc", "--filter", "id=" + instance]).decode().split()
                            stopped = not ids
                            if len(ids) == 1:
                                state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", ids[0]]))
                                stopped = state.get("Running") is False and state.get("Restarting") is False and state.get("Pid") == 0
                            if stopped:
                                db.execute("DELETE FROM leases WHERE instance=?", (instance,))
                    return {"closed": bool(closed), "active": db.execute("SELECT count(*) FROM leases").fetchone()[0]}
                raise Refused("unknown_admission_action")

    def producer_ids(self):
        result = set()
        for service in self.policy["producerServices"]:
            output = run(["docker", "ps", "-q", "--no-trunc", "--filter", "label=com.docker.compose.project=" + self.policy["project"],
                          "--filter", "label=com.docker.compose.service=" + service]).decode().split()
            result.update(output)
        # Computers can keep background processes alive after a run finishes.
        # Scope by the operator-selected production screen network, never all Docker.
        network = json.loads(run(["docker", "network", "inspect", self.policy["computerNetwork"]]))[0]
        result.update(network.get("Containers", {}).keys())
        return sorted(result)

    def backup(self, payload):
        operation = payload.get("operation", "")
        with self.connect() as db:
            closed, current = db.execute("SELECT closed,operation FROM gate WHERE id=1").fetchone()
            if not closed or operation != current or db.execute("SELECT count(*) FROM leases").fetchone()[0]:
                raise Refused("safe_backup_boundary_required")
            prior = db.execute("SELECT receipt FROM backups WHERE id=?", (operation,)).fetchone()
            if prior:
                return {"verified": True, "receipt": prior[0]}
        admission(self.state, 256, disk_mb=self.policy.get("backupReserveMb", 4096))
        for container in self.producer_ids():
            paused = run(["docker", "inspect", "--format", "{{.State.Paused}}", container]).decode().strip()
            if paused != "true":
                with self.connect() as db:
                    db.execute("INSERT OR IGNORE INTO paused VALUES (?)", (container,))
                run(["docker", "pause", container])
        directory = self.state / operation
        directory.mkdir(mode=0o700, exist_ok=True)
        database = directory / "database.dump"
        # Stream private backup data to a private file, not diagnostic output/RAM.
        command = ["docker", "exec", self.policy["databaseContainer"], "pg_dump", "-Fc",
                   "--no-owner", "--no-privileges", "-U", self.policy["databaseUser"], self.policy["databaseName"]]
        with database.open("wb") as output, (directory / "backup-error.txt").open("wb") as errors:
            try:
                subprocess.run(command, stdout=output, stderr=errors, timeout=120, check=True)
            except (subprocess.SubprocessError, OSError):
                raise Refused("database_backup_failed") from None
            output.flush()
            os.fsync(output.fileno())
        # Verify a real restore in an isolated disposable database, not only a TOC.
        name = "manor-backup-check-" + operation
        postgres = self.policy["postgresImage"]
        restore = quota_directory(directory, "restore", 1024)
        restore_data = restore / "database"
        restore_data.mkdir(mode=0o700, exist_ok=True)
        run(["chown", "999:999", str(restore_data)])
        restore_failed = False
        try:
            run(["docker", "run", "-d", "--name", name, "--network", "none", "--read-only", "--user", "999:999",
                 "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "256m", "--memory-swap", "256m",
                 "--cpus", "0.5", "--pids-limit", "64", "--mount", "type=bind,src=" + str(restore_data) + ",dst=/var/lib/postgresql/data",
                 "--tmpfs", "/var/run/postgresql:rw,uid=999,gid=999,size=8m",
                 "--env", "POSTGRES_HOST_AUTH_METHOD=trust", postgres])
            import time
            for attempt in range(30):
                try:
                    # The image's temporary initialization server accepts Unix
                    # sockets before it restarts. TCP is ready only on the final server.
                    run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"])
                    break
                except Refused:
                    if attempt == 29:
                        raise Refused("backup_restore_unavailable") from None
                    time.sleep(0.5)
            with database.open("rb") as source, (directory / "restore-error.txt").open("wb") as errors:
                try:
                    subprocess.run(["docker", "exec", "-i", name, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                                    "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"], stdin=source, stdout=errors, stderr=errors, timeout=120, check=True)
                except (subprocess.SubprocessError, OSError):
                    raise Refused("database_restore_verification_failed") from None
        except BaseException:
            restore_failed = True
            raise
        finally:
            try:
                run(["docker", "rm", "-f", name])
                if os.path.ismount(restore):
                    run(["umount", str(restore)])
                restore.rmdir()
                (directory / "restore.ext4").unlink(missing_ok=True)
            except (Refused, OSError):
                # Preserve the original restore failure. A cleanup failure after a
                # successful restore must still refuse rollout and retain evidence.
                if not restore_failed:
                    raise Refused("backup_cleanup_failed") from None
        # A fixed trusted utility image reads only the application volume and writes
        # only this backup directory. No retention/pruning or production restore.
        run(["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
             "--cap-add", "DAC_READ_SEARCH",
             "--security-opt", "no-new-privileges", "--memory", "128m", "--pids-limit", "32",
             "--mount", "type=volume,src=" + self.policy["dataVolume"] + ",dst=/data,readonly",
             "--mount", "type=bind,src=" + str(directory) + ",dst=/backup",
             self.policy["backupImage"], "sh", "-c", "tar -czf /backup/application.tar.gz -C /data . && tar -tzf /backup/application.tar.gz >/dev/null"], timeout=120)
        hashes = {}
        for path in (database, directory / "application.tar.gz"):
            with path.open("rb") as source:
                hashes[path.name] = hashlib.file_digest(source, "sha256").hexdigest()
                os.fsync(source.fileno())
        receipt = hashlib.sha256(canonical(hashes).encode()).hexdigest()
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        with self.connect() as db:
            db.execute("INSERT INTO backups VALUES (?,?)", (operation, receipt))
        return {"verified": True, "receipt": receipt}

    def open(self, payload):
        with self.connect() as db:
            current = db.execute("SELECT operation FROM gate WHERE id=1").fetchone()[0]
            if current and current != payload.get("operation"):
                raise Refused("release_operation_mismatch")
            paused = [row[0] for row in db.execute("SELECT id FROM paused")]
        for container in paused:
            # Rollout can replace a paused application container. Missing is expected;
            # a present paused container must be unpaused before admission reopens.
            ids = run(["docker", "ps", "-aq", "--no-trunc", "--filter", "id=" + container]).decode().split()
            if container in ids:
                if run(["docker", "inspect", "--format", "{{.State.Paused}}", container]).decode().strip() == "true":
                    run(["docker", "unpause", container])
            with self.connect() as db:
                db.execute("DELETE FROM paused WHERE id=?", (container,))
        with self.connect() as db:
            db.execute("UPDATE gate SET closed=0,operation=NULL WHERE id=1")
        return {"closed": False}

    def switch(self):
        with self.connect() as db:
            closed, operation = db.execute("SELECT closed,operation FROM gate WHERE id=1").fetchone()
            if not closed or not db.execute("SELECT id FROM backups WHERE id=?", (operation,)).fetchone():
                raise Refused("verified_backup_required")
        for service in self.policy["services"]:
            ids = run(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + self.policy["project"],
                       "--filter", "label=com.docker.compose.service=" + service]).decode().split()
            for container in ids:
                if run(["docker", "inspect", "--format", "{{.State.Paused}}", container]).decode().strip() == "true":
                    run(["docker", "unpause", container])
        return {"closed": True}
