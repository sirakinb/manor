"""Private workspace transport. No release, host-command or publication authority."""
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from docker_adapter import run
from release import COMMIT, Refused, canonical
from workspace import Workspace, heavy_lock
from source_policy import automatic_source_compatible


class WorkspaceBroker:
    def __init__(self, policy):
        self.policy = policy
        self.state = Path(policy["workspaceStateDir"])
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS operations(
                    id TEXT PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL,
                    result TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS workspaces(
                    id TEXT PRIMARY KEY, base TEXT NOT NULL, expires REAL NOT NULL);
            """)
            # Arbitrary container commands cannot be replayed after an uncertain exit.
            db.execute("UPDATE operations SET state='interrupted' WHERE state='running'")

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.state / "broker.sqlite", timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def submit(self, request):
        fields = {"create": {"revision"}, "exec": {"argv"}, "submit": set(),
                  "suspend": set(), "destroy": set(), "review": {"revision"}}
        if not isinstance(request, dict) or request.get("action") not in fields:
            raise Refused("invalid_workspace_action")
        if set(request) != {"requestId", "workspaceId", "action"} | fields[request["action"]]:
            raise Refused("invalid_workspace_fields")
        try:
            if str(uuid.UUID(request["requestId"])) != request["requestId"]:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise Refused("invalid_request_id") from None
        if not isinstance(request["workspaceId"], str) or not re.fullmatch(r"m[0-9a-f]{24}", request["workspaceId"]):
            raise Refused("invalid_workspace_id")
        if "revision" in request and (not isinstance(request["revision"], str) or not COMMIT.fullmatch(request["revision"])):
            raise Refused("exact_revision_required")
        if "argv" in request:
            args = request["argv"]
            if (not isinstance(args, list) or not 1 <= len(args) <= 100
                    or any(not isinstance(arg, str) or len(arg) > 32768 or "\x00" in arg for arg in args)):
                raise Refused("invalid_container_command")
        body = canonical(request)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT body FROM operations WHERE id=?", (request["requestId"],)).fetchone()
            if previous and previous[0] != body:
                raise Refused("request_id_conflict")
            if not previous:
                if db.execute("SELECT count(*) FROM operations WHERE state IN ('queued','running')").fetchone()[0] >= 8:
                    raise Refused("workspace_queue_full")
                db.execute("INSERT INTO operations VALUES (?,?,'queued',NULL,?)", (request["requestId"], body, time.time()))
        return self.operation(request["requestId"])

    def operation(self, request_id):
        with self.connect() as db:
            row = db.execute("SELECT state,result FROM operations WHERE id=?", (request_id,)).fetchone()
        if not row:
            raise Refused("operation_not_found")
        return {"requestId": request_id, "state": row[0], "result": json.loads(row[1]) if row[1] else None}

    def process(self):
        if not self.lock.acquire(blocking=False):
            return
        try:
            with self.connect() as db:
                row = db.execute("SELECT id,body FROM operations WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
                if not row:
                    return
                db.execute("UPDATE operations SET state='running' WHERE id=?", (row[0],))
            try:
                with heavy_lock():
                    result = self.execute(json.loads(row[1]))
                state = "succeeded"
            except Exception as error:
                # Raw command output is private evidence, never an error identifier.
                result = {"error": str(error) if isinstance(error, Refused) else "workspace_error"}
                state = "failed"
            with self.connect() as db:
                db.execute("UPDATE operations SET state=?,result=? WHERE id=?", (state, canonical(result), row[0]))
        finally:
            self.lock.release()

    def execute(self, request):
        workspace_id, action = request["workspaceId"], request["action"]
        workspace = Workspace(self.state / "volumes", workspace_id)
        with self.connect() as db:
            record = db.execute("SELECT base,expires FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if action == "destroy":
            result = workspace.destroy()
            with self.connect() as db:
                db.execute("DELETE FROM workspaces WHERE id=?", (workspace_id,))
            return result
        if action == "create":
            if record:
                raise Refused("workspace_already_exists")
            # The backend fixes the base to the running revision; arbitrary source is
            # still confined by the same source validation and container policy.
            with self.connect() as db:
                db.execute("INSERT INTO workspaces VALUES (?,?,?)", (workspace_id, request["revision"], time.time() + 3600))
            return workspace.create(self.policy["repository"], request["revision"],
                                    self.policy["toolchainImage"], self.policy["postgresImage"], 18080)
        if not record or record[1] < time.time():
            raise Refused("workspace_expired")
        if action == "exec":
            try:
                output = workspace.docker("exec", "--user", "1000:1000", workspace.name,
                                          *request["argv"], timeout=60, max_output=256 * 1024)
                return {"ok": True, "output": output.decode("utf-8", errors="replace")}
            except Refused as error:
                return {"ok": False, "output": getattr(error, "diagnostic", "")[:8192], "error": str(error)}
        if action == "submit":
            return workspace.submit(self.policy["repository"])
        if action == "suspend":
            return workspace.suspend()
        if action == "review":
            revision, base = request["revision"], record[0]
            git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
                   "-c", "safe.directory=" + self.policy["repository"], "-C", self.policy["repository"]]
            # Only the commit imported for this workspace may be reviewed.
            ref = "refs/manor-workspaces/" + workspace_id + "/" + revision
            if run(git + ["rev-parse", "--verify", ref]).decode().strip() != revision:
                raise Refused("workspace_revision_mismatch")
            run(git + ["merge-base", "--is-ancestor", base, revision])
            files = run(git + ["diff", "--name-only", "-z", base, revision], max_output=65536).decode().split("\x00")
            files = [name for name in files if name]
            # Infrastructure, dependency and native updates need a separate operator
            # release. Candidate code cannot replace its own trusted executor/policy.
            compatible = automatic_source_compatible(files)
            diff = run(git + ["diff", "--no-ext-diff", "--no-textconv", base, revision], max_output=200000).decode("utf-8", errors="replace")
            return {"baseRevision": base, "revision": revision, "diff": diff,
                    "compatible": compatible, "files": files,
                    "diffHash": hashlib.sha256(diff.encode()).hexdigest()}
        raise Refused("unknown_workspace_action")

    def expire(self):
        # Expiry runs under the same heavy lock as builds/commands. State is removed
        # only after containers are gone; failed cleanup remains retryable.
        if not self.lock.acquire(blocking=False):
            return
        try:
            with self.connect() as db:
                ids = [row[0] for row in db.execute("SELECT id FROM workspaces WHERE expires<?", (time.time(),))]
            for workspace_id in ids:
                with heavy_lock():
                    self.execute({"workspaceId": workspace_id, "action": "destroy"})
        finally:
            self.lock.release()
