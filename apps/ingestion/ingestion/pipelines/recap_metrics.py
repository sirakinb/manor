"""Monthly voice recap: deterministic metrics and the revenue model.

Pure over a list of call rows so the numbers are testable offline; the
pipeline module fetches the rows and stores the result. Ported from the old
monthly_recap.py with the per-slug configuration replaced by values read
from workspace_context (see recap.py).
"""

from __future__ import annotations

import calendar
import re
from collections import Counter
from datetime import date, datetime
from typing import Any

BIZ_START_HOUR = 9
BIZ_END_HOUR = 17  # exclusive
MEANINGFUL_MIN_CHARS = 150

# Per-agent revenue assumptions used when the workspace has no
# `recap-revenue-config` context entry.
DEFAULT_REVENUE: dict[str, dict[str, float | bool]] = {
    "tenant": {
        "avg_rent": 1500, "mgmt_fee_pct": 0.08, "placement_fee_pct": 0.75,
        "value_months": 24, "conv_base": 0.20, "conv_low": 0.15, "conv_high": 0.25,
        "conv_measured": False, "prospect_fraction": 0.20,
    },
    "landlord": {
        "avg_rent": 1500, "mgmt_fee_pct": 0.08, "placement_fee_pct": 0.75,
        "value_months": 60, "turnover_months": 24,
        "conv_base": 0.25, "conv_low": 0.15, "conv_high": 0.35, "conv_measured": False,
        "prospect_fraction": 0.30,
    },
}

CATEGORY_RULES: list[tuple[str, str, list[str]]] = [
    ("section8", "Section 8 / voucher questions",
     ["section 8", "section8", "voucher", "housing authority", "hacc", "pha"]),
    ("showing", "Showing / appointment / property access",
     ["showing", "tour", "walk through", "walkthrough", "lockbox",
      "appointment", "see the", "view the", "schedule a"]),
    ("application", "Application / application status",
     ["application", "apply", "applied", "app status"]),
    ("pet", "Pet policy", ["pet ", "pets", " dog", " cat", "animal"]),
    ("availability", "Property availability / rental search",
     ["available", "availability", "vacancy", "looking for", "for rent",
      "rental", "bedroom", "listing", "move in", "move-in", "how much is"]),
    ("tenant_maintenance", "Tenant / maintenance",
     ["maintenance", "repair", "leak", "broken", "furnace", "no heat", "plumbing", "work order"]),
    ("human_support", "Human callback / general support",
     ["speak to someone", "speak to a person", "real person", "representative",
      "call me back", "talk to a", "speak with someone"]),
]

FOLLOWUP_DRIVERS: list[tuple[str, str, list[str]]] = [
    ("human", "Human / live-person requests",
     ["speak to", "real person", "call me back", "representative", "talk to a", "human"]),
    ("section8", "Section 8 / voucher follow-up", ["section 8", "section8", "voucher"]),
    ("sms", "Text / SMS delivery issues",
     ["text", "sms", "link", "message", "didn't receive", "did not receive", "never got"]),
    ("application", "Application / status follow-up", ["application", "apply", "status"]),
    ("showing", "Showing / access follow-up", ["showing", "tour", "access", "lockbox", "appointment"]),
]

CATEGORY_RULES_LANDLORD: list[tuple[str, str, list[str]]] = [
    ("switching_pm", "Switching from another manager",
     ["current manager", "current property manager", "another company", "switch",
      "unhappy with", "leaving my", "fire my", "current management"]),
    ("want_managed", "Wants a property managed",
     ["manage my", "manage the property", "property management", "manage my rental",
      "manage my house", "need a manager", "looking for a property manager",
      "take over management", "full service", "manage my home"]),
    ("want_listed", "Wants a rental listed / leased up",
     ["list my", "rent out", "find a tenant", "place a tenant", "lease up",
      "get it rented", "advertise the", "tenant placement", "fill the unit"]),
    ("fees_pricing", "Fee / pricing questions",
     ["how much do you charge", "what do you charge", "your fee", "fees", "pricing",
      "percentage", "commission", "rates", "cost to manage"]),
    ("selling", "Considering selling",
     ["sell", "selling", "list for sale", "market value", "realtor", "cash offer"]),
    ("existing_owner", "Existing owner / account",
     ["my account", "already a client", "my property with you", "owner portal",
      "my statement", "current owner", "i'm an owner"]),
]

