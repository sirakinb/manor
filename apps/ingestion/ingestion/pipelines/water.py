"""Utilities: poll the client's Gmail for WRD water-bill notifications →
workspace_water_bills (upsert on gmailMessageId + billIndex).

Two crons wake this pipeline (weekly on Monday and daily on the 26th-29th);
it decides for itself whether today is a polling day: a manual run always
polls, a scheduled one polls on Mondays and on the day two days before month
end (the guaranteed final sweep).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from ..context import RunContext, RunResult
from ..db import connection, new_id, upsert_rows
from ..errors import PipelineError, SkippedRun
from ..http import get_json, post_form_json
from ..normalize import norm_street_addr
from .water_parser import extract_body_text, parse_bills

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me/"
DEFAULT_QUERY = 'subject:"water bill is available"'


def is_two_days_before_month_end(today: date) -> bool:
    return today.day == calendar.monthrange(today.year, today.month)[1] - 2


def should_poll_today(today: date, manual: bool) -> bool:
    return manual or today.weekday() == 0 or is_two_days_before_month_end(today)


def billing_month(due: date | None) -> date | None:
    """The memo month is the due month (owner correction, 2026-07-20)."""
    return due.replace(day=1) if due else None


def gmail_token(credential: dict[str, str]) -> str:
    body = post_form_json(
        "https://oauth2.googleapis.com/token",
        {
            "client_id": credential["clientId"],
            "client_secret": credential["clientSecret"],
            "refresh_token": credential["refreshToken"],
            "grant_type": "refresh_token",
        },
    )
    if "access_token" not in body:
        raise PipelineError("Gmail token refresh failed (check the gmail credential)")
    return body["access_token"]


def gmail_get(token: str, path: str, params: dict | None = None) -> dict:
    return get_json(GMAIL_API + path, params=params, headers={"Authorization": f"Bearer {token}"}, timeout=45)


COLUMNS = [
    "id", "workspaceId", "utility", "gmailMessageId", "billIndex", "receivedAt", "sourceSender",
    "serviceAddress", "serviceAddressNorm", "accountBalance", "amountDue", "dueDate", "billingMonth",
    "parseStatus", "parseNotes", "rawSnippet",
]


def run(context: RunContext) -> RunResult:
    today = datetime.now(ZoneInfo(context.timezone)).date()
    if not should_poll_today(today, context.manual):
        raise SkippedRun("not a polling day (Mondays and two days before month end)")
    credential = context.credential("gmail")
    for key in ("clientId", "clientSecret", "refreshToken"):
        if not credential.get(key):
            raise PipelineError(f"gmail credential is missing {key}")
    query = str(context.options.get("gmailQuery") or DEFAULT_QUERY)
    max_results = int(context.options.get("maxResults") or 50)

    token = gmail_token(credential)
    listing = gmail_get(token, "messages", {"maxResults": max_results, "q": query})
    ids = [m["id"] for m in listing.get("messages", [])]

    rows = []
    parsed = needs_review = 0
    for message_id in ids:
        message = gmail_get(token, f"messages/{message_id}", {"format": "full"})
        headers = {h["name"]: h["value"] for h in message["payload"].get("headers", [])}
        body = extract_body_text(message["payload"])
        received = None
        if message.get("internalDate"):
            received = datetime.fromtimestamp(int(message["internalDate"]) / 1000, tz=timezone.utc).replace(tzinfo=None)
        for record in parse_bills(headers.get("From", ""), body, message_id, None):
            if record["parse_status"] == "parsed":
                parsed += 1
            else:
                needs_review += 1
            due = date.fromisoformat(record["due_date"]) if record["due_date"] else None
            rows.append([
                new_id(), context.workspace_id, "water", record["gmail_message_id"], record["bill_index"],
                received, record["source_sender"], record["service_address"],
                norm_street_addr(record["service_address"]) if record["service_address"] else None,
                record["account_balance"], record["amount_due"], due, billing_month(due),
                record["parse_status"], record["parse_notes"], record["raw_snippet"],
            ])

    with connection() as conn:
        cur = conn.cursor()
        upsert_rows(cur, "workspace_water_bills", COLUMNS, rows, ["workspaceId", "gmailMessageId", "billIndex"], touch_updated_at=False)
        cur.close()
    return RunResult(
        records_loaded=len(rows),
        notes=f"{len(ids)} emails, {parsed} parsed, {needs_review} need review",
    )
