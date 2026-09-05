import base64
from datetime import date

from ingestion.pipelines.water import billing_month, is_two_days_before_month_end, should_poll_today
from ingestion.pipelines.water_parser import WRD_SENDER, extract_body_text, parse_bills

SINGLE = """
Your water bill is available for the following service address:

Service address: 10 EXAMPLE AVE
Total account balance: $123.45
Please pay now: $123.45
Late payment penalty after this date: Sep. 29, 2026
"""

MULTI = """
Service address: 20 N EXAMPLE ST
Total account balance: $1,234.56
Please pay now: $500.00
Late payment penalty after this date: September 28, 2026

Service address: 30 N SAMPLE ST
Total account balance: $2,345.67
Late payment penalty after this date: Sep 25, 2026
"""


def test_single_bill_from_the_wrd_sender():
    [bill] = parse_bills(f"WRD <{WRD_SENDER}>", SINGLE, "m1", "2026-09-04T12:00:00+00:00")
    assert bill == {
        "gmail_message_id": "m1",
        "bill_index": 0,
        "received_at": "2026-09-04T12:00:00+00:00",
        "source_sender": WRD_SENDER,
        "service_address": "10 EXAMPLE AVE",
        "account_balance": 123.45,
        "amount_due": 123.45,
        "due_date": "2026-09-29",
        "parse_status": "parsed",
        "parse_notes": None,
        "raw_snippet": bill["raw_snippet"],
    }
    assert bill["raw_snippet"].startswith("Service address: 10 EXAMPLE AVE")


def test_multiple_bills_get_stable_indexes_and_their_own_segments():
    bills = parse_bills(WRD_SENDER, MULTI, "m2")
    assert [b["bill_index"] for b in bills] == [0, 1]
    assert bills[0]["service_address"] == "20 N EXAMPLE ST"
    assert bills[0]["account_balance"] == 1234.56
    assert bills[0]["amount_due"] == 500.0
    assert bills[0]["due_date"] == "2026-09-28"
    assert bills[1]["service_address"] == "30 N SAMPLE ST"
    assert bills[1]["amount_due"] is None
    assert bills[1]["due_date"] == "2026-09-25"
    assert all(b["parse_status"] == "parsed" for b in bills)


def test_forwarded_copy_counts_as_wrd_when_the_sender_is_in_the_body():
    body = f"---------- Forwarded from {WRD_SENDER} ----------\n{SINGLE}"
    [bill] = parse_bills("owner@example.test", body, "m3")
    assert bill["source_sender"] == WRD_SENDER
    assert bill["parse_status"] == "parsed"


def test_missing_fields_land_for_review_instead_of_being_dropped():
    [bill] = parse_bills("someone@example.test", "Service address: 12 Elm St\nnothing else", "m4")
    assert bill["parse_status"] == "needs_review"
    assert bill["parse_notes"] == "missing: account_balance, due_date, wrd_sender"
    assert bill["service_address"] == "12 Elm St"

    [empty] = parse_bills(WRD_SENDER, "Your bill is ready.", "m5")
    assert empty["service_address"] is None
    assert empty["parse_notes"] == "missing: service_address, account_balance"
    assert empty["bill_index"] == 0


def test_extract_body_text_prefers_plain_over_html():
    encode = lambda text: base64.urlsafe_b64encode(text.encode()).decode()
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {"mimeType": "text/html", "body": {"data": encode("<p>Service address: <b>1 A St</b></p>")}},
            {"mimeType": "text/plain", "body": {"data": encode("Service address: 1 A St")}},
        ],
    }
    assert extract_body_text(payload) == "Service address: 1 A St"
    html_only = {"mimeType": "text/html", "body": {"data": encode("<style>x{}</style><p>Hi <b>there</b></p>")}}
    assert " ".join(extract_body_text(html_only).split()) == "Hi there"


def test_polling_days_and_the_billing_month():
    assert is_two_days_before_month_end(date(2026, 9, 28))
    assert not is_two_days_before_month_end(date(2026, 9, 27))
    assert is_two_days_before_month_end(date(2026, 2, 26))  # 28-day month
    assert should_poll_today(date(2026, 9, 7), manual=False)  # Monday
    assert not should_poll_today(date(2026, 9, 8), manual=False)
    assert should_poll_today(date(2026, 9, 8), manual=True)
    assert should_poll_today(date(2026, 9, 28), manual=False)
    assert billing_month(date(2026, 9, 29)) == date(2026, 9, 1)
    assert billing_month(None) is None
