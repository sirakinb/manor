"""Parse Philadelphia Water Revenue Dept (WRD) bill-notification emails.

The notification carries the amount, the service address, and the "late
after" date, never the billing-cycle dates. Field mapping (per the owner):
pass-through amount = "Total account balance"; the billing month is the DUE
month (derived when the row is written). Forwarded copies (phila.gov in the
body rather than the From header) parse too. Pure functions; no I/O.
"""

from __future__ import annotations

import base64
import re
from datetime import date, datetime

WRD_SENDER = "do-not-reply-waterrevbureau@phila.gov"

RE_SERVICE = re.compile(
    r"Service address:\s*(\d[^\n]*?)\s*(?:Total account balance|Please pay now|[\r\n])",
    re.IGNORECASE,
)
RE_BALANCE = re.compile(r"Total account balance:\s*\$?\s*([\d,]+\.\d{2})", re.IGNORECASE)
RE_PAYNOW = re.compile(r"Please pay now:\s*\$?\s*([\d,]+\.\d{2})", re.IGNORECASE)
RE_DUE = re.compile(
    r"penalty after this date:\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})", re.IGNORECASE
)


def extract_body_text(payload: dict) -> str:
    """Flatten a Gmail message payload to text, preferring text/plain."""
    plain: list[str] = []
    html: list[str] = []

    def walk(part: dict) -> None:
        data = (part.get("body") or {}).get("data")
        if data:
            try:
                text = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "ignore")
            except Exception:  # noqa: BLE001 - a bad part is just skipped
                text = ""
            if part.get("mimeType") == "text/plain":
                plain.append(text)
            elif part.get("mimeType") == "text/html":
                html.append(text)
        for child in part.get("parts", []):
            walk(child)

    walk(payload)
    if plain:
        return "\n".join(plain)
    if html:
        text = re.sub(r"(?is)<(style|script).*?</\1>", " ", "\n".join(html))
        return re.sub(r"<[^>]+>", " ", text)
    return ""


def _money(value: str) -> float:
    return float(value.replace(",", ""))


def _parse_due(value: str) -> date | None:
    cleaned = value.replace(".", "").replace(",", "").strip()
    for fmt in ("%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def parse_bills(
    from_header: str,
    body_text: str,
    gmail_message_id: str,
    received_at: str | None = None,
) -> list[dict]:
    """All bills in one email (WRD batches several properties per notification),
    one dict per bill with a stable bill_index. Always at least one dict;
    parse_status 'needs_review' with parse_notes when a required field is missing."""
    flat = re.sub(r"[ \t]+", " ", body_text)
    is_wrd = WRD_SENDER in (from_header or "").lower() or WRD_SENDER in flat.lower()

    matches = list(RE_SERVICE.finditer(flat))
    bills = []
    for index, match in enumerate(matches):
        segment_end = matches[index + 1].start() if index + 1 < len(matches) else len(flat)
        segment = flat[match.start():segment_end]
        balance = RE_BALANCE.search(segment)
        pay_now = RE_PAYNOW.search(segment)
        due_match = RE_DUE.search(segment)
        due = _parse_due(due_match.group(1)) if due_match else None
        missing = []
        if not balance:
            missing.append("account_balance")
        if not due:
            missing.append("due_date")
        if not is_wrd:
            missing.append("wrd_sender")
        bills.append({
            "gmail_message_id": gmail_message_id,
            "bill_index": index,
            "received_at": received_at,
            "source_sender": WRD_SENDER if is_wrd else (from_header or None),
            "service_address": match.group(1).strip(),
            "account_balance": _money(balance.group(1)) if balance else None,
            "amount_due": _money(pay_now.group(1)) if pay_now else None,
            "due_date": due.isoformat() if due else None,
            "parse_status": "parsed" if not missing else "needs_review",
            "parse_notes": None if not missing else "missing: " + ", ".join(missing),
            "raw_snippet": segment[:600],
        })

    if not bills:
        missing = ["service_address"]
        if not RE_BALANCE.search(flat):
            missing.append("account_balance")
        if not is_wrd:
            missing.append("wrd_sender")
        bills.append({
            "gmail_message_id": gmail_message_id,
            "bill_index": 0,
            "received_at": received_at,
            "source_sender": WRD_SENDER if is_wrd else (from_header or None),
            "service_address": None,
            "account_balance": None,
            "amount_due": None,
            "due_date": None,
            "parse_status": "needs_review",
            "parse_notes": "missing: " + ", ".join(missing),
            "raw_snippet": flat[:600],
        })
    return bills
