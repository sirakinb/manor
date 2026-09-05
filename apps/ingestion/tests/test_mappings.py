from datetime import date, datetime

from ingestion.pipelines import buildium, zoho_campaigns
from ingestion.pipelines.listings import parse_rema_listings, parse_sheet_rows, sheet_csv_url, split_address
from ingestion.pipelines.zoho_agent_logs import MODULES, NORMALIZE_SQL, dataset_suffix

NOW = datetime(2026, 9, 5, 12, 0, 0)


def test_buildium_listing_row_maps_enums_and_the_section8_sentinel():
    row = buildium.listing_row("ws", {
        "Property": {"Id": 7, "Name": "Elm", "Address": {"AddressLine1": "1 Elm St", "City": "Philadelphia", "State": "PA", "PostalCode": "19104"}},
        "Unit": {"Id": 70, "UnitNumber": "2F", "UnitBedrooms": "TwoBed", "UnitBathrooms": "OnePointFiveBath", "UnitSize": 800},
        "Rent": "1111", "Deposit": "1111.00", "LeaseTerms": "12 months", "AvailableDate": "2026-10-01T00:00:00",
        "ListingDate": "2026-09-01", "IsManagedExternally": False, "RentalApplicationUrl": "https://apply.test",
    }, NOW)
    assert row[1:] == [
        "ws", 70, 7, "Elm", "1 Elm St", "Philadelphia", "PA", "19104", "2F", "2", "1.5", 800, 1111.0, 1111.0,
        "12 months", date(2026, 10, 1), date(2026, 9, 1), True, False, "https://apply.test", NOW,
    ]
    assert buildium.listing_row("ws", {"Property": {}, "Unit": {}}, NOW) is None
    assert buildium.BED["NineBedPlus"] == "9+" and buildium.BED["NotSet"] is None
    assert buildium.BATH["FourPointFiveBath"] == "4.5"


def test_buildium_lease_and_application_rows():
    lease = buildium.lease_row("ws", {
        "Id": 1, "PropertyId": 7, "UnitId": 70, "UnitNumber": "A", "LeaseStatus": "Active", "LeaseType": "Standard",
        "TermType": "Fixed", "LeaseFromDate": "2026-01-01", "LeaseToDate": "2026-12-31",
        "AccountDetails": {"Rent": "1200.5", "SecurityDeposit": None}, "CurrentNumberOfOccupants": 2,
        "IsEvictionPending": False, "CreatedDateTime": "2025-12-01T15:04:05Z", "LastUpdatedDateTime": "2026-08-30T10:00:00-04:00",
    }, NOW)
    assert lease[2:] == [1, 7, 70, "A", "Active", "Standard", "Fixed", date(2026, 1, 1), date(2026, 12, 31), 1200.5, None, 2, False,
                         datetime(2025, 12, 1, 15, 4, 5), datetime(2026, 8, 30, 14, 0, 0), NOW]
    application = buildium.application_row("ws", {
        "Id": 9, "Status": "Undecided", "PropertyId": 7, "UnitId": None, "TenantId": None,
        "Applications": [{"Id": 90, "ApplicationNumber": "A-90", "ApplicationStatus": "Approved", "ApplicationSubmittedDateTime": "2026-09-01T00:00:00"}],
        "LastUpdatedDateTime": None,
    }, NOW)
    assert application[2:] == [9, 90, "A-90", "Undecided", "Approved", 7, None, None, datetime(2026, 9, 1), None, NOW]
    assert buildium.to_ts("not a date") is None


def test_zoho_campaign_row_and_device_counts():
    row = zoho_campaigns.campaign_row("ws", {
        "campaignId": "c1", "campaign_key": "k1", "campaign_name": "Sept", "subject": "Homes", "from_email": "a@b.test",
        "reply_to": None, "campaign_status": "Sent", "campaigntype": "regular",
        "sent_time": "1788609600000", "created_time": "1788523200000",
    }, {
        "emails_sent_count": "100", "delivered_count": "90", "opens_count": "45", "unopened": "45", "unique_clicks_count": "9",
        "bounces_count": "10", "hardbounce_count": "6", "softbounce_count": "4", "unsub_count": "1", "spams_count": "0",
        "complaints_count": None, "forwards_count": "2", "delivered_percent": "90.0", "open_percent": "50",
        "unique_clicked_percent": "10", "clicksperopenrate": "20", "bounce_percent": "10", "unsubscribe_percent": "1.111",
    }, NOW)
    assert row[1:12] == ["ws", "c1", "k1", "Sept", "Homes", "a@b.test", None, "Sent", "regular", datetime(2026, 9, 5, 12, 0), datetime(2026, 9, 4, 12, 0)]
    assert row[12:30] == [100, 90, 45, 45, 9, 10, 6, 4, 1, 0, None, 2, 90.0, 50.0, 10.0, 20.0, 10.0, 1.111]
    assert zoho_campaigns.device_stats({"useragentstats": {
        "computer_percent": {"Windows": "2000", "Mac": "59"}, "mobile_percent": {"iOS": "17"}, "tablets_percent": {},
        "emailclients_percent": {"Outlook": "5", "Other": "0"}, "browsers_percent": {"Chrome": "27"},
    }}) == {"device": {"computer": 2059, "mobile": 17, "tablet": 0}, "email_clients": {"Outlook": 5}, "browsers": {"Chrome": 27}}
    assert zoho_campaigns.epoch_ms("0") is None and zoho_campaigns.to_int("x") is None


