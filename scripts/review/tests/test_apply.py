import json

import pytest

from review import apply as review_apply

CATALOG = """[[engine]]
id = "one"
kind = "fork"
upstream = "up/repo"
repo = "up/one"

[[engine]]
id = "two"
kind = "fork"
upstream = "up/other"
repo = "up/two"
"""

REPORT = {
    "verdict": "no findings",
    "inputs": {"commit": "a" * 40, "upstream": "up/repo", "fork": "up/one"},
}


def test_insert_review_targets_the_right_engine():
    result = review_apply.insert_review(CATALOG, "two", "abcdef123456", "up/other", "2026-11-18")
    assert result.count("[engine.review]") == 1
    assert 'id = "two"' in result
    assert result.index("commit = \"abcdef123456\"") > result.index('id = "two"')
    assert result.index("commit = \"abcdef123456\"") > result.index('upstream = "up/other"')


def test_apply_refuses_a_finding(monkeypatch, tmp_path):
    catalog = tmp_path / "engines.toml"
    catalog.write_text(CATALOG)
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    bad = {**REPORT, "verdict": "findings: human review needed"}
    bad["findings_digest"] = review_apply.findings_digest(bad)
    (reviews / ("one-" + "a" * 40 + ".json")).write_text(json.dumps(bad))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "CATALOG", catalog)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": "a" * 40)
    with pytest.raises(ValueError, match="current review"):
        review_apply.apply_review("one", catalog)


def test_apply_writes_only_with_a_clean_report(monkeypatch, tmp_path):
    catalog = tmp_path / "engines.toml"
    catalog.write_text(CATALOG)
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    good = dict(REPORT)
    good["findings_digest"] = review_apply.findings_digest(good)
    (reviews / ("one-" + "a" * 40 + ".json")).write_text(json.dumps(good))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": "a" * 40)
    patch = review_apply.apply_review("one", catalog)
    assert "[engine.review]" in patch
    assert "[engine.review]" in catalog.read_text()
    with pytest.raises(ValueError, match="already has a review"):
        review_apply.apply_review("one", catalog)
