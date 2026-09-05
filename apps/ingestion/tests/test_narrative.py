import json
from types import SimpleNamespace

import pytest

from ingestion.adapters import narrative
from ingestion.errors import PipelineError

PROSE = {"executive_assessment": "Example", "what_this_means": "Example", "bottom_line": "Example", "summary": "Example", "wins": [], "opportunities": [], "action_items": []}


@pytest.mark.parametrize("provider", ["openai", "openrouter"])
def test_narrative_providers_share_the_draft_contract(monkeypatch, provider):
    seen = {}
    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        body = {"status": "completed", "output": [{"type": "reasoning"}, {"type": "message", "content": [{"type": "output_text", "text": json.dumps(PROSE)}]}]} if provider == "openai" else {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(PROSE)}}]}
        return SimpleNamespace(status_code=200, json=lambda: body)
    monkeypatch.setattr(narrative.requests, "post", post)
    assert narrative.generate(provider, {"apiKey": "fake", "model": "requested-model"}, "system", "user") == PROSE
    assert seen["json"]["model"] == "requested-model"
    assert seen["headers"]["Authorization"] == "Bearer fake"
    if provider == "openai":
        assert seen["url"] == "https://api.openai.com/v1/responses"
        assert seen["json"]["store"] is False
        assert seen["json"]["text"]["format"] == {"type": "json_object"}
        assert "temperature" not in seen["json"]


@pytest.mark.parametrize("body", [
    {"status": "incomplete", "output": []},
    {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}]},
    {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "{}"}]}]},
])
def test_incomplete_or_invalid_openai_output_cannot_become_a_report(monkeypatch, body):
    monkeypatch.setattr(narrative.requests, "post", lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: body))
    with pytest.raises(PipelineError):
        narrative.generate("openai", {"apiKey": "fake"}, "system", "user")


def test_provider_failure_does_not_expose_response_or_fall_back(monkeypatch):
    calls = []
    def post(*a, **k):
        calls.append(a)
        return SimpleNamespace(status_code=401, text="sensitive-provider-response")
    monkeypatch.setattr(narrative.requests, "post", post)
    with pytest.raises(PipelineError, match="openai responded 401") as failure:
        narrative.generate("openai", {"apiKey": "fake"}, "system", "user")
    assert "sensitive" not in str(failure.value)
    assert len(calls) == 1
