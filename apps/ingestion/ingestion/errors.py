"""Error text that is safe to hand back to Manor and to log."""

from __future__ import annotations

import re

MAX_LEN = 300

_SECRET_PATTERNS = [
    re.compile(r"postgres(?:ql)?://\S+", re.I),
    re.compile(r"(?:Bearer|Zoho-oauthtoken)\s+\S+", re.I),
    re.compile(r"(access_token|refresh_token|client_secret|client_id|page_token|api_key)=[^&\s'\"]+", re.I),
    re.compile(r"\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\b[A-Fa-f0-9]{32,}\b"),
]


def sanitize(message: str) -> str:
    text = " ".join(str(message).split())
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda m: f"{m.group(1)}=[redacted]" if m.lastindex else "[redacted]", text)
    return text[:MAX_LEN]


class PipelineError(Exception):
    """A pipeline failed for a reason the operator should read verbatim."""


class SkippedRun(Exception):
    """The pipeline decided nothing is due right now (self-gated); not a failure."""
