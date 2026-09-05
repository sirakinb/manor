"""Provider boundary for draft recap prose. No provider is required by the warehouse."""

import json
from typing import Any

import requests

from ..errors import PipelineError


def generate_json(provider: str, credential: dict[str, str], system: str, user: str) -> dict[str, Any]:
    api_key = credential.get("apiKey")
    if not api_key:
        raise PipelineError(f"{provider} credential needs apiKey")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider == "openai":
        response = requests.post(
            "https://api.openai.com/v1/responses", headers=headers,
            json={
                "model": credential.get("model") or "gpt-5.6-luna",
                "instructions": system, "input": user,
                "text": {"format": {"type": "json_object"}},
                "reasoning": {"effort": "low"},
                "max_output_tokens": 8000, "store": False,
            }, timeout=120,
        )
    elif provider == "openrouter":
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions", headers=headers,
            json={
                "model": credential.get("model") or "deepseek/deepseek-v4-pro",
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"}, "max_tokens": 8000, "temperature": 0.3,
            }, timeout=120,
        )
    else:
        raise PipelineError("Unsupported recap narrative provider")
    if response.status_code != 200:
        raise PipelineError(f"{provider} responded {response.status_code} while writing the narrative")
    body = response.json()
    if provider == "openai":
        if body.get("status") != "completed":
            raise PipelineError("OpenAI narrative was incomplete")
        content = "".join(
            part.get("text", "") for item in body.get("output", []) if item.get("type") == "message"
            for part in item.get("content", []) if part.get("type") == "output_text"
        )
    else:
        choice = body["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise PipelineError("OpenRouter narrative was incomplete")
        content = choice["message"].get("content") or ""
    try:
        parsed = json.loads(content)
    except (TypeError, ValueError):
        raise PipelineError("Narrative provider returned invalid JSON") from None
    if not isinstance(parsed, dict):
        raise PipelineError("Narrative provider returned an invalid object")
    return parsed


def generate(provider: str, credential: dict[str, str], system: str, user: str) -> dict[str, Any]:
    parsed = generate_json(provider, credential, system, user)
    text_fields = ("executive_assessment", "what_this_means", "bottom_line", "summary")
    list_fields = ("wins", "opportunities")
    if not isinstance(parsed, dict) or any(not isinstance(parsed.get(k), str) for k in text_fields):
        raise PipelineError("Narrative provider returned an invalid recap")
    if any(not isinstance(parsed.get(k), list) or any(not isinstance(v, str) for v in parsed[k]) for k in list_fields):
        raise PipelineError("Narrative provider returned invalid recap items")
    actions = parsed.get("action_items")
    if not isinstance(actions, list) or any(not isinstance(a, dict) or any(not isinstance(a.get(k), str) for k in ("title", "detail")) for a in actions):
        raise PipelineError("Narrative provider returned invalid actions")
    return {k: parsed[k] for k in (*text_fields, *list_fields, "action_items")}
