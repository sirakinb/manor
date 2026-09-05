import os
from uuid import uuid4

import psycopg2
import pytest

from ingestion.context import RunContext
from ingestion.db import jsonb
from ingestion.errors import PipelineError
from ingestion.pipelines import reports, email_recap
from tests.test_warehouse import workspace

pytestmark = pytest.mark.skipif(not os.getenv("INGESTION_TEST_DATABASE_URL"), reason="requires opt-in local Postgres")
PROSE = {"summary": "Example summary", "what_worked": [], "what_underperformed": [], "recommended_actions": []}


def test_generation_full_totals_bounded_sample_and_replay(workspace, monkeypatch):
    rid = str(uuid4())
    request = {"kind": "voice", "agentType": "tenant", "from": "2026-03-08", "to": "2026-03-08"}
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute('''insert into workspace_reports (id, "workspaceId", "reportType", title, status, report, "shareToken", "updatedAt") values (%s, %s, 'voice', 'Example', 'queued', %s, %s, now())''', (rid, workspace, jsonb({"request": request}), str(uuid4())))
            for i in range(72):
                at = '2026-03-08 12:00:00' if i < 70 else '2026-03-08 04:59:59' if i == 70 else '2026-03-09 04:00:00'
                cur.execute('''insert into workspace_voice_calls (id, "workspaceId", "sourceCallId", "callStartedAt", "aiResolved", "updatedAt") values (%s, %s, %s, %s, true, now())''', (str(uuid4()), workspace, str(i), at))
    seen = []
    monkeypatch.setattr(reports, "synthesize", lambda context, data: seen.append(data) or PROSE)
    ctx = RunContext(rid, workspace, options={"reportId": rid})
    assert reports.run(ctx).records_loaded == 1
    assert seen[0]["stats"]["total_calls"] == 70
    assert len(seen[0]["sample"]) == 60
    assert reports.run(ctx).records_loaded == 0
    assert len(seen) == 1
    with pytest.raises(PipelineError):
        reports.run(RunContext(rid, "another-workspace", options={"reportId": rid}))
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute('select status, "approvedAt", "sentAt", report from workspace_reports where id = %s', (rid,))
            state = cur.fetchone()
            assert state[:3] == ('draft', None, None)
            assert "sample" not in state[3] and "request" not in state[3]


def test_weekly_email_is_one_draft_with_renderer_compatible_totals(workspace, monkeypatch):
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute('''insert into workspace_email_campaigns (id, "workspaceId", "sourceCampaignId", "sentAt", "emailsSent", delivered, opens, "uniqueClicks", "updatedAt") values (%s, %s, 'example', '2026-09-02 12:00:00', 100, 80, 40, 8, now())''', (str(uuid4()), workspace))
    seen = []
    monkeypatch.setattr(reports, "synthesize", lambda context, data: seen.append(data) or PROSE)
    ctx = RunContext("weekly-run", workspace, options={"scheduledFor": "2026-09-07T13:00:00Z", "workspace": {"weeklyEmailReportsEnabled": True, "weeklyEmailReportDay": 1, "weeklyEmailReportHour": 9}})
    assert email_recap.run(ctx).records_loaded == 1
    assert email_recap.run(ctx).records_loaded == 0
    assert seen[0]["agg"]["campaigns"] == 1
    assert seen[0]["agg"]["openRate"] == 50
    assert seen[0]["agg"]["deliveredRate"] == 80
    assert seen[0]["agg"]["clicks"] == 8
