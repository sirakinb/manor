"""What Manor hands a pipeline for one run."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RunContext:
    run_id: str
    workspace_id: str
    credentials: dict[str, dict[str, str]] = field(default_factory=dict)
    options: dict[str, Any] = field(default_factory=dict)

    def credential(self, provider: str) -> dict[str, str]:
        fields = self.credentials.get(provider)
        if not fields:
            raise ValueError(f"missing {provider} credential")
        return fields

    @property
    def manual(self) -> bool:
        return bool(self.options.get("manual"))

    @property
    def timezone(self) -> str:
        return str(self.options.get("timezone") or "America/New_York")

    @property
    def workspace(self) -> dict[str, Any]:
        value = self.options.get("workspace")
        return value if isinstance(value, dict) else {}


@dataclass
class RunResult:
    records_loaded: int = 0
    notes: str = ""

    def as_json(self) -> dict[str, Any]:
        return {"ok": True, "recordsLoaded": int(self.records_loaded), "notes": self.notes}
