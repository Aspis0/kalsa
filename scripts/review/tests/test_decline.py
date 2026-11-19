"""The declined-review path writes only a decline record, never a badge."""

import json

import pytest

from review import apply as review_apply


def setup(reviews, catalog, sha, verdict, findings):
    catalog.write_text(
        '[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "up/one"\n\n'
        '[engine.review]\ncommit = "' + sha + '"\ndate = "2026-01-01"\nupstream = "up/repo"\n'
    )
    reviews.mkdir()
    report = {
        "verdict": verdict,
        "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "up/one"},
        "findings": findings,
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    return report


def test_apply_declines_and_removes_existing_review(tmp_path, monkeypatch):
    reviews, catalog = tmp_path / "reviews", tmp_path / "engines.toml"
    sha = "a" * 40
    report = setup(reviews, catalog, sha, "human review needed", [{"file": "a.txt", "line": 1, "rule": "r", "snippet": "x"}])
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog, human_declined="0" * 64, reason="why")
    patch = review_apply.apply_review(
        "one", catalog,
        human_declined=review_apply.findings_digest(report),
        reason="the README asks users to run an install script from another repository",
    )
    text = catalog.read_text()
    assert "[engine.review_declined]" in text and "[engine.review]" not in text
    assert 'commit = "' + sha + '"' in patch
    assert 'reason = "the README asks users to run an install script from another repository"' in text
