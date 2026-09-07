"""Synthetic maintenance adapter for release conformance; never use for production."""
import hashlib
import json
import re
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docker_adapter import run
from release import Refused, canonical


class Gate:
    def __init__(self, state, database_container):
        if not re.fullmatch(r"manor-dev-[a-z0-9-]+-db", database_container):
            raise Refused("synthetic_database_required")
        self.state = Path(state)
        self.state.mkdir(exist_ok=True, parents=True)
        self.container = database_container
        with self.connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS gate(id INTEGER PRIMARY KEY, closed INTEGER NOT NULL);
              INSERT OR IGNORE INTO gate VALUES(1,0);
              CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY);
              CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, receipt TEXT NOT NULL);
            """)

    def connect(self):
        db = sqlite3.connect(self.state / "gate.sqlite", timeout=10)
        db.execute("PRAGMA synchronous=FULL")
        return db

    def action(self, action, payload):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            closed = bool(db.execute("SELECT closed FROM gate WHERE id=1").fetchone()[0])
            active = db.execute("SELECT count(*) FROM jobs").fetchone()[0]
            if action == "close":
                db.execute("UPDATE gate SET closed=1 WHERE id=1")
                return {"closed": True}
            if action == "open":
                db.execute("UPDATE gate SET closed=0 WHERE id=1")
                return {"closed": False}
            if action == "status":
                return {"closed": closed, "active": active}
            if action == "start":
                if closed:
                    raise Refused("admission_closed")
                db.execute("INSERT INTO jobs VALUES (?)", (payload["id"],))
                return {"accepted": True}
            if action == "finish":
                db.execute("DELETE FROM jobs WHERE id=?", (payload["id"],))
                return {"finished": True}
            if action == "backup":
                if not closed or active:
                    raise Refused("safe_backup_boundary_required")
                operation = payload["operation"]
                if not re.fullmatch(r"[0-9a-f-]{36}", operation):
                    raise Refused("invalid_operation")
                existing = db.execute("SELECT receipt FROM backups WHERE id=?", (operation,)).fetchone()
                if existing:
                    return {"verified": True, "receipt": existing[0]}
                dump = run(["docker", "exec", self.container, "pg_dump", "-Fc",
                            "--no-owner", "--no-privileges", "-U", "synthetic", "synthetic"])
                run(["docker", "exec", "-i", self.container, "pg_restore", "--list"], data=dump)
                receipt = hashlib.sha256(dump).hexdigest()
                (self.state / (operation + ".dump")).write_bytes(dump)
                db.execute("INSERT INTO backups VALUES (?,?)", (operation, receipt))
                return {"verified": True, "receipt": receipt}
            raise Refused("unknown_action")


def start(gate, token, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            import hmac
            status = 200
            try:
                actual = self.headers.get("Authorization", "").encode()
                if not hmac.compare_digest(actual, ("Bearer " + token).encode()):
                    raise Refused("unauthorized")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 <= length <= 16384:
                    raise Refused("invalid_body")
                value = gate.action(self.path.lstrip("/"), json.loads(self.rfile.read(length)))
            except Exception:
                status, value = 409, {"error": "refused"}
            data = canonical(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
