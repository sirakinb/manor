import base64
from datetime import date

from ingestion.pipelines.water import (
    _apply_pdf_statements,
    billing_month,
    is_two_days_before_month_end,
    merge_preserved_city_amount,
    should_poll_today,
)
from ingestion.pipelines.water_parser import (
    WRD_SENDER,
    apply_city_statement,
    extract_body_text,
    parse_bills,
    parse_city_statement,
)

SINGLE = """
Your water bill is available for the following service address:

Service address: 10 EXAMPLE AVE
Total account balance: $123.45
Please pay now: $123.45
Late payment penalty after this date: Sep. 29, 2026
"""

CITY_LINE = """
Your water bill is available for the following service address:

Service address: 10 EXAMPLE AVE
Current charges: $70.12
Total account balance: $2,433.45
Please pay now: $2,433.45
Late payment penalty after this date: Sep. 29, 2026
"""

CITY_PDF = """
City of Philadelphia Water Revenue
Service address: 10 EXAMPLE AVE
Total current charges: $70.12
Total account balance: $2,433.45
Due date: Sep. 29, 2026
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


def test_single_bill_from_the_wrd_sender_keeps_the_running_total_but_needs_the_city_amount():
    [bill] = parse_bills(f"WRD <{WRD_SENDER}>", SINGLE, "m1", "2026-09-04T12:00:00+00:00")
    assert bill["service_address"] == "10 EXAMPLE AVE"
    assert bill["account_balance"] == 123.45
    assert bill["amount_due"] == 123.45
    assert bill["current_charges"] is None
    assert bill["due_date"] == "2026-09-29"
    assert bill["parse_status"] == "needs_review"
    assert bill["parse_notes"] == "missing: current_charges"
    assert bill["source_sender"] == WRD_SENDER


def test_current_charges_on_the_notice_are_the_monthly_city_bill():
    [bill] = parse_bills(WRD_SENDER, CITY_LINE, "m-city")
    assert bill["current_charges"] == 70.12
    assert bill["account_balance"] == 2433.45
    assert bill["parse_status"] == "parsed"
    assert bill["parse_notes"] is None


def test_city_statement_never_uses_the_running_total_or_a_subtracted_delta():
    statement = parse_city_statement(CITY_PDF)
    assert statement == {
        "service_address": "10 EXAMPLE AVE",
        "current_charges": 70.12,
        "account_balance": 2433.45,
        "due_date": "2026-09-29",
    }
    running_only = parse_city_statement(
        "Service address: 10 EXAMPLE AVE\nTotal account balance: $2,433.45\nPlease pay now: $70.12"
    )
    assert running_only["current_charges"] is None
    assert running_only["account_balance"] == 2433.45


def test_pdf_statement_fills_current_charges_on_the_matching_notice():
    [bill] = parse_bills(WRD_SENDER, SINGLE, "m-pdf")
    filled = apply_city_statement(bill, parse_city_statement(CITY_PDF))
    assert filled["current_charges"] == 70.12
    assert filled["account_balance"] == 123.45
    assert filled["parse_status"] == "parsed"


def test_pdf_for_a_different_address_does_not_invent_an_amount():
    [bill] = parse_bills(WRD_SENDER, SINGLE, "m-other")
    other = parse_city_statement("Service address: 99 OTHER ST\nTotal current charges: $12.00")
    filled = apply_city_statement(bill, other)
    assert filled["current_charges"] is None
    assert filled["parse_status"] == "needs_review"


def test_pdf_address_must_match_exactly_and_due_dates_must_agree():
    [bill] = parse_bills(WRD_SENDER, SINGLE, "m-exact")
    neighbor = parse_city_statement("Service address: 110 EXAMPLE AVE\nTotal current charges: $12.00")
    assert apply_city_statement(dict(bill), neighbor)["current_charges"] is None
    conflict = parse_city_statement(
        "Service address: 10 EXAMPLE AVE\nTotal current charges: $70.12\nDue date: Oct. 1, 2026"
    )
    assert apply_city_statement(dict(bill), conflict)["current_charges"] is None


def test_multi_bill_pdf_match_consumes_the_statement_and_skips_addressless_copies():
    bills = parse_bills(WRD_SENDER, MULTI, "m-multi-pdf")
    first = parse_city_statement("Service address: 20 N EXAMPLE ST\nTotal current charges: $40.00")
    second = parse_city_statement("Service address: 30 N SAMPLE ST\nTotal current charges: $55.00")
    addressless = parse_city_statement("Total current charges: $99.00")
    _apply_pdf_statements(bills, [addressless, first, second])
    assert bills[0]["current_charges"] == 40.0
    assert bills[1]["current_charges"] == 55.0


def test_preserved_city_amount_still_needs_review_when_other_fields_are_missing():
    record = {
        "service_address": None,
        "current_charges": None,
        "due_date": None,
        "source_sender": "owner@example.test",
    }
    merged = merge_preserved_city_amount(record, 70.12)
    assert merged["current_charges"] == 70.12
    assert merged["parse_status"] == "needs_review"
    assert merged["parse_notes"] == "missing: service_address, due_date, wrd_sender"


def test_multiple_bills_get_stable_indexes_and_their_own_segments():
    bills = parse_bills(WRD_SENDER, MULTI, "m2")
    assert [b["bill_index"] for b in bills] == [0, 1]
    assert bills[0]["service_address"] == "20 N EXAMPLE ST"
    assert bills[0]["account_balance"] == 1234.56
    assert bills[0]["amount_due"] == 500.0
    assert bills[0]["current_charges"] is None
    assert bills[0]["due_date"] == "2026-09-28"
    assert bills[1]["service_address"] == "30 N SAMPLE ST"
    assert bills[1]["amount_due"] is None
    assert bills[1]["due_date"] == "2026-09-25"
    assert all(b["parse_status"] == "needs_review" for b in bills)
    assert all("current_charges" in (b["parse_notes"] or "") for b in bills)


def test_forwarded_copy_counts_as_wrd_when_the_sender_is_in_the_body():
    body = f"---------- Forwarded from {WRD_SENDER} ----------\n{SINGLE}"
    [bill] = parse_bills("owner@example.test", body, "m3")
    assert bill["source_sender"] == WRD_SENDER
    assert bill["parse_status"] == "needs_review"
    assert bill["parse_notes"] == "missing: current_charges"


def test_missing_fields_land_for_review_instead_of_being_dropped():
    [bill] = parse_bills("someone@example.test", "Service address: 12 Elm St\nnothing else", "m4")
    assert bill["parse_status"] == "needs_review"
    assert bill["parse_notes"] == "missing: current_charges, due_date, wrd_sender"
    assert bill["service_address"] == "12 Elm St"

    [empty] = parse_bills(WRD_SENDER, "Your bill is ready.", "m5")
    assert empty["service_address"] is None
    assert empty["parse_notes"] == "missing: service_address, current_charges, due_date"
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
