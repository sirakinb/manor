"""Parse Philadelphia Water Revenue Dept (WRD) bill notifications and city bills.

WRD's Gmail notice ("Your water bill is available") carries the service
address, the running Total account balance, Please pay now, and the late
date. That balance is not the month's city bill. The monthly figure is
Current charges on the city statement (PDF attachment, portal download, or
an email that actually includes that line). Forwarded copies (phila.gov in
the body rather than the From header) parse too. Pure functions; no I/O.
"""

from __future__ import annotations

import base64
import io
import re
from datetime import date, datetime

WRD_SENDER = "do-not-reply-waterrevbureau@phila.gov"

RE_SERVICE = re.compile(
    r"Service address:\s*(\d[^\n]*?)\s*(?:Total account balance|Please pay now|Current charges|Total current charges|[\r\n])",
    re.IGNORECASE,
)
RE_BALANCE = re.compile(r"Total account balance:\s*\$?\s*([\d,]+\.\d{2})", re.IGNORECASE)
RE_PAYNOW = re.compile(r"Please pay now:\s*\$?\s*([\d,]+\.\d{2})", re.IGNORECASE)
RE_CURRENT = re.compile(
    r"(?:Total current charges|Current charges|This (?:month(?:'s)?|period(?:'s)?) charges|New charges)\s*[:\s]*\$?\s*([\d,]+\.\d{2})",
    re.IGNORECASE,
)
RE_DUE = re.compile(
    r"penalty after this date:\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})",
    re.IGNORECASE,
)
RE_PDF_SERVICE = re.compile(
    r"(?:Service address|Service location|Premises)\s*[:\s]+(\d[^\n]{3,80})",
    re.IGNORECASE,
)
RE_PDF_DUE = re.compile(
    r"(?:Due date|Payment due|Pay by)\s*[:\s]+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})",
    re.IGNORECASE,
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


def iter_pdf_attachments(payload: dict) -> list[str]:
    """Gmail attachment ids for PDF parts (the city bill, when WRD or a forward attached one)."""
    ids: list[str] = []

    def walk(part: dict) -> None:
        mime = (part.get("mimeType") or "").lower()
        filename = (part.get("filename") or "").lower()
        attachment_id = (part.get("body") or {}).get("attachmentId")
        if attachment_id and (mime == "application/pdf" or filename.endswith(".pdf")):
            ids.append(attachment_id)
        for child in part.get("parts", []):
            walk(child)

    walk(payload)
    return ids


def extract_pdf_text(data: bytes) -> str:
    """Best-effort text from a city-bill PDF. Empty when the file is image-only."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception:  # noqa: BLE001 - unreadable PDFs fall through to needs_review
        return ""
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(pages)


def decode_gmail_attachment(body: dict | None) -> bytes:
    data = (body or {}).get("data") or ""
    if not data:
        return b""
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except Exception:  # noqa: BLE001
        return b""


def _money(value: str) -> float:
    return float(value.replace(",", ""))


def _parse_due(value: str) -> date | None:
    cleaned = value.replace(".", "").replace(",", "").strip()
    for fmt in ("%b %d %Y", "%B %d %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _norm_addr(value: str | None) -> str:
    # Join a PDF to an email row only; warehouse writes use norm_street_addr.
    return re.sub(r"[.,]", "", (value or "")).lower()


def parse_city_statement(text: str) -> dict:
    """Pull Current charges from a city bill (PDF text or a notice that includes them).

    Never falls back to Total account balance or Please pay now, and never
    subtracts successive balances.
    """
    flat = re.sub(r"[ \t]+", " ", text)
    service = RE_SERVICE.search(flat) or RE_PDF_SERVICE.search(flat)
    current = RE_CURRENT.search(flat)
    balance = RE_BALANCE.search(flat)
    due_match = RE_DUE.search(flat) or RE_PDF_DUE.search(flat)
    due = _parse_due(due_match.group(1)) if due_match else None
    return {
        "service_address": service.group(1).strip() if service else None,
        "current_charges": _money(current.group(1)) if current else None,
        "account_balance": _money(balance.group(1)) if balance else None,
        "due_date": due.isoformat() if due else None,
    }


def apply_city_statement(bill: dict, statement: dict) -> dict:
    """Fill current_charges from a city statement matched to this notice row."""
    if statement.get("current_charges") is None:
        return _with_parse_status(bill)
    bill_addr = _norm_addr(bill.get("service_address"))
    stmt_addr = _norm_addr(statement.get("service_address"))
    if stmt_addr and bill_addr and stmt_addr not in bill_addr and bill_addr not in stmt_addr:
        return _with_parse_status(bill)
    bill["current_charges"] = statement["current_charges"]
    if bill.get("due_date") is None and statement.get("due_date"):
        bill["due_date"] = statement["due_date"]
    if bill.get("service_address") is None and statement.get("service_address"):
        bill["service_address"] = statement["service_address"]
    return _with_parse_status(bill)


def _with_parse_status(bill: dict) -> dict:
    missing: list[str] = []
    if not bill.get("service_address"):
        missing.append("service_address")
    if bill.get("current_charges") is None:
        missing.append("current_charges")
    if not bill.get("due_date"):
        missing.append("due_date")
    if bill.get("source_sender") != WRD_SENDER:
        missing.append("wrd_sender")
    bill["parse_status"] = "parsed" if not missing else "needs_review"
    bill["parse_notes"] = None if not missing else "missing: " + ", ".join(missing)
    return bill


def parse_bills(
    from_header: str,
    body_text: str,
    gmail_message_id: str,
    received_at: str | None = None,
) -> list[dict]:
    """All bills in one email (WRD batches several properties per notification),
    one dict per bill with a stable bill_index. Always at least one dict;
    parse_status 'needs_review' with parse_notes when a required field is missing.
    Current charges come from the city bill line when present; the running
    account balance is stored separately and is never the pass-through amount.
    """
    flat = re.sub(r"[ \t]+", " ", body_text)
    is_wrd = WRD_SENDER in (from_header or "").lower() or WRD_SENDER in flat.lower()

    matches = list(RE_SERVICE.finditer(flat))
    bills = []
    for index, match in enumerate(matches):
        segment_end = matches[index + 1].start() if index + 1 < len(matches) else len(flat)
        segment = flat[match.start():segment_end]
        balance = RE_BALANCE.search(segment)
        pay_now = RE_PAYNOW.search(segment)
        current = RE_CURRENT.search(segment)
        due_match = RE_DUE.search(segment)
        due = _parse_due(due_match.group(1)) if due_match else None
        bills.append(_with_parse_status({
            "gmail_message_id": gmail_message_id,
            "bill_index": index,
            "received_at": received_at,
            "source_sender": WRD_SENDER if is_wrd else (from_header or None),
            "service_address": match.group(1).strip(),
            "account_balance": _money(balance.group(1)) if balance else None,
            "amount_due": _money(pay_now.group(1)) if pay_now else None,
            "current_charges": _money(current.group(1)) if current else None,
            "due_date": due.isoformat() if due else None,
            "raw_snippet": segment[:600],
        }))

    if not bills:
        statement = parse_city_statement(flat)
        bills.append(_with_parse_status({
            "gmail_message_id": gmail_message_id,
            "bill_index": 0,
            "received_at": received_at,
            "source_sender": WRD_SENDER if is_wrd else (from_header or None),
            "service_address": statement["service_address"],
            "account_balance": statement["account_balance"],
            "amount_due": None,
            "current_charges": statement["current_charges"],
            "due_date": statement["due_date"],
            "raw_snippet": flat[:600],
        }))
    return bills
