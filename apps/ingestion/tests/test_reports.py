from datetime import datetime

import pytest

from ingestion.errors import PipelineError, SkippedRun
from ingestion.pipelines.reports import window
from ingestion.pipelines.email_recap import weekly_window


def test_window_uses_local_midnight_and_preserves_dst():
    start, end = window({"kind": "voice", "agentType": "tenant", "from": "2026-03-08", "to": "2026-03-08"}, "America/New_York")
    assert start == datetime(2026, 3, 8, 5)
    assert end == datetime(2026, 3, 9, 4)


@pytest.mark.parametrize("payload", [
    {"kind": "email", "from": "2026-02-30", "to": "2026-03-01"},
    {"kind": "email", "from": "2026-03-02", "to": "2026-03-01"},
    {"kind": "email", "from": "2024-01-01", "to": "2026-03-01"},
    {"kind": "voice", "from": "2026-03-01", "to": "2026-03-01"},
    {"kind": "monthly_voice", "agentType": "tenant", "from": "2026-03-01", "to": "2026-03-12"},
])
def test_invalid_report_requests_are_rejected(payload):
    with pytest.raises(PipelineError):
        window(payload, "America/New_York")


def test_weekly_window_gates_then_uses_seven_complete_days():
    now = datetime(2026, 9, 7, 9)
    config = {"weeklyEmailReportsEnabled": True, "weeklyEmailReportDay": 1, "weeklyEmailReportHour": 9}
    assert weekly_window(now, config, False) == ("2026-08-31", "2026-09-06")
    with pytest.raises(SkippedRun):
        weekly_window(now.replace(hour=10), config, False)
    with pytest.raises(SkippedRun):
        weekly_window(now, {}, False)
