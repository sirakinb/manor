from datetime import date, datetime

from ingestion.pipelines.recap import CONTEXT_REVENUE, narrative_prompt, revenue_config, sample_summaries
from ingestion.pipelines.recap_metrics import compute_metrics, recap_due, revenue_model

LONG = "x" * 200


def call(day: int, hour: int, *, ai=True, cb=False, transcript=LONG, summary=""):
    return {
        "lt": datetime(2026, 8, day, hour, 15),
        "ai_resolved": ai,
        "callback_requested": cb,
        "transcript": transcript,
        "summary": summary,
    }


def test_metrics_windows_categories_and_qualified_pipeline():
    rows = [
        call(3, 10, summary="Caller asked about Section 8 vouchers for a 3 bedroom at $1,400"),  # Mon business, section8
        call(3, 19, cb=True, summary="Wants to schedule a showing tomorrow"),  # Mon after hours, showing
        call(8, 11, ai=False, transcript="hi", summary="hung up"),  # Sat weekend, low info
        call(8, 12, summary="Furnace repair needed, no heat"),  # Sat weekend, maintenance
        call(5, 9, cb=True, transcript="short", summary="speak to a person please"),  # Wed business, low info callback
    ]
    m = compute_metrics(rows, 2026, 8, "tenant")
    h = m["headline"]
    assert h["total_calls"] == 5 and h["meaningful"] == 3 and h["low_info"] == 2
    assert h["ai_handled"] == 4 and h["follow_up"] == 2
    assert h["after_hours_weekend"] == 3
    assert h["qualified_leasing"] == 2  # section8 + showing
    assert h["qualified_after_hours"] == round(2 * (2 / 3))  # after-hours meaningful × leasing share
    assert h["peak_day"] == "2026-08-03" and h["peak_day_calls"] == 2
    assert h["avg_per_day"] == round(5 / 31, 1)
    assert h["independent_rate_pct"] == 80
    assert h["meaningful_follow_up"] == 1 and h["meaningful_handled"] == 2
    assert m["coverage_windows"] == {
        "weekday_business": {"total": 2, "meaningful": 1, "follow_up": 1},
        "weekday_after_hours": {"total": 1, "meaningful": 1, "follow_up": 1},
        "weekend": {"total": 2, "meaningful": 1, "follow_up": 0},
    }
    by_key = {c["key"]: c for c in m["categories"]}
    assert by_key["section8"]["count"] == 1 and by_key["showing"]["count"] == 1
    assert by_key["tenant_maintenance"]["count"] == 1 and by_key["low_info"]["count"] == 2
    assert by_key["low_info"]["pct"] == 40.0
    assert m["bedroom_demand"] == [{"key": "3-bedroom", "label": "3-bedroom", "count": 1, "pct": round(100 / 3, 1)}]
    assert m["budget_demand"][0]["key"] == "$1,250 – $1,499"
    drivers = {d["key"]: d["count"] for d in m["follow_up_drivers"]}
    assert drivers == {"showing": 1, "human": 1}
    assert m["timing"]["strongest_weekday"] == "Monday"
    assert m["period"] == {"year": 2026, "month": 8, "month_name": "August", "start": "2026-08-01", "end": "2026-08-31", "days_in_month": 31}


def test_landlord_rules_and_empty_month():
    rows = [call(4, 10, summary="I want you to manage my rental"), call(4, 11, summary="How much do you charge? your fee")]
    m = compute_metrics(rows, 2026, 8, "landlord")
    assert {c["key"] for c in m["categories"]} == {"want_managed", "fees_pricing", "low_info"}
    assert m["headline"]["qualified_leasing"] == 1
    empty = compute_metrics([], 2026, 2, "tenant")
    assert empty["headline"]["total_calls"] == 0 and empty["headline"]["peak_day"] is None
    assert empty["timing"]["strongest_weekday"] is None


def test_revenue_model_uses_workspace_config_over_defaults():
    config = {"tenant": {"avg_rent": 1600, "mgmt_fee_pct": 0.05, "placement_fee_pct": 0.75, "value_months": 30,
                         "conv_base": 0.23, "conv_low": 0.20, "conv_high": 0.25, "conv_measured": True, "prospect_fraction": 0.20}}
    rev = revenue_model(config, "tenant", qualified_after_hours=10, qualified_total=40)
    assert rev["placement_fee"] == 1200 and rev["mgmt_value"] == 2400 and rev["revenue_per_lease"] == 3600
    assert rev["conversion_measured"] is True and rev["conversion_base_pct"] == 23
    assert rev["annualized_after_hours_pipeline"] == 24 and rev["annualized_total_pipeline"] == 96
    assert [r["rate_pct"] for r in rev["after_hours_table"]] == [20, 23, 25]
    assert rev["after_hours_table"][1] == {"rate_pct": 23, "leases": round(24 * 0.23), "annual_revenue": round(24 * 0.23 * 3600)}

    default = revenue_model(None, "landlord", 5, 10)
    assert default["unit_label"] == "managed property" and default["conversion_measured"] is False
    assert default["placement_value"] == round((60 / 24) * 0.75 * 1500)


def test_recap_due_and_context_parsing():
    assert recap_due(date(2026, 8, 31), 9, 0, 9)
    assert recap_due(date(2026, 8, 31), 13, 0, 9)  # later ticks retry the same day
    assert not recap_due(date(2026, 8, 30), 9, 0, 9)
    assert not recap_due(date(2026, 8, 31), 8, 0, 9)
    assert recap_due(date(2026, 8, 15), 9, 15, 9)
    assert revenue_config({}) is None
    assert revenue_config({CONTEXT_REVENUE: '{"tenant": {"avg_rent": 1700}}'}) == {"tenant": {"avg_rent": 1700}}


def test_narrative_prompt_and_samples_are_grounded():
    rows = [call(1, 10, summary=f"summary number {i} that is long enough to count as substantive") for i in range(130)]
    samples = sample_summaries(rows, limit=60)
    assert len(samples) == 60 and samples[0].startswith("summary number 0")
    m = compute_metrics(rows, 2026, 8, "tenant")
    system, user = narrative_prompt("Example Rentals", "Alex", "Echo", m, revenue_model(None, "tenant", 1, 2), samples, "tenant")
    assert "named 'Echo'" in system and "live human phone coverage is NOT available" in system
    assert "Owner first name (address the recap to this person): Alex" in user
    assert "August 2026" in user and '"total_calls": 130' in user
    assert "Example Rentals" not in system  # the prompt never hardcodes a client
