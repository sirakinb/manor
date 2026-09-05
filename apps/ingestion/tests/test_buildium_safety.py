import pytest

from ingestion.context import RunContext
from ingestion.errors import PipelineError
from ingestion.pipelines import buildium


def test_malformed_page_is_not_treated_as_an_empty_snapshot(monkeypatch):
    monkeypatch.setattr(buildium, "get_json", lambda *a, **k: {"error": "bad response"})
    with pytest.raises(PipelineError, match="invalid page"):
        buildium.paginate({"clientId": "fake", "clientSecret": "fake"}, "rentals/units/listings")


def test_pagination_cap_does_not_commit_a_partial_snapshot(monkeypatch):
    monkeypatch.setattr(buildium, "PAGE", 1)
    monkeypatch.setattr(buildium, "CAP", 1)
    monkeypatch.setattr(buildium.time, "sleep", lambda _: None)
    monkeypatch.setattr(buildium, "get_json", lambda *a, **k: [{"Id": 1}])
    with pytest.raises(PipelineError, match="pagination limit"):
        buildium.paginate({"clientId": "fake", "clientSecret": "fake"}, "rentals/units/listings")


def test_missing_listing_unit_id_aborts_before_database_writes(monkeypatch):
    monkeypatch.setattr(buildium, "paginate", lambda credential, path: [{}] if path.endswith("listings") else [])
    monkeypatch.setattr(buildium, "connection", lambda: pytest.fail("must not write an incomplete snapshot"))
    with pytest.raises(PipelineError, match="unit id"):
        buildium.run(RunContext("run", "workspace", {"buildium": {"clientId": "fake", "clientSecret": "fake"}}))
