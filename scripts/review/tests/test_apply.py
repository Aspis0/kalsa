import json

import pytest

from review import apply as review_apply

CATALOG = """[[engine]]
id = "one"
kind = "fork"
upstream = "up/repo"

[[engine]]
id = "two"
kind = "fork"
upstream = "up/other"
"""

REPORT = {
    "verdict": "no findings",
    "inputs": {"commit": "a" * 40, "upstream": "up/repo"},
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
    (reviews / ("one-" + "a" * 40 + ".json")).write_text(json.dumps({**REPORT, "verdict": "findings: human review needed"}))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "CATALOG", catalog)
    with pytest.raises(ValueError, match="latest review"):
        review_apply.apply_review("one", catalog)


def test_apply_writes_only_with_a_clean_report(monkeypatch, tmp_path):
    catalog = tmp_path / "engines.toml"
    catalog.write_text(CATALOG)
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    (reviews / ("one-" + "a" * 40 + ".json")).write_text(json.dumps(REPORT))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    patch = review_apply.apply_review("one", catalog)
    assert "[engine.review]" in patch
    assert "[engine.review]" in catalog.read_text()
    with pytest.raises(ValueError, match="already has a review"):
        review_apply.apply_review("one", catalog)
