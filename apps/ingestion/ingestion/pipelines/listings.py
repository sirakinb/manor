"""Listings: the REMA AppFolio index (server HTML) and the availability
Google Sheet (CSV export) → workspace_rema_listings / workspace_sheet_listings,
each kept as an exact mirror (upsert + delete-not-in-set).

Where the sources live comes from the Listings source row's config that
Manor passes as options: `remaUrl` (the /listings index) and either
`sheetCsvUrl` or `sheetId` (+ optional `sheetGid`, default 0).
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from ..context import RunContext, RunResult
from ..db import connection, new_id, upsert_rows, utc_now
from ..errors import PipelineError
from ..http import fetch_text
from ..normalize import norm_street_addr

UNIT_PREFIXES = ("unit", "apt", "#", "floor", "fl ", "suite", "ste")


def split_address(full: str) -> tuple[str, str | None]:
    """'60 Example St, - Unit 101, Philadelphia, PA 19125' -> street, unit."""
    parts = [p.strip() for p in full.split(",") if p.strip()]
    street = parts[0] if parts else full
    unit = None
    if " - " in street:
        street, unit = (s.strip() for s in street.split(" - ", 1))
    for part in parts[1:]:
        cleaned = part.lstrip("- ").strip()
        if cleaned.lower().startswith(UNIT_PREFIXES):
            unit = unit or cleaned
            break
    return street, unit


def parse_rema_listings(html: str, base_url: str) -> list[dict[str, Any]]:
    items, seen = [], set()
    for block in re.split(r'<div class="listing-item result js-listing-item"', html)[1:]:
        uid_match = re.search(r"/listings/detail/([a-f0-9-]{36})", block)
        address_match = re.search(r'js-listing-address">([^<]+)<', block)
        if not uid_match or not address_match or uid_match.group(1) in seen:
            continue
        uid = uid_match.group(1)
        seen.add(uid)
        full = " ".join(address_match.group(1).split())
        street, unit = split_address(full)
        title_match = re.search(r'js-listing-title">\s*<a[^>]*>([^<]+)<', block)
        rent_match = re.search(r'RENT</dt>\s*<dd class="detail-box__value">\s*\$([\d,]+)', block)
        bed_bath_match = re.search(r"(\d+(?:\.\d+)?\s*bd\s*/\s*\d+(?:\.\d+)?\s*ba)", block)
        available_match = re.search(r'js-listing-available">\s*([^<]*?)\s*<', block)
        items.append({
            "listable_uid": uid,
            "title": " ".join(title_match.group(1).split()) if title_match else None,
            "street_address": street,
            "unit": unit,
            "full_address": full,
            "rent": float(rent_match.group(1).replace(",", "")) if rent_match else None,
            "bed_bath": bed_bath_match.group(1) if bed_bath_match else ("Studio" if re.search(r">\s*Studio\b", block) else None),
            "available": (available_match.group(1) or None) if available_match else None,
            "detail_url": f"{base_url}/listings/detail/{uid}",
            "is_section8": "section 8" in block.lower(),
        })
    return items


def parse_sheet_rows(text: str) -> list[dict[str, Any]]:
    items, seen = [], set()
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0].strip() or row[0].strip().lower().startswith("property name"):
            continue
        raw = row[0].strip()
        if raw in seen:
            continue
        seen.add(raw)
        street = re.sub(r"\(.*", "", raw.split(",")[0]).strip().rstrip("*").strip()
        if not re.match(r"^\d", street):
            continue  # section headers and notes, not addresses
        notes = ", ".join(m.strip() for m in re.findall(r"\(([^)]*)\)", raw)) or None
        rent_text = (row[1].strip() if len(row) > 1 else "") or None
        rent_match = re.search(r"[\d,]+(?:\.\d+)?", rent_text or "")
        is_section8 = "section 8" in (rent_text or "").lower()
        items.append({
            "raw_name": raw,
            "street_address": street,
            "unit_note": notes,
            "rent_text": rent_text,
            "rent": float(rent_match.group(0).replace(",", "")) if rent_match and not is_section8 else None,
            "is_section8": is_section8,
            "beds": (row[2].strip() if len(row) > 2 else "") or None,
            "baths": (row[3].strip() if len(row) > 3 else "") or None,
        })
    return items


def sheet_csv_url(options: dict[str, Any]) -> str | None:
    if options.get("sheetCsvUrl"):
        return str(options["sheetCsvUrl"])
    sheet_id = options.get("sheetId")
    if not sheet_id:
        return None
    gid = options.get("sheetGid", 0)
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"


def run(context: RunContext) -> RunResult:
    rema_url = str(context.options.get("remaUrl") or "").rstrip("/")
    csv_url = sheet_csv_url(context.options)
    if not rema_url or not csv_url:
        raise PipelineError("Listings source config needs remaUrl and sheetId (or sheetCsvUrl)")
    base_url = rema_url[: -len("/listings")] if rema_url.endswith("/listings") else rema_url
    index_url = rema_url if rema_url.endswith("/listings") else f"{rema_url}/listings"

    rema = parse_rema_listings(fetch_text(index_url), base_url)
    if not rema:
        raise PipelineError("REMA parse produced 0 listings; the page layout may have changed")
    sheet = parse_sheet_rows(fetch_text(csv_url))
    if not sheet:
        raise PipelineError("availability sheet produced 0 rows; sheet moved or emptied?")

    ws = context.workspace_id
    now = utc_now()
    rema_rows = [[
        new_id(), ws, r["listable_uid"], r["title"], r["street_address"], r["unit"], r["full_address"],
        norm_street_addr(r["street_address"]), r["rent"], r["bed_bath"], r["available"], r["detail_url"],
        r["is_section8"], now, now,
    ] for r in rema]
    sheet_rows = [[
        new_id(), ws, s["raw_name"], s["street_address"], norm_street_addr(s["street_address"]), s["unit_note"],
        s["rent_text"], s["rent"], s["is_section8"], s["beds"], s["baths"], now,
    ] for s in sheet]

    with connection() as conn:
        cur = conn.cursor()
        upsert_rows(cur, "workspace_rema_listings", [
            "id", "workspaceId", "listableUid", "title", "streetAddress", "unit", "fullAddress", "streetNorm",
            "rent", "bedBath", "available", "detailUrl", "isSection8", "scrapedAt", "updatedAt",
        ], rema_rows, ["workspaceId", "listableUid"])
        cur.execute('delete from workspace_rema_listings where "workspaceId" = %s and not ("listableUid" = any(%s))',
                    (ws, [r["listable_uid"] for r in rema]))
        pruned = cur.rowcount
        upsert_rows(cur, "workspace_sheet_listings", [
            "id", "workspaceId", "rawName", "streetAddress", "streetNorm", "unitNote", "rentText", "rent",
            "isSection8", "beds", "baths", "scrapedAt",
        ], sheet_rows, ["workspaceId", "rawName"], touch_updated_at=False)
        cur.execute('delete from workspace_sheet_listings where "workspaceId" = %s and not ("rawName" = any(%s))',
                    (ws, [s["raw_name"] for s in sheet]))
        sheet_pruned = cur.rowcount
        cur.close()
    return RunResult(
        records_loaded=len(rema_rows) + len(sheet_rows),
        notes=f"rema={len(rema_rows)} (pruned {pruned}) sheet={len(sheet_rows)} (pruned {sheet_pruned})",
    )
