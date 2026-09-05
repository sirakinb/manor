"""Opt-in weekly email drafts, covering the previous seven complete local days."""
import hashlib
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..context import RunContext, RunResult
from ..db import connection, jsonb, new_id
from ..errors import SkippedRun
from . import reports


def weekly_window(now: datetime, workspace: dict, manual: bool) -> tuple[str, str]:
    if not manual:
        if not workspace.get("weeklyEmailReportsEnabled"):
            raise SkippedRun("weekly reports disabled")
        if (now.weekday() + 1) % 7 != int(workspace.get("weeklyEmailReportDay", 1)) or now.hour != int(workspace.get("weeklyEmailReportHour", 9)):
            raise SkippedRun("not the configured report day/hour")
    return (now.date() - timedelta(days=7)).isoformat(), (now.date() - timedelta(days=1)).isoformat()


def run(context: RunContext) -> RunResult:
    now = datetime.fromisoformat(str(context.options["scheduledFor"])) if context.options.get("scheduledFor") else datetime.now(ZoneInfo(context.timezone))
    start, end = weekly_window(now.astimezone(ZoneInfo(context.timezone)), context.workspace, context.manual)
    report_id = "weekly-email-" + hashlib.sha256(f"{context.workspace_id}:{start}:{end}".encode()).hexdigest()
    request = {"kind": "email", "from": start, "to": end}
    with connection() as conn:
        cur = conn.cursor()
        cur.execute('''insert into workspace_reports (id, "workspaceId", "reportType", title, status, "dateRangeStart", "dateRangeEnd", report, "shareToken", "updatedAt")
            values (%s, %s, 'email', %s, 'queued', %s, %s, %s, %s, now()) on conflict (id) do nothing''',
            (report_id, context.workspace_id, f"Weekly email recap · {start} – {end}", start, end, jsonb({"request": request}), new_id()))
    return reports.run(RunContext(context.run_id, context.workspace_id, context.credentials, {**context.options, "reportId": report_id}))
