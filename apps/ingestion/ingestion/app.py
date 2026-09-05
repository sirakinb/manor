"""Manor ingestion service: `POST /run/{pipeline}` runs one deterministic
pipeline for one workspace with the credentials Manor sends; `GET /health`
is open. Requests are HMAC-signed (see auth.py). One process; a per-
(workspace, pipeline) lock answers 409 while a run is in flight.

Nothing here logs credentials, and every error body is sanitized.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .auth import SIGNATURE_HEADER, TIMESTAMP_HEADER, verify
from .context import RunContext
from .errors import PipelineError, SkippedRun, sanitize
from .registry import PIPELINES

log = logging.getLogger("ingestion")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Manor ingestion", docs_url=None, redoc_url=None)

_locks_guard = threading.Lock()
_locks: dict[tuple[str, str], threading.Lock] = {}


def _lock_for(workspace_id: str, pipeline: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault((workspace_id, pipeline), threading.Lock())


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "pipelines": sorted(PIPELINES)}


@app.post("/run/{pipeline}")
async def run(pipeline: str, request: Request) -> JSONResponse:
    secret = os.environ.get("INGESTION_SECRET", "")
    body = await request.body()
    if not verify(
        secret,
        request.headers.get(TIMESTAMP_HEADER),
        body,
        request.headers.get(SIGNATURE_HEADER),
    ):
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)

    runner = PIPELINES.get(pipeline)
    if runner is None:
        return JSONResponse({"ok": False, "error": f"unknown pipeline: {pipeline}"}, status_code=404)

    try:
        payload = json.loads(body or b"{}")
    except ValueError:
        return JSONResponse({"ok": False, "error": "body is not JSON"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"ok": False, "error": "body must be an object"}, status_code=400)
    workspace_id = payload.get("workspaceId")
    run_id = payload.get("runId")
    if any(not isinstance(value, str) or not value.strip() or len(value) > 128 for value in (workspace_id, run_id)):
        return JSONResponse({"ok": False, "error": "invalid runId or workspaceId"}, status_code=400)
    credentials = payload.get("credentials", {})
    options = payload.get("options", {})
    if not isinstance(options, dict) or not isinstance(credentials, dict) or any(
        not isinstance(fields, dict) or any(not isinstance(value, str) for value in fields.values())
        for fields in credentials.values()
    ):
        return JSONResponse({"ok": False, "error": "invalid credentials or options"}, status_code=400)
    if not workspace_id or not run_id:
        return JSONResponse({"ok": False, "error": "runId and workspaceId are required"}, status_code=400)
    context = RunContext(
        run_id=run_id,
        workspace_id=workspace_id,
        credentials=credentials,
        options=options,
    )

    lock = _lock_for(workspace_id, pipeline)
    if not lock.acquire(blocking=False):
        return JSONResponse(
            {"ok": False, "error": f"{pipeline} is already running for this workspace"},
            status_code=409,
        )
    try:
        log.info("run start pipeline=%s workspace=%s run=%s", pipeline, workspace_id, run_id)
        result = await run_in_threadpool(runner, context)
        log.info(
            "run done pipeline=%s workspace=%s run=%s records=%s",
            pipeline,
            workspace_id,
            run_id,
            result.records_loaded,
        )
        return JSONResponse(result.as_json())
    except SkippedRun as skipped:
        log.info("run skipped pipeline=%s workspace=%s reason=%s", pipeline, workspace_id, skipped)
        return JSONResponse({"ok": True, "recordsLoaded": 0, "notes": f"skipped: {sanitize(str(skipped))}"})
    except PipelineError as failure:
        log.warning("run failed pipeline=%s workspace=%s: %s", pipeline, workspace_id, sanitize(str(failure)))
        return JSONResponse({"ok": False, "recordsLoaded": 0, "error": sanitize(str(failure))})
    except Exception as failure:  # noqa: BLE001 - the run row must always get an outcome
        # Provider/DB exceptions can embed credentials and customer records. Never
        # log their text or traceback, even when the response is sanitized.
        log.error("run crashed pipeline=%s error_type=%s", pipeline, type(failure).__name__)
        return JSONResponse(
            {"ok": False, "recordsLoaded": 0, "error": f"{type(failure).__name__}: pipeline failed"},
        )
    finally:
        lock.release()
