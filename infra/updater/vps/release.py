#!/usr/bin/env python3
"""Linux release controller. Stdlib only; untrusted source never executes on the host."""
import argparse
import contextlib
import fcntl
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

COMMIT = re.compile(r"[0-9a-f]{40}")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}")
FIELDS = {
    "prepare": {"revision"},
    "approve": {"releaseId", "manifestHash"},
    "deploy": {"releaseId", "manifestHash"},
    "rollback": {"releaseId", "manifestHash"},
    "recover": set(),
}
OWNER = {"approve", "rollback", "recover"}


class Refused(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def validate(request):
    if not isinstance(request, dict):
        raise Refused("invalid_request")
    action = request.get("action")
    if not isinstance(action, str) or action not in FIELDS:
        raise Refused("invalid_action")
    if set(request) != {"requestId", "action"} | FIELDS[action]:
        raise Refused("invalid_fields")
    try:
        if str(uuid.UUID(request["requestId"])) != request["requestId"]:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise Refused("invalid_request_id") from None
    if action == "prepare":
        if not isinstance(request["revision"], str) or not COMMIT.fullmatch(request["revision"]):
            raise Refused("exact_revision_required")
    elif action in {"approve", "deploy", "rollback"}:
        if not isinstance(request["releaseId"], str) or not re.fullmatch(r"[0-9a-f]{64}", request["releaseId"]):
            raise Refused("invalid_release_id")
        if not isinstance(request["manifestHash"], str) or not re.fullmatch(r"[0-9a-f]{64}", request["manifestHash"]):
            raise Refused("invalid_manifest_hash")
    return request


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / "releases.sqlite"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS operations(
                    id TEXT PRIMARY KEY, body TEXT NOT NULL, role TEXT NOT NULL,
                    state TEXT NOT NULL, release_id TEXT, error TEXT,
                    created REAL NOT NULL, updated REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS operations_pending ON operations(state,created);
                CREATE TABLE IF NOT EXISTS releases(
                    id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS journal(
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    at REAL NOT NULL, operation TEXT NOT NULL, event TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deployment(
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
            """)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextlib.contextmanager
    def lock(self):
        with (self.directory / "executor.lock").open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Refused("executor_busy") from None
            yield

    def operation(self, operation_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if row is None:
            raise Refused("operation_not_found")
        return {
            "requestId": row["id"], "action": json.loads(row["body"])["action"],
            "state": row["state"], "releaseId": row["release_id"], "error": row["error"],
            "createdAt": row["created"], "updatedAt": row["updated"],
        }

    def history(self):
        with self.connect() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM operations ORDER BY created DESC LIMIT 100")]
        return [self.operation(operation_id) for operation_id in ids]

    def deployment(self):
        with self.connect() as db:
            row = db.execute("SELECT body FROM deployment WHERE singleton=1").fetchone()
        journal = self.journal()
        return {
            "current": json.loads(row[0]) if row else None,
            "recovery": {"phase": journal["phase"], "requestId": journal["operation"]} if journal else None,
        }

    def releases(self):
        with self.connect() as db:
            rows = db.execute("SELECT body FROM releases ORDER BY rowid DESC LIMIT 100").fetchall()
        return [json.loads(row[0]) for row in rows]

    def release(self, release_id):
        with self.connect() as db:
            row = db.execute("SELECT body FROM releases WHERE id=?", (release_id,)).fetchone()
        if row is None:
            raise Refused("release_not_found")
        return json.loads(row[0])

    def save_release(self, release):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO releases VALUES (?,?)",
                       (release["releaseId"], canonical(release)))

    def journal(self, value=None, clear=False):
        with self.connect() as db:
            if clear:
                db.execute("DELETE FROM journal")
            elif value is not None:
                db.execute("INSERT OR REPLACE INTO journal VALUES (1,?)", (canonical(value),))
            row = db.execute("SELECT body FROM journal WHERE singleton=1").fetchone()
        return json.loads(row[0]) if row else None

    def event(self, operation_id, event):
        with self.connect() as db:
            db.execute("INSERT INTO events(at,operation,event) VALUES (?,?,?)",
                       (time.time(), operation_id, event))

    def record_error(self, error):
        # Operator-only, bounded diagnostics must never disrupt durable operation state.
        with contextlib.suppress(OSError):
            path = self.directory / "last-error.txt"
            record = {
                "at": time.time(), "code": str(error)[:512],
                "diagnostic": getattr(error, "diagnostic", "")[-7000:],
            }
            # Bound the encoded document, preserving the diagnostic tail and valid JSON.
            while len(canonical(record).encode("utf-8")) > 8192:
                record["diagnostic"] = record["diagnostic"][256:]
            path.write_text(canonical(record))
            path.chmod(0o600)

    def finish(self, operation_id, state, release_id=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE operations SET state=?,release_id=?,error=?,updated=? WHERE id=?",
                       (state, release_id, error, time.time(), operation_id))


class Controller:
    def __init__(self, store, adapter, policy_hash):
        self.store, self.adapter, self.policy_hash = store, adapter, policy_hash

    def submit(self, request, role):
        validate(request)
        if role not in {"owner", "developer"} or (request["action"] in OWNER and role != "owner"):
            raise Refused("owner_required")
        body = canonical(request)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT body FROM operations WHERE id=?", (request["requestId"],)).fetchone()
            if row and row[0] != body:
                raise Refused("request_id_conflict")
            if not row:
                queued = db.execute("SELECT count(*) FROM operations WHERE state IN ('queued','running')").fetchone()[0]
                if queued >= 32:
                    raise Refused("queue_full")
                now = time.time()
                db.execute("INSERT INTO operations VALUES (?,?,?,'queued',NULL,NULL,?,?)",
                           (request["requestId"], body, role, now, now))
        return self.store.operation(request["requestId"])

    def poll(self):
        try:
            self.process()
        except Exception as error:
            self.store.record_error(error)

    def process(self):
        """One executor owns the lock through external effects, including child cleanup."""
        with self.store.lock():
            with self.store.connect() as db:
                db.execute("UPDATE operations SET state='interrupted',error='executor_restarted',updated=? WHERE state='running'",
                           (time.time(),))
            self.adapter.cleanup_builds()
            while True:
                with self.store.connect() as db:
                    row = db.execute("SELECT * FROM operations WHERE state='queued' ORDER BY created,rowid LIMIT 1").fetchone()
                    if row is None:
                        return
                    db.execute("UPDATE operations SET state='running',updated=? WHERE id=?", (time.time(), row["id"]))
                request = json.loads(row["body"])
                self.store.event(row["id"], "started")
                try:
                    release_id = self.execute(request, row["role"])
                    self.store.finish(row["id"], "succeeded", release_id)
                    self.store.event(row["id"], "succeeded")
                except Exception as error:
                    # No command output, secrets, paths or exception text crosses the public boundary.
                    code = str(error) if isinstance(error, Refused) else "executor_error"
                    self.store.record_error(error)
                    self.store.finish(row["id"], "failed", request.get("releaseId"), code)
                    self.store.event(row["id"], code)

    def execute(self, request, role):
        action = request["action"]
        if action in OWNER and role != "owner":
            raise Refused("owner_required")
        if action == "prepare":
            artifact = self.adapter.prepare(request["revision"], request["requestId"])
            if not IMAGE.fullmatch(artifact["imageId"]):
                raise Refused("immutable_image_required")
            manifest = {
                "revision": request["revision"], "imageId": artifact["imageId"],
                "evidenceHash": artifact["evidenceHash"], "policyHash": self.policy_hash,
            }
            release_id = digest(manifest)
            try:
                self.store.release(release_id)
            except Refused:
                self.store.save_release({
                    **manifest, "releaseId": release_id, "manifestHash": release_id,
                    "state": "prepared", "approved": False, "createdAt": time.time(),
                })
            return release_id
        if action == "recover":
            journal = self.store.journal()
            if journal:
                self.restore(journal)
            return None
        release = self.store.release(request["releaseId"])
        if release["manifestHash"] != request["manifestHash"] or release["policyHash"] != self.policy_hash:
            raise Refused("approval_invalidated")
        self.adapter.verify_image(release["imageId"])
        if action == "approve":
            release["approved"] = True
            release["approvedAt"] = time.time()
            self.store.save_release(release)
            return release["releaseId"]
        if not release["approved"]:
            raise Refused("owner_approval_required")
        if self.store.journal():
            raise Refused("recovery_required")
        self.adapter.require_compatible(release["revision"], action)
        previous = self.adapter.current_image()
        self.adapter.verify_image(previous)
        with self.store.connect() as db:
            row = db.execute("SELECT body FROM deployment WHERE singleton=1").fetchone()
        accepted = json.loads(row[0]) if row else None
        if accepted and accepted["imageId"] != previous:
            raise Refused("deployment_drift")
        if action == "rollback":
            if not accepted or accepted.get("previousReleaseId") != release["releaseId"]:
                raise Refused("not_previous_release")
        if accepted and accepted.get("releaseId") == release["releaseId"]:
            return release["releaseId"]
        journal = {
            "operation": request["requestId"], "releaseId": release["releaseId"],
            "previousImageId": previous, "imageId": release["imageId"],
            "phase": "closing", "accepted": accepted,
        }
        self.store.journal(journal)
        try:
            self.adapter.close_admission(request["requestId"])
            self.adapter.wait_drained()
            journal["phase"] = "backup"
            self.store.journal(journal)
            journal["backupReceipt"] = self.adapter.backup(request["requestId"])
            if not journal["backupReceipt"]:
                raise Refused("backup_unverified")
            journal["phase"] = "switching"
            self.store.journal(journal)
            self.adapter.activate(release["imageId"])
            self.adapter.health(release["imageId"])
            journal["phase"] = "opening"
            self.store.journal(journal)
            self.adapter.open_admission(request["requestId"])
            deployment = {
                "releaseId": release["releaseId"], "imageId": release["imageId"],
                "previousReleaseId": accepted["releaseId"] if accepted else None,
                "previousImageId": previous,
                "backupReceipt": journal["backupReceipt"],
            }
            # Commit accepted deployment, release state and cleared recovery intent together.
            release["state"] = "deployed"
            with self.store.connect() as db:
                db.execute("INSERT OR REPLACE INTO deployment VALUES (1,?)", (canonical(deployment),))
                db.execute("INSERT INTO events(at,operation,event) VALUES (?,?,?)",
                           (time.time(), request["requestId"], "backup_verified:" + journal["backupReceipt"]))
                db.execute("INSERT OR REPLACE INTO releases VALUES (?,?)",
                           (release["releaseId"], canonical(release)))
                db.execute("DELETE FROM journal")
        except Exception:
            self.restore(journal)
            raise
        return release["releaseId"]

    def restore(self, journal):
        # Closing/backup never switched images. Reopening after drain refusal is safe.
        if journal["phase"] in {"switching", "opening", "recovering"}:
            journal["phase"] = "recovering"
            self.store.journal(journal)
            self.adapter.close_admission(journal["operation"])
            self.adapter.wait_drained()
            self.adapter.verify_image(journal["previousImageId"])
            self.adapter.activate(journal["previousImageId"])
            self.adapter.health(journal["previousImageId"])
        self.adapter.open_admission(journal["operation"])
        self.store.journal(clear=True)


def create_server(controller, tokens, port):
    if (len(tokens["owner"]) < 32 or len(tokens["developer"]) < 32
            or hmac.compare_digest(tokens["owner"], tokens["developer"])):
        raise Refused("distinct_strong_credentials_required")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            encoded = canonical(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def role(self):
            provided = self.headers.get("Authorization", "")
            for role, token in tokens.items():
                if hmac.compare_digest(provided.encode(), ("Bearer " + token).encode()):
                    return role
            raise Refused("unauthorized")

        def do_GET(self):
            try:
                if self.path == "/health":
                    return self.reply(200, {"ok": True, "version": 1})
                self.role()
                if self.path == "/v1/releases":
                    return self.reply(200, controller.store.releases())
                if self.path == "/v1/history":
                    return self.reply(200, controller.store.history())
                if self.path == "/v1/deployment":
                    return self.reply(200, controller.store.deployment())
                prefix = "/v1/operations/"
                if self.path.startswith(prefix):
                    return self.reply(200, controller.store.operation(self.path[len(prefix):]))
                return self.reply(404, {"error": "not_found"})
            except Refused as error:
                self.reply(401 if str(error) == "unauthorized" else 404, {"error": str(error)})

        def do_POST(self):
            try:
                role = self.role()
                if self.path != "/v1/operations":
                    return self.reply(404, {"error": "not_found"})
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384 or self.headers.get("Transfer-Encoding"):
                    raise Refused("invalid_body_size")
                request = json.loads(self.rfile.read(length))
                self.reply(202, controller.submit(request, role))
            except (ValueError, TypeError, json.JSONDecodeError):
                self.reply(400, {"error": "invalid_json"})
            except Refused as error:
                self.reply(401 if str(error) == "unauthorized" else 409, {"error": str(error)})

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

    class BoundedServer(ThreadingHTTPServer):
        slots = threading.BoundedSemaphore(16)

        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request)
                return
            try:
                super().process_request(request, client_address)
            except BaseException:
                self.slots.release()
                raise

        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()

    return BoundedServer(("127.0.0.1", port), Handler)


def serve(controller, tokens, port):
    server = create_server(controller, tokens, port)

    def worker():
        while True:
            controller.poll()
            time.sleep(0.5)

    threading.Thread(target=worker, daemon=True).start()
    server.serve_forever()


def main():
    from docker_adapter import DockerAdapter, load_policy
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("command", choices=["serve", "process", "request", "history"])
    parser.add_argument("--owner", action="store_true", help="Operator CLI only; never expose this CLI to agents")
    args = parser.parse_args()
    policy = load_policy(args.policy)
    store = Store(policy["stateDir"])
    controller = Controller(store, DockerAdapter(policy), digest(policy))
    if args.command == "serve":
        tokens = {role: Path(policy[role + "TokenFile"]).read_text().strip() for role in ("owner", "developer")}
        serve(controller, tokens, policy.get("port", 7093))
    elif args.command == "request":
        import sys
        print(canonical(controller.submit(json.load(sys.stdin), "owner" if args.owner else "developer")))
    elif args.command == "process":
        controller.process()
    else:
        print(canonical(store.history()))


if __name__ == "__main__":
    main()
