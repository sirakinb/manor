#!/usr/bin/env python3
"""Operator-installed Unix-socket bridge for maintenance, admission and release v1."""
import argparse
import contextlib
import fcntl
import hmac
import json
import os
import socketserver
import stat
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from docker_adapter import DockerAdapter, load_policy
from production_gate import ProductionGate
from release import Controller, Refused, Store, canonical, digest
from workspace_broker import WorkspaceBroker


def create_control_server(address, controller, broker, gate, tokens, unix=True):
    if any(len(token) < 32 for token in tokens.values()) or len(set(tokens.values())) != len(tokens):
        raise Refused("distinct_strong_credentials_required")

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_args):
            pass

        def handle_request(self):
            provided = self.headers.get("Authorization", "").encode()
            role = next((name for name, token in tokens.items()
                         if hmac.compare_digest(provided, ("Bearer " + token).encode())), None)
            if role is None:
                raise Refused("unauthorized")
            value = None
            if self.command == "POST":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 512 * 1024 or self.headers.get("Transfer-Encoding"):
                    raise Refused("invalid_body_size")
                value = json.loads(self.rfile.read(length))
                if not isinstance(value, dict):
                    raise Refused("invalid_body")
            if self.path.startswith("/v1/workspaces/"):
                if role != "workspace":
                    raise Refused("workspace_credential_required")
                if self.command == "POST" and self.path == "/v1/workspaces/operations":
                    return broker.submit(value)
                if self.command == "GET" and self.path.startswith("/v1/workspaces/operations/"):
                    return broker.operation(self.path.removeprefix("/v1/workspaces/operations/"))
            elif self.path.startswith("/v1/admission/"):
                if self.command == "POST":
                    return gate.action(self.path.removeprefix("/v1/admission/"), value, role)
            elif role in {"developer", "owner"}:
                if self.command == "POST" and self.path == "/v1/operations":
                    return controller.submit(value, role)
                if self.command == "GET":
                    if self.path == "/v1/releases":
                        return controller.store.releases()
                    if self.path == "/v1/history":
                        return controller.store.history()
                    if self.path == "/v1/deployment":
                        return controller.store.deployment()
                    if self.path.startswith("/v1/operations/"):
                        return controller.store.operation(self.path.removeprefix("/v1/operations/"))
            raise Refused("route_not_allowed")

        def respond(self):
            try:
                value, status = self.handle_request(), 200
            except Refused as error:
                if controller:
                    controller.store.record_error(error)
                value, status = {"error": str(error)}, 401 if str(error) == "unauthorized" else 409
            except (ValueError, TypeError):
                value, status = {"error": "invalid_request"}, 400
            except Exception as error:
                error.diagnostic = traceback.format_exc(limit=8)[-7000:]
                if controller:
                    controller.store.record_error(error)
                elif gate:
                    path = gate.state / "last-control-error.txt"
                    path.write_text(error.diagnostic)
                    path.chmod(0o600)
                value, status = {"error": "control_unavailable"}, 503
            encoded = canonical(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        do_POST = respond
        do_GET = respond

    class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    base = UnixServer if unix else ThreadingHTTPServer

    class BoundedServer(base):
        slots = threading.BoundedSemaphore(32)

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

    return BoundedServer(address, Handler)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    args = parser.parse_args()
    policy = load_policy(args.policy)
    state = Path(policy["stateDir"])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    # A second process must not mark a live broker command interrupted or replace
    # the active socket. Keep this descriptor for the full process lifetime.
    lock = (state / "control.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Refused("control_already_running") from None
    tokens = {}
    for role in ("owner", "developer", "workspace", "application", "operator"):
        path = Path(policy[role + "TokenFile"])
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Refused("private_operator_credentials_required")
        tokens[role] = path.read_text().strip()
    controller = Controller(Store(policy["stateDir"]), DockerAdapter(policy), digest(policy))
    broker, gate = WorkspaceBroker(policy), ProductionGate(policy)
    socket = Path(policy["controlSocket"])
    socket.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    # The private process umask must not make the socket unreachable to the app group.
    socket.parent.chmod(0o755)
    if socket.exists():
        if not stat.S_ISSOCK(socket.lstat().st_mode):
            raise Refused("control_socket_path_occupied")
        socket.unlink()
    server = create_control_server(str(socket), controller, broker, gate, tokens)
    os.chown(socket, 0, policy.get("applicationGroup", 1000))
    socket.chmod(0o660)
    # The release adapter uses its existing loopback HTTP contract for admission.
    loopback = create_control_server(("127.0.0.1", policy.get("gatePort", 7094)), controller, broker, gate,
                                     {"operator": tokens["operator"]}, unix=False)

    def release_worker():
        while True:
            controller.poll()
            time.sleep(0.5)

    def workspace_worker():
        while True:
            with contextlib.suppress(Exception):
                broker.process()
                broker.expire()
            time.sleep(0.5)

    threading.Thread(target=release_worker, daemon=True).start()
    threading.Thread(target=workspace_worker, daemon=True).start()
    threading.Thread(target=loopback.serve_forever, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