LANDLORD_QUALIFIED_KEYS = {"want_managed", "want_listed", "switching_pm"}
TENANT_QUALIFIED_KEYS = {"availability", "section8", "showing", "application", "pet"}

FOLLOWUP_DRIVERS_LANDLORD: list[tuple[str, str, list[str]]] = [
    ("human", "Wants to speak with the team",
     ["speak to", "call me back", "talk to", "representative", "human", "manager"]),
    ("pricing", "Pricing / proposal follow-up",
     ["fee", "quote", "proposal", "pricing", "cost", "how much", "commission"]),
    ("onboarding", "Onboarding / paperwork",
     ["agreement", "contract", "paperwork", "sign", "onboard", "documents"]),
    ("decision", "Considering / will decide",
     ["think about", "get back", "decide", "call back later", "not sure", "follow up"]),
]

BEDROOM_RE = re.compile(r"(\d+)\s*(?:-|\s)?\s*(?:bed\b|bedroom|br\b|bdr)", re.I)
MONEY_RE = re.compile(r"\$\s?(\d[\d,]{2,4})|(\d{3,4})\s?(?:dollars|/mo|per month|a month)", re.I)
DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _first_match(text: str, rules: list[tuple[str, str, list[str]]]) -> tuple[str, str] | None:
    for key, label, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return key, label
    return None


def _budget_band(amount: int) -> str | None:
    if amount < 400 or amount > 6000:
        return None
    if amount < 1000:
        return "Under $1,000"
    if amount < 1250:
        return "$1,000 – $1,249"
    if amount < 1500:
        return "$1,250 – $1,499"
    if amount < 1750:
        return "$1,500 – $1,749"
    if amount < 2000:
        return "$1,750 – $1,999"
    return "$2,000+"


