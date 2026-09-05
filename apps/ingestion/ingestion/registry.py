"""Pipeline name (as stored on workspace_automations.pipeline) → runner."""

from __future__ import annotations

from typing import Callable

from .context import RunContext, RunResult
from .pipelines import buildium, instagram, listings, recap, water, zoho_agent_logs, zoho_campaigns

Runner = Callable[[RunContext], RunResult]

PIPELINES: dict[str, Runner] = {
    "zoho-agent-logs": zoho_agent_logs.run,
    "zoho-campaigns": zoho_campaigns.run,
    "instagram": instagram.run,
    "buildium": buildium.run,
    "listings": listings.run,
    "water": water.run,
    "recap": recap.run,
}
