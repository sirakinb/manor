"""Small HTTP helpers with the retry behaviour the old pipelines relied on."""

from __future__ import annotations

import time
from typing import Any

import requests

from .errors import PipelineError

RETRY_STATUSES = {429, 500, 502, 503}


def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 45,
    attempts: int = 4,
    raise_for_status: bool = True,
) -> Any:
    last: requests.Response | None = None
    for attempt in range(attempts):
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        last = response
        if response.status_code in RETRY_STATUSES and attempt < attempts - 1:
            time.sleep(2 * (attempt + 1))
            continue
        break
    assert last is not None
    if raise_for_status:
        last.raise_for_status()
    if not last.content:
        return {}
    try:
        return last.json()
    except ValueError:
        raise PipelineError("Provider returned invalid JSON; existing data was preserved") from None


def post_form_json(url: str, data: dict[str, str], timeout: int = 30) -> Any:
    response = requests.post(url, data=data, timeout=timeout)
    response.raise_for_status()
    return response.json()


def fetch_text(url: str, timeout: int = 45) -> str:
    response = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (manor-ingestion)"}, timeout=timeout)
    response.raise_for_status()
    return response.text