def compute_metrics(rows: list[dict[str, Any]], year: int, month: int, agent_type: str = "tenant") -> dict[str, Any]:
    """`rows`: dicts with lt (local datetime), ai_resolved, callback_requested, transcript, summary."""
    days_in_month = calendar.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, days_in_month)
    is_landlord = agent_type == "landlord"
    cat_rules = CATEGORY_RULES_LANDLORD if is_landlord else CATEGORY_RULES
    fu_rules = FOLLOWUP_DRIVERS_LANDLORD if is_landlord else FOLLOWUP_DRIVERS
    qualified_keys = LANDLORD_QUALIFIED_KEYS if is_landlord else TENANT_QUALIFIED_KEYS

    total = len(rows)
    ai_handled = sum(1 for r in rows if r.get("ai_resolved"))
    follow_up = sum(1 for r in rows if r.get("callback_requested"))

    per_day_total: Counter[str] = Counter()
    per_day_meaningful: Counter[str] = Counter()
    windows = {
        "weekday_business": {"total": 0, "meaningful": 0, "follow_up": 0},
        "weekday_after_hours": {"total": 0, "meaningful": 0, "follow_up": 0},
        "weekend": {"total": 0, "meaningful": 0, "follow_up": 0},
    }
    categories: Counter[str] = Counter()
    category_labels: dict[str, str] = {}
    bedrooms: Counter[str] = Counter()
    budgets: Counter[str] = Counter()
    drivers: Counter[str] = Counter()
    driver_labels: dict[str, str] = {}
    meaningful_by_hour: Counter[int] = Counter()
    afterhours_by_hour: Counter[int] = Counter()
    meaningful_by_dow: Counter[int] = Counter()
    meaningful = low_info = after_hours_weekend = meaningful_follow_up = 0

    for r in rows:
        lt: datetime = r["lt"]
        dow, hour = lt.weekday(), lt.hour
        is_weekend = dow >= 5
        is_business = (not is_weekend) and BIZ_START_HOUR <= hour < BIZ_END_HOUR
        transcript = r.get("transcript") or ""
        summary = r.get("summary") or ""
        text = (transcript + " " + summary).lower()
        summary_text = summary.lower()
        is_meaningful = len(transcript) >= MEANINGFUL_MIN_CHARS

        day_key = lt.date().isoformat()
        per_day_total[day_key] += 1
        if is_meaningful:
            meaningful += 1
            per_day_meaningful[day_key] += 1
            meaningful_by_hour[hour] += 1
            meaningful_by_dow[dow] += 1
            if r.get("callback_requested"):
                meaningful_follow_up += 1
        else:
            low_info += 1
        if is_weekend or hour < BIZ_START_HOUR or hour >= BIZ_END_HOUR:
            after_hours_weekend += 1
        if not is_business:
            afterhours_by_hour[hour] += 1

        window = "weekend" if is_weekend else ("weekday_business" if is_business else "weekday_after_hours")
        windows[window]["total"] += 1
        if is_meaningful:
            windows[window]["meaningful"] += 1
        if r.get("callback_requested"):
            windows[window]["follow_up"] += 1

        if is_meaningful:
            hit = _first_match(summary_text, cat_rules)
            if hit:
                categories[hit[0]] += 1
                category_labels[hit[0]] = hit[1]
            else:
                categories["other_meaningful"] += 1
                category_labels["other_meaningful"] = "Other meaningful calls"
            seen_bed = set()
            for m in BEDROOM_RE.finditer(text):
                n = int(m.group(1))
                if 1 <= n <= 8:
                    seen_bed.add("5+ bedroom" if n >= 5 else f"{n}-bedroom")
            for label in seen_bed:
                bedrooms[label] += 1
            amounts = []
            for m in MONEY_RE.finditer(text):
                raw = (m.group(1) or m.group(2) or "").replace(",", "")
                if raw.isdigit():
                    amounts.append(int(raw))
            band = None
            for amount in sorted(amounts, reverse=True):
                band = _budget_band(amount)
                if band:
                    break
            if band:
                budgets[band] += 1

        if r.get("callback_requested"):
            hit = _first_match(text, fu_rules)
            if hit:
                drivers[hit[0]] += 1
                driver_labels[hit[0]] = hit[1]
            else:
                drivers["unresolved"] += 1
                driver_labels["unresolved"] = "Specific / unresolved property info"

    categories["low_info"] = low_info
    category_labels["low_info"] = "Low-info / abandoned / missing transcript"

    peak_day, peak_day_n = per_day_total.most_common(1)[0] if per_day_total else (None, 0)
    peak_meaningful_day, peak_meaningful_n = (
        per_day_meaningful.most_common(1)[0] if per_day_meaningful else (None, 0)
    )
    active_days = len(per_day_total) or 1
    avg_per_day = round(total / days_in_month, 1)
    avg_excl_peak = round((total - peak_day_n) / max(1, active_days - 1), 1)
    qualified = sum(categories[k] for k in qualified_keys if k in categories)
    leasing_share = qualified / (meaningful or 1)
    after_meaningful = windows["weekday_after_hours"]["meaningful"] + windows["weekend"]["meaningful"]
    qualified_after_hours = round(after_meaningful * leasing_share)

    def ranked(counter: Counter, labels: dict[str, str], denom: int) -> list[dict[str, Any]]:
        return [
            {"key": key, "label": labels.get(key, key), "count": n, "pct": round(100 * n / denom, 1) if denom else 0}
            for key, n in counter.most_common()
        ]

    return {
        "agent_type": agent_type,
        "period": {
            "year": year, "month": month, "month_name": calendar.month_name[month],
            "start": start.isoformat(), "end": end.isoformat(), "days_in_month": days_in_month,
        },
        "headline": {
            "total_calls": total,
            "meaningful": meaningful,
            "low_info": low_info,
            "ai_handled": ai_handled,
            "follow_up": follow_up,
            "after_hours_weekend": after_hours_weekend,
            "qualified_leasing": qualified,
            "qualified_after_hours": qualified_after_hours,
            "avg_per_day": avg_per_day,
            "avg_per_day_excl_peak": avg_excl_peak,
            "peak_day": peak_day, "peak_day_calls": peak_day_n,
            "peak_meaningful_day": peak_meaningful_day, "peak_meaningful_calls": peak_meaningful_n,
            "independent_rate_pct": round(100 * ai_handled / (total or 1)),
            "meaningful_handled": meaningful - meaningful_follow_up,
            "meaningful_follow_up": meaningful_follow_up,
        },
        "categories": ranked(categories, category_labels, total),
        "coverage_windows": windows,
        "bedroom_demand": ranked(bedrooms, {k: k for k in bedrooms}, meaningful),
        "budget_demand": ranked(budgets, {k: k for k in budgets}, meaningful),
        "follow_up_drivers": ranked(drivers, driver_labels, follow_up),
        "timing": {
            "peak_meaningful_hours": [h for h, _ in meaningful_by_hour.most_common(5)],
            "after_hours_peaks": [h for h, _ in afterhours_by_hour.most_common(3)],
            "strongest_weekday": DOW_NAMES[meaningful_by_dow.most_common(1)[0][0]] if meaningful_by_dow else None,
            "strongest_weekday_meaningful": meaningful_by_dow.most_common(1)[0][1] if meaningful_by_dow else 0,
        },
    }


