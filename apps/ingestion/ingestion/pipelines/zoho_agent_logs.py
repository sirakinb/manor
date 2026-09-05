"""Voice calls: Zoho CRM Agent_Logs (tenants) + Agent_Logs_Landlords → raw
landing via dlt → normalized into workspace_voice_calls / _transcripts /
_call_analyses.

The raw landing is per workspace (dataset raw_zoho_<workspace hash>) and
dlt keeps its incremental state in the destination,
so a fresh container resumes from `Modified_Time` instead of re-scanning.
"""

from __future__ import annotations

import os
import hashlib
from typing import Any, Iterator

import dlt
import requests

from ..context import RunContext, RunResult
from ..db import connection, database_url
from ..errors import PipelineError

ACCOUNTS_URL = "https://accounts.zoho.com"
PER_PAGE = 200

MODULES = {
    "tenant": {
        "module": "Agent_Logs",
        "table": "agent_logs",
        "source_system": "zoho_agent_logs",
        "fields": [
            "id", "Created_Time", "Modified_Time", "Caller_Name", "Phone_Number", "Call_Summary",
            "Transcript", "Call_Recording", "Call_Number", "Call_Back_Required",
            "Could_this_call_have_been_answered_by_AI", "Date_Time_1", "Stage", "Name1", "Owner",
        ],
        "callback_column": "call_back_required",
        "ai_note_column": "could_this_call_have_been_answered_by_ai",
    },
    "landlord": {
        "module": "Agent_Logs_Landlords",
        "table": "agent_logs_landlords",
        "source_system": "zoho_agent_logs_landlords",
        "fields": [
            "id", "Created_Time", "Modified_Time", "Caller_Name", "Phone_Number", "Call_Summary",
            "Transcript", "Call_Recording", "Call_ID", "Call_back_required",
            "Could_this_have_been_answered_by_the_AI", "Date_Time_1", "Name", "Owner",
        ],
        "callback_column": "call_back_required",
        "ai_note_column": "could_this_have_been_answered_by_the_ai",
    },
}


def dataset_suffix(workspace_id: str) -> str:
    """A short, identifier-safe tag so each workspace lands in its own raw dataset."""
    return hashlib.sha256(workspace_id.encode()).hexdigest()[:32]