def test_zoho_agent_logs_modules_and_sql_are_workspace_scoped():
    assert dataset_suffix("workspace-1") == dataset_suffix("workspace-1")
    assert dataset_suffix("workspace-123456-a") != dataset_suffix("workspace-123456-b")
    assert dataset_suffix("a-b") != dataset_suffix("ab")
    assert MODULES["landlord"]["ai_note_column"] == "could_this_have_been_answered_by_the_ai"
    sql = NORMALIZE_SQL.format(dataset="raw_zoho_x", table="agent_logs", callback="call_back_required", ai_note="x")
    assert "%(ws)s" in sql and '"workspaceId", "sourceCallId"' in sql
    assert "slug" not in sql.lower()


REMA_HTML = """
<div class="listing-item result js-listing-item">
  <a href="/listings/detail/11111111-1111-4111-8111-111111111111">x</a>
  <span class="js-listing-address">60 Example St, - Unit 101, Philadelphia, PA 19125</span>
  <div class="js-listing-title"> <a href="#">Bright 2BR</a></div>
  <dt>RENT</dt> <dd class="detail-box__value"> $1,250 </dd>
  <span>2 bd / 1 ba</span>
  <span class="js-listing-available"> Now </span>
</div>
<div class="listing-item result js-listing-item">
  <a href="/listings/detail/22222222-2222-4222-8222-222222222222">x</a>
  <span class="js-listing-address">70 Sample Road - 1-2B, Philadelphia, PA</span>
  <dt>RENT</dt> <dd class="detail-box__value">$999</dd> Section 8 welcome > Studio
</div>
<div class="listing-item result js-listing-item">
  <a href="/listings/detail/22222222-2222-4222-8222-222222222222">dup</a>
  <span class="js-listing-address">dup</span>
</div>
"""


def test_rema_index_parsing():
    items = parse_rema_listings(REMA_HTML, "https://rema.test")
    assert [i["listable_uid"][:8] for i in items] == ["11111111", "22222222"]
    first, second = items
    assert first["street_address"] == "60 Example St" and first["unit"] == "Unit 101"
    assert first["title"] == "Bright 2BR" and first["rent"] == 1250.0 and first["bed_bath"] == "2 bd / 1 ba"
    assert first["available"] == "Now" and first["detail_url"].endswith("/listings/detail/11111111-1111-4111-8111-111111111111")
    assert first["is_section8"] is False
    assert second["street_address"] == "70 Sample Road" and second["unit"] == "1-2B"
    assert second["is_section8"] is True and second["bed_bath"] == "Studio"
    assert split_address("12 Main St, Apt 3, Philadelphia") == ("12 Main St", "Apt 3")


def test_sheet_parsing_and_urls():
    text = "Property Name,Rent,Beds,Baths\nAVAILABLE NOW,,,\n20 N Example St (2nd floor),\"$1,100\",3,1\n30 N Sample St*,Section 8,4,2\n20 N Example St (2nd floor),$1,3,1\n"
    rows = parse_sheet_rows(text)
    assert [r["raw_name"] for r in rows] == ["20 N Example St (2nd floor)", "30 N Sample St*"]
    assert rows[0] == {"raw_name": "20 N Example St (2nd floor)", "street_address": "20 N Example St", "unit_note": "2nd floor",
                       "rent_text": "$1,100", "rent": 1100.0, "is_section8": False, "beds": "3", "baths": "1"}
    assert rows[1]["street_address"] == "30 N Sample St" and rows[1]["is_section8"] is True and rows[1]["rent"] is None
    assert sheet_csv_url({"sheetId": "abc"}) == "https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=0"
    assert sheet_csv_url({"sheetCsvUrl": "https://x.test/a.csv", "sheetId": "abc"}) == "https://x.test/a.csv"
    assert sheet_csv_url({}) is None
