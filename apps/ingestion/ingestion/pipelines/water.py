"""Utilities: poll the client's Gmail for WRD water-bill notifications →
workspace_water_bills (upsert on gmailMessageId + billIndex).

The notice is not the city bill. Current charges come from a city-statement
line, a PDF attachment, or the CRM water bills sheet matched by service
address and due date. The running Total account balance is stored only as
account metadata. A scheduled run polls Gmail on Mondays and two days
before month end; other daily ticks skip Gmail so the workspace can retry
CRM due dates. A manual run always polls Gmail.
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
from .water_parser import (
    _with_parse_status,
    apply_city_statement,
    city_statement_applies,
    decode_gmail_attachment,
    extract_body_text,
    extract_pdf_text,
    iter_pdf_attachments,
    parse_bills,
    parse_city_statement,
)

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
    "serviceAddress", "serviceAddressNorm", "accountBalance", "amountDue", "currentCharges", "dueDate",
    "billingMonth", "parseStatus", "parseNotes", "rawSnippet", "sourceKind",
]

# Re-ingest must not wipe a city amount recorded by an agent or an earlier PDF.
UPDATE_COLUMNS = [
    "receivedAt", "sourceSender", "serviceAddress", "serviceAddressNorm", "accountBalance", "amountDue",
    "dueDate", "billingMonth", "rawSnippet",
]


def _apply_pdf_statements(bills: list[dict], statements: list[dict]) -> None:
    if not statements:
        return
    unmatched = [statement for statement in statements if statement.get("current_charges") is not None]
    if len(unmatched) == 1 and len(bills) == 1:
        apply_city_statement(bills[0], unmatched[0])
        return
    remaining = list(unmatched)
    for bill in bills:
        for index, statement in enumerate(remaining):
            if not statement.get("service_address"):
                continue
            if not city_statement_applies(bill, statement):
                continue
            apply_city_statement(bill, statement)
            remaining.pop(index)
            break


def merge_preserved_city_amount(record: dict, existing_charges: float | None) -> dict:
    """Keep a stored city amount, then recompute parse completeness from every required field."""
    charges = record.get("current_charges")
    if charges is None:
        charges = existing_charges
    return _with_parse_status({**record, "current_charges": charges})


def _preserve_city_amount(cur, workspace_id: str, record: dict, current_charges: float | None) -> None:
    """Keep an already-recorded city amount when this notice still lacks one."""
    existing = None
    if current_charges is None:
        cur.execute(
            """
            select "currentCharges"
            from workspace_water_bills
            where "workspaceId" = %s and "gmailMessageId" = %s and "billIndex" = %s
            """,
            (workspace_id, record["gmail_message_id"], record["bill_index"]),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            existing = float(row[0])
    merged = merge_preserved_city_amount({**record, "current_charges": current_charges}, existing)
    cur.execute(
        """
        update workspace_water_bills
        set "currentCharges" = %s, "parseStatus" = %s, "parseNotes" = %s
        where "workspaceId" = %s and "gmailMessageId" = %s and "billIndex" = %s
        """,
        (
            merged["current_charges"],
            merged["parse_status"],
            merged["parse_notes"],
            workspace_id,
            record["gmail_message_id"],
            record["bill_index"],
        ),
    )


def run(context: RunContext) -> RunResult:
    today = datetime.now(ZoneInfo(context.timezone)).date()
    if not should_poll_today(today, context.manual):
        raise SkippedRun("not a Gmail polling day (Mondays and two days before month end)")
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
    records = []
    parsed = needs_review = 0
    for message_id in ids:
        message = gmail_get(token, f"messages/{message_id}", {"format": "full"})
        headers = {h["name"]: h["value"] for h in message["payload"].get("headers", [])}
        body = extract_body_text(message["payload"])
        received = None
        if message.get("internalDate"):
            received = datetime.fromtimestamp(int(message["internalDate"]) / 1000, tz=timezone.utc).replace(tzinfo=None)
        bills = parse_bills(headers.get("From", ""), body, message_id, None)
        statements = []
        for attachment_id in iter_pdf_attachments(message["payload"]):
            attachment = gmail_get(token, f"messages/{message_id}/attachments/{attachment_id}")
            text = extract_pdf_text(decode_gmail_attachment(attachment))
            if text.strip():
                statements.append(parse_city_statement(text))
        _apply_pdf_statements(bills, statements)
        for record in bills:
            if record["parse_status"] == "parsed":
                parsed += 1
            else:
                needs_review += 1
            due = date.fromisoformat(record["due_date"]) if record["due_date"] else None
            records.append(record)
            rows.append([
                new_id(), context.workspace_id, "water", record["gmail_message_id"], record["bill_index"],
                received, record["source_sender"], record["service_address"],
                norm_street_addr(record["service_address"]) if record["service_address"] else None,
                record["account_balance"], record["amount_due"], record["current_charges"], due,
                billing_month(due), record["parse_status"], record["parse_notes"], record["raw_snippet"],
                "wrd_email",
            ])

    with connection() as conn:
        cur = conn.cursor()
        upsert_rows(
            cur,
            "workspace_water_bills",
            COLUMNS,
            rows,
            ["workspaceId", "gmailMessageId", "billIndex"],
            update=UPDATE_COLUMNS,
            touch_updated_at=False,
        )
        for record in records:
            _preserve_city_amount(cur, context.workspace_id, record, record["current_charges"])
        cur.close()
    return RunResult(
        records_loaded=len(rows),
        notes=f"{len(ids)} emails, {parsed} parsed, {needs_review} need review",
    )
