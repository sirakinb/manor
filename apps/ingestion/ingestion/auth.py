"""Request signing shared with Manor (packages/adapters/src/ingestion-runner.ts).

Signature = hex(HMAC-SHA256(secret, f"{timestamp}.{body}")) where timestamp is
unix seconds as sent in X-Manor-Timestamp and body is the raw request bytes.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import time

MAX_SKEW_SECONDS = 5 * 60
SIGNATURE_HEADER = "x-manor-signature"
TIMESTAMP_HEADER = "x-manor-timestamp"


def sign(secret: str, timestamp: str, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify(
    secret: str,
    timestamp: str | None,
    body: bytes,
    signature: str | None,
    now: float | None = None,
) -> bool:
    """Constant-time signature check plus a clock-skew window."""
    if not secret or not timestamp or not signature:
        return False
    try:
        sent_at = float(timestamp)
    except ValueError:
        return False
    current = time.time() if now is None else now
    if not math.isfinite(sent_at) or abs(current - sent_at) > MAX_SKEW_SECONDS:
        return False
    expected = sign(secret, timestamp, body)
    return hmac.compare_digest(expected.encode(), signature.strip().lower().encode())
