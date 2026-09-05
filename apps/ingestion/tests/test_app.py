import json
import asyncio
import threading
import time

import pytest
import httpx
from fastapi.testclient import TestClient

from ingestion import app as app_module
from ingestion.auth import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign
from ingestion.context import RunResult
from ingestion.errors import PipelineError, SkippedRun, sanitize

SECRET = "unit-test-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INGESTION_SECRET", SECRET)
    return TestClient(app_module.app)


def signed(body: dict, secret: str = SECRET) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    timestamp = str(int(time.time()))
    return raw, {
        TIMESTAMP_HEADER: timestamp,
        SIGNATURE_HEADER: sign(secret, timestamp, raw),
        "content-type": "application/json",
    }


def test_health_is_open(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert "zoho-agent-logs" in response.json()["pipelines"]


def test_rejects_unsigned_and_wrongly_signed_requests(client, monkeypatch):
    monkeypatch.setitem(app_module.PIPELINES, "fake", lambda ctx: RunResult(1, "ok"))
    body = {"runId": "r", "workspaceId": "w"}
    assert client.post("/run/fake", content=json.dumps(body)).status_code == 401
    raw, headers = signed(body, secret="other")
    assert client.post("/run/fake", content=raw, headers=headers).status_code == 401


def test_runs_a_pipeline_with_the_request_context(client, monkeypatch):
    seen = {}

    def fake(ctx):
        seen["ctx"] = ctx
        return RunResult(records_loaded=3, notes="three")

    monkeypatch.setitem(app_module.PIPELINES, "fake", fake)
    raw, headers = signed({
        "runId": "run-1", "workspaceId": "ws-1",
        "credentials": {"buildium": {"clientId": "a", "clientSecret": "b"}},
        "options": {"manual": True, "timezone": "UTC"},
    })
    response = client.post("/run/fake", content=raw, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True, "recordsLoaded": 3, "notes": "three"}
    ctx = seen["ctx"]
    assert ctx.run_id == "run-1" and ctx.workspace_id == "ws-1"
    assert ctx.credential("buildium") == {"clientId": "a", "clientSecret": "b"}
    assert ctx.manual is True and ctx.timezone == "UTC"
    with pytest.raises(ValueError, match="missing gmail credential"):
        ctx.credential("gmail")


def test_unknown_pipeline_and_bad_bodies(client):
    raw, headers = signed({"runId": "r", "workspaceId": "w"})
    assert client.post("/run/nope", content=raw, headers=headers).status_code == 404
    raw, headers = signed({"runId": "r"})
    assert client.post("/run/zoho-agent-logs", content=raw, headers=headers).status_code == 400


def test_failures_and_skips_are_reported_sanitized(client, monkeypatch, caplog):
    def failing(ctx):
        raise PipelineError("token refresh failed for postgres://user:pw@host/db and Bearer abcdef")

    def crashing(ctx):
        raise RuntimeError("client_secret=supersecret exploded")

    def skipping(ctx):
        raise SkippedRun("not a polling day")

    monkeypatch.setitem(app_module.PIPELINES, "failing", failing)
    monkeypatch.setitem(app_module.PIPELINES, "crashing", crashing)
    monkeypatch.setitem(app_module.PIPELINES, "skipping", skipping)
    raw, headers = signed({"runId": "r", "workspaceId": "w"})
    failed = client.post("/run/failing", content=raw, headers=headers).json()
    assert failed == {"ok": False, "recordsLoaded": 0, "error": "token refresh failed for [redacted] and [redacted]"}
    crashed = client.post("/run/crashing", content=raw, headers=headers).json()
    assert crashed["ok"] is False and "supersecret" not in crashed["error"]
    assert crashed["error"] == "RuntimeError: pipeline failed"
    assert "supersecret" not in caplog.text
    skipped = client.post("/run/skipping", content=raw, headers=headers).json()
    assert skipped == {"ok": True, "recordsLoaded": 0, "notes": "skipped: not a polling day"}


def test_concurrent_runs_of_the_same_pipeline_get_409(client, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def slow(ctx):
        started.set()
        release.wait(timeout=5)
        return RunResult(0, "")

    monkeypatch.setitem(app_module.PIPELINES, "slow", slow)
    raw, headers = signed({"runId": "r", "workspaceId": "w"})
    results = {}
    first = threading.Thread(target=lambda: results.setdefault("first", client.post("/run/slow", content=raw, headers=headers)))
    first.start()
    assert started.wait(timeout=5)
    busy = client.post("/run/slow", content=raw, headers=headers)
    assert busy.status_code == 409
    other_ws, other_headers = signed({"runId": "r2", "workspaceId": "w2"})
    assert client.post("/run/slow", content=other_ws, headers=other_headers).status_code == 200
    release.set()
    first.join(timeout=5)
    assert results["first"].status_code == 200


def test_sanitize_truncates_and_redacts():
    assert sanitize("x" * 400).endswith("x") and len(sanitize("x" * 400)) == 300
    assert sanitize("key sk_live_abcdefghijklmnop leaked") == "key [redacted] leaked"
    assert sanitize("Zoho-oauthtoken 1000.abc.def") == "[redacted]"


@pytest.mark.parametrize("body", [None, [], "text", {"runId": 1, "workspaceId": "w"},
    {"runId": "r", "workspaceId": "w", "credentials": []},
    {"runId": "r", "workspaceId": "w", "options": []},
    {"runId": "r", "workspaceId": "w", "credentials": {"gmail": "bad"}}])
def test_invalid_payload_shapes_are_rejected(client, body):
    raw, headers = signed(body)
    assert client.post("/run/water", content=raw, headers=headers).status_code == 400


def test_running_pipeline_keeps_health_and_conflict_responses_live(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    monkeypatch.setenv("INGESTION_SECRET", SECRET)

    def slow(ctx):
        started.set()
        assert release.wait(3), "event loop blocked during pipeline execution"
        return RunResult()

    monkeypatch.setitem(app_module.PIPELINES, "slow", slow)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app), base_url="http://test") as client:
            raw, headers = signed({"runId": "r", "workspaceId": "concurrent-ws"})
            first = asyncio.create_task(client.post("/run/slow", content=raw, headers=headers))
            try:
                assert await asyncio.to_thread(started.wait, 1)
                assert (await client.get("/health")).status_code == 200
                assert (await client.post("/run/slow", content=raw, headers=headers)).status_code == 409
            finally:
                release.set()
            assert (await first).json()["ok"] is True

    asyncio.run(exercise())