def revenue_model(config: dict[str, Any] | None, agent_type: str, qualified_after_hours: int, qualified_total: int) -> dict[str, Any]:
    """Opportunity model from the workspace's revenue config (falls back to defaults)."""
    cfg = {**DEFAULT_REVENUE[agent_type], **((config or {}).get(agent_type) or {})}
    rent = float(cfg["avg_rent"])
    fee = float(cfg["mgmt_fee_pct"])
    placement_fee = float(cfg["placement_fee_pct"]) * rent
    months = float(cfg["value_months"])
    mgmt_value = fee * rent * months
    if agent_type == "landlord":
        turnovers = months / float(cfg.get("turnover_months", months) or months)
        placement_value = turnovers * placement_fee
        value_per_conversion = mgmt_value + placement_value
        unit_label, unit_plural, pipeline_label = "managed property", "properties", "qualified owner inquiries"
    else:
        placement_value = placement_fee
        value_per_conversion = placement_value + mgmt_value
        unit_label, unit_plural, pipeline_label = "signed lease", "leases", "qualified leasing inquiries"
    prospect_fraction = float(cfg.get("prospect_fraction", 1.0))
    annualized_after = round(qualified_after_hours * 12 * prospect_fraction)
    annualized_total = round(qualified_total * 12 * prospect_fraction)
    rates = sorted({round(float(cfg["conv_low"]), 4), round(float(cfg["conv_base"]), 4), round(float(cfg["conv_high"]), 4)})

    def table(pipeline: int) -> list[dict[str, Any]]:
        return [
            {"rate_pct": round(rate * 100), "leases": round(pipeline * rate),
             "annual_revenue": round(pipeline * rate * value_per_conversion)}
            for rate in rates
        ]

    return {
        "agent_type": agent_type,
        "avg_rent": round(rent),
        "mgmt_fee_pct": fee,
        "months": round(months),
        "placement_fee": round(placement_fee),
        "placement_value": round(placement_value),
        "mgmt_value": round(mgmt_value),
        "revenue_per_lease": round(value_per_conversion),
        "conversion_base_pct": round(float(cfg["conv_base"]) * 100),
        "conversion_measured": bool(cfg.get("conv_measured", False)),
        "prospect_fraction_pct": round(prospect_fraction * 100),
        "unit_label": unit_label,
        "unit_plural": unit_plural,
        "pipeline_label": pipeline_label,
        "annualized_after_hours_pipeline": annualized_after,
        "annualized_total_pipeline": annualized_total,
        "after_hours_table": table(annualized_after),
        "total_table": table(annualized_total),
    }


def is_last_day_of_month(value: date) -> bool:
    return value.day == calendar.monthrange(value.year, value.month)[1]


def recap_due(today: date, hour_now: int, report_day: int, report_hour: int) -> bool:
    """Day 0 = last day of the month; hour >= configured so a failed tick retries the same day."""
    day_ok = is_last_day_of_month(today) if report_day == 0 else today.day == report_day
    return day_ok and hour_now >= report_hour