def zoho_access_token(credential: dict[str, str], accounts_url: str = ACCOUNTS_URL) -> tuple[str, str]:
    response = requests.post(
        f"{accounts_url.rstrip('/')}/oauth/v2/token",
        params={
            "refresh_token": credential["refreshToken"],
            "client_id": credential["clientId"],
            "client_secret": credential["clientSecret"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()
    if "access_token" not in body:
        raise PipelineError("Zoho token refresh failed (check the zoho-crm credential)")
    return body["access_token"], body.get("api_domain", "https://www.zohoapis.com")


def fetch_records(
    api_domain: str,
    access_token: str,
    module: str,
    fields: list[str],
    modified_since: str | None,
) -> Iterator[dict[str, Any]]:
    """Page through a Zoho module, newest changes only when a cursor is known."""
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    if modified_since:
        headers["If-Modified-Since"] = modified_since
    params: dict[str, Any] = {
        "fields": ",".join(fields),
        "per_page": PER_PAGE,
        "sort_by": "Modified_Time",
        "sort_order": "asc",
    }
    page_token: str | None = None
    while True:
        call_params = dict(params)
        if page_token:
            call_params["page_token"] = page_token
        response = requests.get(
            f"{api_domain}/crm/v8/{module}", params=call_params, headers=headers, timeout=60
        )
        if response.status_code in (204, 304):
            return
        response.raise_for_status()
        body = response.json()
        yield from body.get("data", [])
        info = body.get("info", {})
        if info.get("more_records") and info.get("next_page_token"):
            page_token = info["next_page_token"]
        else:
            return


def make_resource(name: str, module: str, fields: list[str], api_domain: str, access_token: str):
    # Explicit columns keep normalization valid even if a field is absent or
    # null in every record on the first pull.
    columns = {field: {"data_type": "text", "nullable": True} for field in fields if field != "Owner"}
    @dlt.resource(name=name, primary_key="id", write_disposition="merge", columns=columns)
    def agent_logs(
        modified_since=dlt.sources.incremental("Modified_Time", initial_value=None),
    ) -> Iterator[dict[str, Any]]:
        last_value = modified_since.last_value if modified_since else None
        yield from fetch_records(api_domain, access_token, module, fields, last_value)

    return agent_logs


NORMALIZE_SQL = """
with src as (
  select
    r.id::text                                          as source_call_id,
    nullif(btrim(r.caller_name), '')                    as caller_name,
    nullif(btrim(r.phone_number), '')                   as caller_phone,
    (r.created_time::text)::timestamptz                 as call_started_at,
    case when r.{callback} is null then null
         else upper(btrim(r.{callback})) = 'YES' end    as callback_requested,
    case when r.{callback} is null then null
         else upper(btrim(r.{callback})) <> 'YES' end   as ai_resolved,
    nullif(btrim(r.{ai_note}), '')                      as ai_resolution_notes,
    nullif(btrim(r.call_recording), '')                 as recording_url,
    nullif(btrim(r.transcript), '')                     as transcript_text,
    nullif(btrim(r.call_summary), '')                   as summary,
    to_jsonb(r)                                         as raw
  from {dataset}.{table} r
  where r.id is not null
),
up_calls as (
  insert into workspace_voice_calls (
    id, "workspaceId", "sourceCallId", "sourceSystem", "agentType", "callerName", "callerPhone",
    "callStartedAt", "callbackRequested", "aiResolved", "aiResolutionNotes", "recordingUrl",
    "sourceCreatedAt", raw, "createdAt", "updatedAt")
  select gen_random_uuid()::text, %(ws)s, s.source_call_id, %(system)s, %(agent_type)s,
         s.caller_name, s.caller_phone, s.call_started_at, s.callback_requested, s.ai_resolved,
         s.ai_resolution_notes, s.recording_url, s.call_started_at, s.raw, now(), now()
  from src s
  on conflict ("workspaceId", "sourceCallId") do update set
    "agentType" = excluded."agentType",
    "callerName" = excluded."callerName",
    "callerPhone" = excluded."callerPhone",
    "callStartedAt" = excluded."callStartedAt",
    "callbackRequested" = excluded."callbackRequested",
    "aiResolved" = excluded."aiResolved",
    "aiResolutionNotes" = excluded."aiResolutionNotes",
    "recordingUrl" = excluded."recordingUrl",
    "sourceCreatedAt" = excluded."sourceCreatedAt",
    raw = excluded.raw,
    "updatedAt" = now()
  returning id as voice_call_id, "sourceCallId" as source_call_id
),
up_transcripts as (
  insert into workspace_voice_transcripts (id, "workspaceId", "voiceCallId", "transcriptText", "createdAt", "updatedAt")
  select gen_random_uuid()::text, %(ws)s, c.voice_call_id, s.transcript_text, now(), now()
  from up_calls c join src s using (source_call_id)
  where s.transcript_text is not null
  on conflict ("voiceCallId") do update set
    "transcriptText" = excluded."transcriptText",
    "updatedAt" = now()
  returning 1
)
insert into workspace_voice_call_analyses (id, "workspaceId", "voiceCallId", summary, "followUpRequired", "createdAt", "updatedAt")
select gen_random_uuid()::text, %(ws)s, c.voice_call_id, s.summary, s.callback_requested, now(), now()
from up_calls c join src s using (source_call_id)
where s.summary is not null
on conflict ("voiceCallId") do update set
  summary = excluded.summary,
  "followUpRequired" = excluded."followUpRequired",
  "updatedAt" = now()
"""


def normalize(cur: Any, workspace_id: str, dataset: str, agent_type: str) -> int:
    spec = MODULES[agent_type]
    cur.execute(
        "select to_regclass(%s)", (f"{dataset}.{spec['table']}",),
    )
    if cur.fetchone()[0] is None:
        return 0
    sql = NORMALIZE_SQL.format(
        dataset=dataset,
        table=spec["table"],
        callback=spec["callback_column"],
        ai_note=spec["ai_note_column"],
    )
    cur.execute(sql, {"ws": workspace_id, "system": spec["source_system"], "agent_type": agent_type})
    cur.execute(
        'select count(*) from workspace_voice_calls where "workspaceId" = %s and "agentType" = %s',
        (workspace_id, agent_type),
    )
    return int(cur.fetchone()[0])


def run(context: RunContext) -> RunResult:
    credential = context.credential("zoho-crm")
    for key in ("clientId", "clientSecret", "refreshToken"):
        if not credential.get(key):
            raise PipelineError(f"zoho-crm credential is missing {key}")
    accounts_url = str(context.options.get("zohoAccountsUrl") or ACCOUNTS_URL)
    access_token, api_domain = zoho_access_token(credential, accounts_url)

    suffix = dataset_suffix(context.workspace_id)
    dataset = f"raw_zoho_{suffix}"
    pipelines_dir = os.environ.get("DLT_PIPELINES_DIR") or "/tmp/dlt"
    for agent_type, spec in MODULES.items():
        pipeline = dlt.pipeline(
            pipeline_name=f"zoho_agent_logs_{suffix}_{agent_type}",
            destination=dlt.destinations.postgres(credentials=database_url()),
            dataset_name=dataset,
            pipelines_dir=pipelines_dir,
        )
        resource = make_resource(spec["table"], spec["module"], spec["fields"], api_domain, access_token)
        # run restores destination state itself, including after a fresh start.
        pipeline.run(resource).raise_on_failed_jobs()

    counts = {}
    with connection() as conn:
        cur = conn.cursor()
        for agent_type in MODULES:
            counts[agent_type] = normalize(cur, context.workspace_id, dataset, agent_type)
        cur.close()
    return RunResult(
        records_loaded=sum(counts.values()),
        notes=f"tenant={counts.get('tenant', 0)} landlord={counts.get('landlord', 0)} voice calls normalized",
    )
