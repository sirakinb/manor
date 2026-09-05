"""Social: Meta Graph API (Instagram) → workspace_instagram_daily / _media / _stats."""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

from ..context import RunContext, RunResult
from ..db import connection, jsonb, new_id, upsert_rows, utc_now
from ..errors import PipelineError
from ..http import get_json

API = "https://graph.facebook.com/v23.0"
DAILY_BACKFILL_DAYS = 30
MEDIA_LIMIT = 60


def graph(token: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    query = dict(params or {})
    query["access_token"] = token
    return get_json(f"{API}/{path}", params=query, timeout=40, raise_for_status=False) or {}


def day(value: dt.date) -> str:
    return value.strftime("%Y-%m-%d")


def daily_series(token: str, ig: str, metric: str, days: int, today: dt.date) -> dict[str, Any]:
    body = graph(token, f"{ig}/insights", {
        "metric": metric, "period": "day",
        "since": day(today - dt.timedelta(days=days)), "until": day(today),
    })
    out: dict[str, Any] = {}
    for entry in body.get("data", []):
        for value in entry.get("values", []):
            key = (value.get("end_time") or "")[:10]
            if key:
                out[key] = value.get("value")
    return out


def totals_28d(token: str, ig: str, today: dt.date) -> dict[str, Any]:
    body = graph(token, f"{ig}/insights", {
        "metric": "reach,profile_views,accounts_engaged,total_interactions",
        "period": "day", "metric_type": "total_value",
        "since": day(today - dt.timedelta(days=28)), "until": day(today),
    })
    return {entry["name"]: (entry.get("total_value") or {}).get("value") for entry in body.get("data", []) if "name" in entry}


def demographics(token: str, ig: str) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    for breakdown in ("age", "gender", "country", "city"):
        body = graph(token, f"{ig}/insights", {
            "metric": "follower_demographics", "period": "lifetime",
            "metric_type": "total_value", "breakdown": breakdown,
        })
        data = body.get("data")
        if not data:
            continue
        results = ((data[0].get("total_value") or {}).get("breakdowns") or [{}])[0].get("results", [])
        out[breakdown] = {"::".join(r.get("dimension_values", [])): r.get("value") for r in results}
    return out or None


def media(token: str, ig: str, limit: int) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    body = graph(token, f"{ig}/media", {
        "fields": "caption,media_type,timestamp,permalink,thumbnail_url,like_count,comments_count",
        "limit": limit,
    })
    out = []
    for item in body.get("data") or []:
        insights = graph(token, f"{item.get('id')}/insights", {"metric": "reach,saved,shares,views,total_interactions"})
        if "error" in insights:  # views does not apply to every media type
            insights = graph(token, f"{item.get('id')}/insights", {"metric": "reach,saved,shares,total_interactions"})
        values = {x["name"]: (x.get("values") or [{}])[0].get("value") for x in insights.get("data", []) if "name" in x}
        out.append((item, values))
        time.sleep(0.05)
    return out


def parse_ts(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("+0000", "+00:00")).astimezone(dt.timezone.utc).replace(tzinfo=None)
    except ValueError:
        return None


def run(context: RunContext) -> RunResult:
    credential = context.credential("instagram")
    token, ig = credential.get("pageToken"), credential.get("igUserId")
    if not token or not ig:
        raise PipelineError("instagram credential needs pageToken and igUserId")
    today = dt.datetime.now(dt.timezone.utc).date()

    profile = graph(token, ig, {"fields": "username,name,biography,profile_picture_url,followers_count,follows_count,media_count"})
    if "error" in profile:
        raise PipelineError("Instagram profile fetch failed; check the instagram credential")
    reach = daily_series(token, ig, "reach", DAILY_BACKFILL_DAYS, today)
    new_followers = daily_series(token, ig, "follower_count", DAILY_BACKFILL_DAYS, today)
    totals = totals_28d(token, ig, today)
    demo = demographics(token, ig)
    posts = media(token, ig, MEDIA_LIMIT)
    now = utc_now()
    ws = context.workspace_id

    daily_rows = []
    today_key = day(today)
    for key in sorted(set(reach) | set(new_followers) | {today_key}):
        is_today = key == today_key
        daily_rows.append([
            new_id(), ws, ig, key,
            profile.get("followers_count") if is_today else None,
            profile.get("follows_count") if is_today else None,
            profile.get("media_count") if is_today else None,
            reach.get(key), new_followers.get(key), now,
        ])
    media_rows = [
        [
            new_id(), ws, ig, item.get("id"), item.get("media_type"), item.get("caption"),
            item.get("permalink"), item.get("thumbnail_url"), parse_ts(item.get("timestamp")),
            item.get("like_count"), item.get("comments_count"), values.get("reach"), values.get("views"),
            values.get("saved"), values.get("shares"), values.get("total_interactions"), now, now,
        ]
        for item, values in posts
    ]

    with connection() as conn:
        cur = conn.cursor()
        # coalesce merge: a day's row keeps what it already knew when a later pull brings nulls.
        import psycopg2.extras

        psycopg2.extras.execute_values(cur, """
            insert into workspace_instagram_daily
              (id, "workspaceId", "igUserId", date, followers, follows, "mediaCount", reach, "newFollowers", "updatedAt")
            values %s
            on conflict ("workspaceId", "igUserId", date) do update set
              followers = coalesce(excluded.followers, workspace_instagram_daily.followers),
              follows = coalesce(excluded.follows, workspace_instagram_daily.follows),
              "mediaCount" = coalesce(excluded."mediaCount", workspace_instagram_daily."mediaCount"),
              reach = coalesce(excluded.reach, workspace_instagram_daily.reach),
              "newFollowers" = coalesce(excluded."newFollowers", workspace_instagram_daily."newFollowers"),
              "updatedAt" = now()
        """, daily_rows, page_size=200)
        upsert_rows(cur, "workspace_instagram_media", [
            "id", "workspaceId", "igUserId", "mediaId", "mediaType", "caption", "permalink", "thumbnailUrl",
            "postedAt", "likeCount", "commentsCount", "reach", "views", "saved", "shares", "totalInteractions",
            "statsSyncedAt", "updatedAt",
        ], media_rows, ["workspaceId", "mediaId"])
        upsert_rows(cur, "workspace_instagram_stats", [
            "id", "workspaceId", "igUserId", "username", "name", "biography", "profilePictureUrl", "followers",
            "follows", "mediaCount", "reach28d", "profileViews28d", "accountsEngaged28d", "totalInteractions28d",
            "demographics", "capturedAt", "updatedAt",
        ], [[
            new_id(), ws, ig, profile.get("username"), profile.get("name"), profile.get("biography"),
            profile.get("profile_picture_url"), profile.get("followers_count"), profile.get("follows_count"),
            profile.get("media_count"), totals.get("reach"), totals.get("profile_views"),
            totals.get("accounts_engaged"), totals.get("total_interactions"), jsonb(demo) if demo else None, now, now,
        ]], ["workspaceId", "igUserId"])
        cur.close()
    return RunResult(
        records_loaded=len(daily_rows) + len(media_rows) + 1,
        notes=f"@{profile.get('username')} followers={profile.get('followers_count')} daily={len(daily_rows)} media={len(media_rows)} reach28d={totals.get('reach')}",
    )
