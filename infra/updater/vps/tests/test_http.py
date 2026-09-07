import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release import Controller, Refused, Store, create_server
from test_release import Adapter, REVISION


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.controller = Controller(Store(self.temp.name), Adapter(), "policy-v1")
        self.tokens = {"owner": "o" * 40, "developer": "d" * 40}
        self.server = create_server(self.controller, self.tokens, 0)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:" + str(self.server.server_address[1])

    def call(self, path, body=None, role=None):
        headers = {"Content-Type": "application/json"}
        if role:
            headers["Authorization"] = "Bearer " + self.tokens[role]
        request = urllib.request.Request(self.base + path, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_health_contains_no_deployment_details_and_reads_require_auth(self):
        self.assertEqual(self.call("/health"), (200, {"ok": True, "version": 1}))
        for path in ("/v1/releases", "/v1/history", "/v1/deployment", "/v1/operations/missing"):
            self.assertEqual(self.call(path)[0], 401)

    def test_exact_revision_queue_poll_and_duplicate(self):
        request = {"action": "prepare", "requestId": str(uuid.uuid4()), "revision": REVISION}
        status, queued = self.call("/v1/operations", request, "developer")
        self.assertEqual(status, 202)
        self.assertEqual(queued["state"], "queued")
        self.controller.process()
        status, result = self.call("/v1/operations/" + request["requestId"], role="developer")
        self.assertEqual(result["state"], "succeeded")
        self.assertEqual(self.call("/v1/operations", request, "developer")[1], result)
        history = self.call("/v1/history", role="developer")[1]
        self.assertEqual(history[0]["requestId"], request["requestId"])
        self.assertEqual(self.call("/v1/deployment", role="developer")[1], {"current": None, "recovery": None})

    def test_developer_cannot_approve_or_recover(self):
        request = {"action": "recover", "requestId": str(uuid.uuid4())}
        self.assertEqual(self.call("/v1/operations", request, "developer")[1]["error"], "owner_required")
        self.assertEqual(self.call("/v1/operations", request, "owner")[0], 202)

    def test_public_errors_do_not_echo_attacker_fields(self):
        request = {"action": "prepare", "requestId": str(uuid.uuid4()), "revision": "private-value"}
        status, result = self.call("/v1/operations", request, "developer")
        self.assertEqual(status, 409)
        self.assertNotIn("private-value", json.dumps(result))

    def test_body_limit_is_enforced_before_submission(self):
        status, result = self.call("/v1/operations", {"payload": "x" * 20000}, "developer")
        self.assertEqual(status, 409)
        self.assertEqual(result["error"], "invalid_body_size")

    def test_owner_and_developer_credentials_must_differ(self):
        with self.assertRaises(Refused):
            create_server(self.controller, {"owner": "x" * 40, "developer": "x" * 40}, 0)
