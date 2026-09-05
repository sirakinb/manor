"""Email: Zoho Campaigns → workspace_email_campaigns (+ _links).

Incremental like the old daily refresh: campaigns that are new or sent within
`recentDays` (60) get their report re-pulled; link-level clicks and device
stats are pulled for processed campaigns sent within `linksDays` (365).
Untouched campaigns keep their stored numbers.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import psycopg2.extras

from ..context import RunContext, RunResult
from ..db import connection, jsonb, new_id, upsert_rows, utc_now
from ..errors import PipelineError
from ..http import get_json, post_form_json

API = "https://campaigns.zoho.com/api/v1.1"
ACCOUNTS = "https://accounts.zoho.com"


def access_token(credential: dict[str, str]) -> str:
    body = post_form_json(
        f"{ACCOUNTS}/oauth/v2/token",
        {
            "grant_type": "refresh_token",
            "client_id": credential["clientId"],
            "client_secret": credential["clientSecret"],
            "refresh_token": credential["refreshToken"],
        },
    )
    if "access_token" not in body:
        raise PipelineError("Zoho Campaigns token refresh failed (check the zoho-campaigns credential)")
    return body["access_token"]


def api_get(token: str, path: str) -> dict[str, Any]:
    body = get_json(f"{API}/{path}", headers={"Authorization": f"Zoho-oauthtoken {token}"}, timeout=40)
    if not isinstance(body, dict):
        raise PipelineError("Zoho Campaigns returned an invalid response")
    # 6101 is the documented empty recent-campaigns view, not a failed pull.
    if str(body.get("code")) == "6101" and path.startswith("recentcampaigns?"):
        return {"recent_campaigns": []}
    if str(body.get("code", "0")) != "0" or str(body.get("status", "")).lower() == "error":
        raise PipelineError("Zoho Campaigns request failed; check the credential and provider availability")
    return body


def all_campaigns(token: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    fromindex, rng = 1, 100
    while True:
        body = api_get(token, f"recentcampaigns?resfmt=JSON&range={rng}&fromindex={fromindex}")
        batch = body.get("recent_campaigns") or []
        if not batch:
            break
        out.extend(batch)
        total = to_int(body.get("total_record_count")) or 0
        fromindex += len(batch)
        if (total and len(out) >= total) or len(batch) < rng:
            break
        time.sleep(0.1)
    seen: set[str] = set()
    unique = []
    for campaign in out:
        cid = campaign.get("campaignId")
        if cid and cid not in seen:
            seen.add(cid)
            unique.append(campaign)
    return unique


def to_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def epoch_ms(value: Any) -> datetime | None:
    ms = to_int(value)
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)


def report_for(token: str, key: str) -> dict[str, Any]:
    rows = api_get(token, f"getcampaignreports?resfmt=JSON&campaignkey={key}").get("campaign-reports")
    return rows[0] if isinstance(rows, list) and rows else {}


def link_clicks_for(token: str, key: str) -> dict[str, list[int]]:
    """url -> [unique_clickers, total_clicks], paging until a short page."""
    agg: dict[str, list[int]] = {}
    fromindex, rng = 1, 100
    while True:
        body = api_get(
            token,
            f"getcampaignrecipientsdata?resfmt=JSON&campaignkey={key}"
            f"&action=clickedcontacts&fromindex={fromindex}&range={rng}",
        )
        batch = body.get("list_of_details") or []
        for contact in batch:
            for click in contact.get("urlclicks") or []:
                url = click.get("url")
                if not url:
                    continue
                entry = agg.setdefault(url, [0, 0])
                entry[0] += 1
                entry[1] += to_int(click.get("count")) or 0
        if len(batch) < rng:
            break
        fromindex += rng
        time.sleep(0.12)
    return agg


def device_stats(details: dict[str, Any]) -> dict[str, Any]:
    """Zoho names the useragent buckets *_percent but the values are raw counts."""
    ua = details.get("useragentstats") or {}

    def counts(section: str) -> dict[str, int]:
        out = {}
        for key, value in (ua.get(section) or {}).items():
            n = to_int(value)
            if n:
                out[key] = n
        return out

    return {
        "device": {
            "computer": sum(counts("computer_percent").values()),
            "mobile": sum(counts("mobile_percent").values()),
            "tablet": sum(counts("tablets_percent").values()),
        },
        "email_clients": counts("emailclients_percent"),
        "browsers": counts("browsers_percent"),
    }


def campaign_row(workspace_id: str, campaign: dict[str, Any], report: dict[str, Any], now: datetime) -> list[Any]:
    return [
        new_id(),
        workspace_id,
        campaign.get("campaignId"),
        campaign.get("campaign_key"),
        campaign.get("campaign_name"),
        campaign.get("subject"),
        campaign.get("from_email"),
        campaign.get("reply_to"),
        campaign.get("campaign_status") or "",
        campaign.get("campaigntype"),
        epoch_ms(campaign.get("sent_time")),
        epoch_ms(campaign.get("created_time")),
        to_int(report.get("emails_sent_count")),
        to_int(report.get("delivered_count")),
        to_int(report.get("opens_count")),
        to_int(report.get("unopened")),
        to_int(report.get("unique_clicks_count")),
        to_int(report.get("bounces_count")),
        to_int(report.get("hardbounce_count")),
        to_int(report.get("softbounce_count")),
        to_int(report.get("unsub_count")),
        to_int(report.get("spams_count")),
        to_int(report.get("complaints_count")),
        to_int(report.get("forwards_count")),
        to_float(report.get("delivered_percent")),
        to_float(report.get("open_percent")),
        to_float(report.get("unique_clicked_percent")),
        to_float(report.get("clicksperopenrate")),
        to_float(report.get("bounce_percent")),
        to_float(report.get("unsubscribe_percent")),
        now,
        now,
    ]


CAMPAIGN_COLUMNS = [
    "id", "workspaceId", "sourceCampaignId", "campaignKey", "name", "subject", "fromEmail",
    "replyTo", "status", "campaignType", "sentAt", "sourceCreatedAt", "emailsSent", "delivered",
    "opens", "unopened", "uniqueClicks", "bounces", "hardBounces", "softBounces", "unsubscribes",
    "spam", "complaints", "forwards", "deliveredPercent", "openPercent", "clickPercent",
    "clicksPerOpen", "bouncePercent", "unsubPercent", "statsSyncedAt", "updatedAt",
]


def run(context: RunContext) -> RunResult:
    credential = context.credential("zoho-campaigns")
    for key in ("clientId", "clientSecret", "refreshToken"):
        if not credential.get(key):
            raise PipelineError(f"zoho-campaigns credential is missing {key}")
    recent_days = int(context.options.get("recentDays") or 60)
    links_days = int(context.options.get("linksDays") or 365)
    incremental = not bool(context.options.get("full"))

    token = access_token(credential)
    campaigns = all_campaigns(token)

    with connection() as conn:
        cur = conn.cursor()
        cur.execute(
            'select "sourceCampaignId" from workspace_email_campaigns where "workspaceId" = %s',
            (context.workspace_id,),
        )
        known = {row[0] for row in cur.fetchall()} if incremental else set()
        cur.close()

    cutoff_ms = (time.time() - recent_days * 86400) * 1000
    links_cutoff_ms = (time.time() - links_days * 86400) * 1000
    now = utc_now()
    rows: list[list[Any]] = []
    link_rows: list[list[Any]] = []
    detail_rows: list[tuple[Any, ...]] = []
    link_campaign_ids: set[str] = set()
    reports = skipped = 0
    for campaign in campaigns:
        status = str(campaign.get("campaign_status") or "")
        key = campaign.get("campaign_key")
        cid = campaign.get("campaignId")
        sent_ms = to_int(campaign.get("sent_time"))
        if incremental and not (cid not in known or (sent_ms is not None and sent_ms >= cutoff_ms)):
            skipped += 1
            continue
        report: dict[str, Any] = {}
        if status.lower() == "sent" and key:
            report = report_for(token, key)
            reports += 1
            time.sleep(0.12)
            if sent_ms is not None and sent_ms >= links_cutoff_ms:
                link_campaign_ids.add(cid)
                for url, (unique, total) in link_clicks_for(token, key).items():
                    link_rows.append([new_id(), context.workspace_id, cid, url, unique, total])
                time.sleep(0.12)
                details = api_get(token, f"getcampaigndetails?resfmt=JSON&campaignkey={key}")
                det = (details.get("campaign-details") or [{}])[0]
                detail_rows.append((
                    jsonb(device_stats(details)), det.get("sender_name"), det.get("topic_name"),
                    det.get("preheader"), context.workspace_id, cid,
                ))
                time.sleep(0.12)
        rows.append(campaign_row(context.workspace_id, campaign, report, now))

    if not rows:
        return RunResult(records_loaded=0, notes=f"nothing new (skipped {skipped})")

    with connection() as conn:
        cur = conn.cursor()
        upsert_rows(cur, "workspace_email_campaigns", CAMPAIGN_COLUMNS, rows, ["workspaceId", "sourceCampaignId"])
        if link_campaign_ids:
            cur.execute(
                'delete from workspace_email_campaign_links where "workspaceId" = %s and "sourceCampaignId" = any(%s)',
                (context.workspace_id, list(link_campaign_ids)),
            )
            if link_rows:
                psycopg2.extras.execute_values(
                    cur,
                    'insert into workspace_email_campaign_links (id, "workspaceId", "sourceCampaignId", url, "uniqueClickers", "totalClicks") values %s '
                    'on conflict ("workspaceId", "sourceCampaignId", url) do update set "uniqueClickers" = excluded."uniqueClickers", "totalClicks" = excluded."totalClicks", "syncedAt" = now()',
                    link_rows,
                    page_size=500,
                )
        if detail_rows:
            cur.executemany(
                'update workspace_email_campaigns set "useragentStats" = %s, "senderName" = %s, topic = %s, preheader = %s '
                'where "workspaceId" = %s and "sourceCampaignId" = %s',
                detail_rows,
            )
        cur.close()
    return RunResult(
        records_loaded=len(rows),
        notes=f"{len(rows)} campaigns refreshed, {reports} reports, {len(link_rows)} link rows across {len(link_campaign_ids)} campaigns, skipped {skipped}",
    )
