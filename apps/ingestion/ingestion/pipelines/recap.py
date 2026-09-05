"""Monthly voice recap → workspace_reports (status "draft"; Manor's approve
and send flow takes it from there, nothing is emailed here).

Runs on an hourly tick and self-gates on the workspace's report day/hour in
its timezone; it does not regenerate a month that already has a recap for
the same audience unless the run is manual (and even then never one that
was approved or sent). Per-workspace configuration comes from
workspace_context keys instead of the old per-slug constants:

    recap-revenue-config   JSON {"tenant": {...}, "landlord": {...}} (see DEFAULT_REVENUE)
    recap-owner-name       first name the narrative addresses
    recap-agent-name       the voice agent's name in prose
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests

from ..context import RunContext, RunResult
from ..db import connection, jsonb, new_id
from ..errors import PipelineError, SkippedRun
from .recap_metrics import compute_metrics, recap_due, revenue_model

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-v4-pro"
SAMPLE_LIMIT = 60

CONTEXT_REVENUE = "recap-revenue-config"
CONTEXT_OWNER = "recap-owner-name"
CONTEXT_AGENT = "recap-agent-name"


def load_context(cur: Any, workspace_id: str) -> dict[str, str]:
    cur.execute(
        'select key, content from workspace_context where "workspaceId" = %s and key = any(%s)',
        (workspace_id, [CONTEXT_REVENUE, CONTEXT_OWNER, CONTEXT_AGENT]),
    )
    return {key: content for key, content in cur.fetchall()}


def revenue_config(context: dict[str, str]) -> dict[str, Any] | None:
    raw = context.get(CONTEXT_REVENUE)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise PipelineError(f"{CONTEXT_REVENUE} is not valid JSON") from error
    return parsed if isinstance(parsed, dict) else None


def month_rows(cur: Any, workspace_id: str, year: int, month: int, agent_type: str, tz: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        select (c."callStartedAt" at time zone 'UTC' at time zone %(tz)s) as lt,
               c."aiResolved", c."callbackRequested",
               coalesce(t."transcriptText", '') as transcript,
               coalesce(a.summary, '') as summary
        from workspace_voice_calls c
        left join workspace_voice_transcripts t on t."voiceCallId" = c.id
        left join workspace_voice_call_analyses a on a."voiceCallId" = c.id
        where c."workspaceId" = %(ws)s
          and c."agentType" = %(at)s
          and c."callStartedAt" is not null
          and (c."callStartedAt" at time zone 'UTC' at time zone %(tz)s) >= make_date(%(y)s, %(m)s, 1)
          and (c."callStartedAt" at time zone 'UTC' at time zone %(tz)s) <  (make_date(%(y)s, %(m)s, 1) + interval '1 month')
        order by c."callStartedAt"
        """,
        {"ws": workspace_id, "at": agent_type, "tz": tz, "y": year, "m": month},
    )
    return [
        {"lt": lt, "ai_resolved": ai, "callback_requested": cb, "transcript": transcript, "summary": summary}
        for lt, ai, cb, transcript, summary in cur.fetchall()
    ]


