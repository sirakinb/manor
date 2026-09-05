"""Opt-in Postgres conformance with fictional data and mocked provider I/O."""

import base64
import os
from uuid import uuid4

import psycopg2
from psycopg2 import sql
import pytest

from ingestion.context import RunContext
from ingestion.pipelines import buildium, instagram, listings, recap, water, zoho_agent_logs, zoho_campaigns
from tests.test_mappings import REMA_HTML
from tests.test_water import SINGLE
from ingestion.pipelines.water_parser import WRD_SENDER

pytestmark = pytest.mark.skipif(not os.getenv("INGESTION_TEST_DATABASE_URL"), reason="requires opt-in local Postgres")


@pytest.fixture
def workspace(monkeypatch, tmp_path):
    url = os.environ["INGESTION_TEST_DATABASE_URL"]
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("DLT_PIPELINES_DIR", str(tmp_path / "dlt"))
    monkeypatch.setenv("RUNTIME__DLTHUB_TELEMETRY", "false")
    monkeypatch.setenv("RUNTIME__LOG_LEVEL", "CRITICAL")
    ws, org = str(uuid4()), str(uuid4())
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute('insert into organization (id, name, slug, "createdAt") values (%s, %s, %s, now())', (org, "Example", org))
            cur.execute('insert into workspaces (id, "organizationId", name, slug, "updatedAt") values (%s, %s, %s, %s, now())', (ws, org, "Example", ws))
    try:
        yield ws
    finally:
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute('delete from organization where id = %s', (org,))
                dataset = "raw_zoho_" + zoho_agent_logs.dataset_suffix(ws)
                for schema in (dataset, dataset + "_staging"):
                    cur.execute(sql.SQL("drop schema if exists {} cascade").format(sql.Identifier(schema)))


def test_all_mapped_pipelines_write_and_upsert(workspace, monkeypatch):
    ws = workspace
    creds = {"clientId": "fake", "clientSecret": "fake", "refreshToken": "fake"}
    def page(credential, path, params=None):
        return [{"Unit": {"Id": 1}, "Property": {"Id": 1}}] if path.endswith("listings") else [{"Id": 1}]
    monkeypatch.setattr(buildium, "paginate", page)
    assert buildium.run(RunContext("r", ws, {"buildium": creds})).records_loaded == 6
    assert buildium.run(RunContext("r", ws, {"buildium": creds})).records_loaded == 6

    monkeypatch.setattr(listings, "fetch_text", lambda url: REMA_HTML if "listings" in url else "Property Name,Rent,Beds,Baths\n10 Example St,$1000,2,1")
    assert listings.run(RunContext("r", ws, options={"remaUrl": "https://example.test/listings", "sheetCsvUrl": "https://example.test/sheet"})).records_loaded == 3

    monkeypatch.setattr(instagram, "graph", lambda *a, **k: {"username": "example", "followers_count": 10})
    monkeypatch.setattr(instagram, "daily_series", lambda *a: {})
    monkeypatch.setattr(instagram, "totals_28d", lambda *a: {})
    monkeypatch.setattr(instagram, "demographics", lambda *a: {})
    monkeypatch.setattr(instagram, "media", lambda *a: [({"id": "post-1"}, {})])
    assert instagram.run(RunContext("r", ws, {"instagram": {"pageToken": "fake", "igUserId": "fake"}})).records_loaded == 3

    monkeypatch.setattr(zoho_campaigns, "access_token", lambda _: "fake")
    monkeypatch.setattr(zoho_campaigns, "all_campaigns", lambda _: [{"campaignId": "c1", "campaign_status": "Draft"}])
    assert zoho_campaigns.run(RunContext("r", ws, {"zoho-campaigns": creds})).records_loaded == 1

    monkeypatch.setattr(water, "gmail_token", lambda _: "fake")
    monkeypatch.setattr(water, "gmail_get", lambda token, path, params: {"messages": [{"id": "m1"}]} if path == "messages" else {"payload": {"headers": [{"name": "From", "value": WRD_SENDER}], "mimeType": "text/plain", "body": {"data": base64.urlsafe_b64encode(SINGLE.encode()).decode().rstrip("=")}}})
    assert water.run(RunContext("r", ws, {"gmail": creds}, {"manual": True})).records_loaded == 1

    monkeypatch.setattr(recap, "generate_narrative", lambda *a: {"summary": "Example recap"})
    ctx = RunContext("r", ws, {"openrouter": {"apiKey": "fake"}}, {"manual": True, "year": 2026, "month": 8})
    assert recap.run(ctx).records_loaded == 1
    assert recap.run(ctx).records_loaded == 1
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute('select status, count(*) from workspace_reports where "workspaceId" = %s group by status', (ws,))
            assert cur.fetchall() == [("draft", 1)]
            cur.execute('update workspace_reports set "approvedAt" = now() where "workspaceId" = %s', (ws,))
    assert recap.run(ctx).records_loaded == 0


def test_zoho_normalizes_nullable_fields_and_resumes_after_fresh_container(workspace, monkeypatch, tmp_path):
    monkeypatch.setattr(zoho_agent_logs, "zoho_access_token", lambda *a: ("fake", "https://example.test"))
    cursors = []
    def records(domain, token, module, fields, cursor):
        cursors.append(cursor)
        if not cursor:
            yield {"id": module, "Created_Time": "2026-08-01T12:00:00+00:00", "Modified_Time": "2026-08-02T12:00:00+00:00"}
    monkeypatch.setattr(zoho_agent_logs, "fetch_records", records)
    ctx = RunContext("r", workspace, {"zoho-crm": {"clientId": "fake", "clientSecret": "fake", "refreshToken": "fake"}})
    assert zoho_agent_logs.run(ctx).records_loaded == 2
    monkeypatch.setenv("DLT_PIPELINES_DIR", str(tmp_path / "fresh"))
    assert zoho_agent_logs.run(ctx).records_loaded == 2
    assert cursors == [None, None, "2026-08-02T12:00:00+00:00", "2026-08-02T12:00:00+00:00"]