def sample_summaries(rows: list[dict[str, Any]], limit: int = SAMPLE_LIMIT) -> list[str]:
    substantive = [r["summary"] for r in rows if len(r.get("summary") or "") > 40]
    if not substantive:
        return []
    step = max(1, len(substantive) // limit)
    return substantive[::step][:limit]


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except ValueError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            return json.loads(match.group(0))
        raise


def narrative_prompt(workspace_name: str, owner_name: str | None, agent_name: str | None, metrics: dict[str, Any], revenue: dict[str, Any], samples: list[str], agent_type: str) -> tuple[str, str]:
    if agent_type == "landlord":
        audience = (
            "This is the LANDLORD/OWNER voice agent — it fields calls from property owners inquiring "
            "about having the company manage or lease up their property. A 'win' is a NEW MANAGED "
            "PROPERTY (a signed management agreement), NOT a lease. Frame the opportunity as owner "
            "acquisition / new doors under management."
        )
        opp_hint = "new managed properties / owner-acquisition revenue"
    else:
        audience = (
            "This is the TENANT voice agent — it fields calls from prospective and current tenants. "
            "A 'win' is a SIGNED LEASE. Frame the opportunity as leasing/occupancy."
        )
        opp_hint = "the leasing/revenue opportunity"
    agent_label = agent_name or "the AI voice agent"
    system = (
        "You are an operations analyst for a property-management company writing the monthly "
        "executive recap of an AI voice agent's performance. Write in a confident, concise, executive "
        "tone. Ground EVERY claim strictly in the provided metrics and call summaries — never invent "
        f"numbers, callers, or facts. Reference the real figures. {audience} "
        f"The AI voice agent is named '{agent_label}' — refer to the agent by that name "
        f"(e.g. \"{agent_label} handled …\"). Do NOT call the agent by the owner's name. "
        "STAFFING CONSTRAINT: live human phone coverage is NOT available. In action_items, "
        "opportunities, and wins, NEVER recommend warm transfers, live/human transfers, routing "
        "callers to a person, having staff call people back, staffing the phones, or hiring — those "
        "are not options. Frame every recommendation around what the AI agent or operations can do "
        "WITHOUT adding human phone coverage (better scripts/answers, SMS/text follow-ups, updated "
        "listing info, self-service, process changes). You may still factually note that some "
        "callers requested a human; just never recommend providing one. Return STRICT JSON only (no markdown)."
    )
    schema = (
        'Return JSON with EXACTLY these keys: '
        '{"executive_assessment": string (2-4 sentences, address the owner by first name if given), '
        f'"what_this_means": string (2-3 sentences on {opp_hint}), '
        '"wins": [string] (4-6 concrete wins), '
        '"opportunities": [string] (4-7 areas to tighten up), '
        '"action_items": [{"title": string, "detail": string}] (5-7 recommended next steps), '
        '"bottom_line": string (2-3 sentence closing summary), '
        '"summary": string (1-2 sentence summary for a report index)}'
    )
    context = {
        "headline": metrics["headline"],
        "categories": [(c["label"], c["count"]) for c in metrics["categories"]],
        "coverage_windows": metrics["coverage_windows"],
        "timing": metrics["timing"],
        "follow_up_drivers": [(d["label"], d["count"]) for d in metrics["follow_up_drivers"]],
        "bedroom_demand": [(b["label"], b["count"]) for b in metrics["bedroom_demand"]],
        "budget_demand": [(b["label"], b["count"]) for b in metrics["budget_demand"]],
        "revenue": revenue,
    }
    user = (
        f"Workspace: {workspace_name}\n"
        f"Owner first name (address the recap to this person): {owner_name or '(unknown)'}\n"
        f"AI voice agent name (refer to the agent as this): {agent_label}\n"
        f"Month: {metrics['period']['month_name']} {metrics['period']['year']}\n\n"
        f"Computed metrics (authoritative — use these exact numbers):\n{json.dumps(context, default=str)}\n\n"
        f"Representative call summaries (qualitative texture, not for counts):\n{json.dumps(samples[:SAMPLE_LIMIT])}\n\n{schema}"
    )
    return system, user


def generate_narrative(credential: dict[str, str], system: str, user: str) -> dict[str, Any]:
    api_key = credential.get("apiKey")
    if not api_key:
        raise PipelineError("openrouter credential needs apiKey")
    model = credential.get("model") or DEFAULT_MODEL
    response = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
            "max_tokens": 8000,
            "temperature": 0.3,
        },
        timeout=120,
    )
    if response.status_code != 200:
        raise PipelineError(f"OpenRouter responded {response.status_code} while writing the narrative")
    content = response.json()["choices"][0]["message"]["content"]
    parsed = _parse_json(content)
    return {
        "executive_assessment": parsed.get("executive_assessment", ""),
        "what_this_means": parsed.get("what_this_means", ""),
        "wins": parsed.get("wins") or [],
        "opportunities": parsed.get("opportunities") or [],
        "action_items": parsed.get("action_items") or [],
        "bottom_line": parsed.get("bottom_line", ""),
        "summary": parsed.get("summary", ""),
    }


def store_report(cur: Any, workspace_id: str, recap: dict[str, Any], activity_approval: str) -> str | None:
    """Insert the month's draft; returns None (and writes nothing) when an
    approved or sent recap for the same month and audience already exists."""
    period = recap["metrics"]["period"]
    agent_type = recap["agent_type"]
    audience = "Landlords" if agent_type == "landlord" else "Tenants"
    title = f"Voice AI Recap ({audience}) · {period['month_name']} {period['year']}"
    start = datetime.fromisoformat(period["start"])
    end = datetime.fromisoformat(period["end"]).replace(hour=23, minute=59, second=59)
    cur.execute(
        """
        select id, "approvedAt", "sentAt" from workspace_reports
        where "workspaceId" = %s and "reportType" = 'voice_monthly'
          and "dateRangeStart" = %s and "dateRangeEnd" = %s
          and coalesce(report->>'agent_type', 'tenant') = %s
        for update
        """,
        (workspace_id, start, end, agent_type),
    )
    existing = cur.fetchall()
    if any(approved or sent for _, approved, sent in existing):
        return None
    if existing:
        cur.execute("delete from workspace_reports where id = any(%s)", ([row[0] for row in existing],))
    report_id = new_id()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    recap["generated_at"] = now.isoformat()
    cur.execute(
        """
        insert into workspace_reports
          (id, "workspaceId", "reportType", title, status, "dateRangeStart", "dateRangeEnd",
           "generatedBy", "generatedAt", summary, report, "shareToken", "createdAt", "updatedAt")
        values (%s, %s, 'voice_monthly', %s, 'draft', %s, %s, 'automation:recap', %s, %s, %s, %s, now(), now())
        """,
        (
            report_id, workspace_id, title, start, end, now,
            (recap.get("narrative") or {}).get("summary", ""), jsonb(recap), new_id(),
        ),
    )
    cur.execute(
        """
        insert into workspace_activities
          (id, "workspaceId", channel, kind, title, summary, payload, status, actor, verification, "createdAt", "updatedAt")
        values (%s, %s, 'voice', 'monthly_recap_generated', %s, %s, %s, 'completed', 'workspace:monthly-recap', %s, now(), now())
        """,
        (
            new_id(), workspace_id,
            f"Monthly voice recap ({audience}) — {period['month_name']} {period['year']} drafted",
            f"Generated the {period['month_name']} {period['year']} {audience.lower()} voice-AI recap for review.",
            jsonb({"report_id": report_id, "agent_type": agent_type, "month": f"{period['year']}-{period['month']:02d}",
                   "total_calls": recap["metrics"]["headline"]["total_calls"]}),
            "auto" if activity_approval == "auto" else "pending",
        ),
    )
    return report_id


def run(context: RunContext) -> RunResult:
    workspace = context.workspace
    tz = ZoneInfo(context.timezone)
    now_local = datetime.now(tz)
    year = int(context.options.get("year") or now_local.year)
    month = int(context.options.get("month") or now_local.month)
    if not context.manual:
        if not workspace.get("monthlyVoiceReportsEnabled"):
            raise SkippedRun("monthly voice reports are disabled for this workspace")
        if not recap_due(
            now_local.date(), now_local.hour,
            int(workspace.get("monthlyVoiceReportDay") or 0), int(workspace.get("monthlyVoiceReportHour", 9)),
        ):
            raise SkippedRun("not the configured report day/hour")
    credential = context.credential("openrouter")

    generated: list[str] = []
    skipped: list[str] = []
    with connection() as conn:
        cur = conn.cursor()
        ws_context = load_context(cur, context.workspace_id)
        config = revenue_config(ws_context)
        for agent_type in ("tenant", "landlord"):
            rows = month_rows(cur, context.workspace_id, year, month, agent_type, context.timezone)
            if agent_type == "landlord" and not rows:
                continue
            if not context.manual:
                period_start = datetime(year, month, 1)
                cur.execute(
                    """select 1 from workspace_reports where "workspaceId" = %s and "reportType" = 'voice_monthly'
                       and "dateRangeStart" = %s and coalesce(report->>'agent_type', 'tenant') = %s limit 1""",
                    (context.workspace_id, period_start, agent_type),
                )
                if cur.fetchone():
                    skipped.append(f"{agent_type}: already generated")
                    continue
            metrics = compute_metrics(rows, year, month, agent_type)
            headline = metrics["headline"]
            revenue = revenue_model(config, agent_type, headline["qualified_after_hours"], headline["qualified_leasing"])
            system, user = narrative_prompt(
                str(workspace.get("name") or "Workspace"), ws_context.get(CONTEXT_OWNER), ws_context.get(CONTEXT_AGENT),
                metrics, revenue, sample_summaries(rows), agent_type,
            )
            narrative = generate_narrative(credential, system, user)
            recap = {
                "format": "voice_monthly_v1",
                "agent_type": agent_type,
                "audience": agent_type,
                "workspace_name": workspace.get("name"),
                "metrics": metrics,
                "revenue": revenue,
                "narrative": narrative,
                "generated_at": None,
            }
            report_id = store_report(cur, context.workspace_id, recap, str(workspace.get("activityApproval") or "manual"))
            if report_id:
                generated.append(f"{agent_type}: {report_id}")
            else:
                skipped.append(f"{agent_type}: an approved recap already exists")
        cur.close()
    return RunResult(
        records_loaded=len(generated),
        notes=f"{year}-{month:02d} generated [{', '.join(generated) or 'none'}] skipped [{', '.join(skipped) or 'none'}]",
    )
