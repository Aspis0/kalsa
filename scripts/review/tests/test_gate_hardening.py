"""Failing-first regressions for the hostile-audit findings."""

import json
from pathlib import Path

import pytest

from review import apply as review_apply
from review import diff, review
from review.scanners import common, semgrep, osv as osv_scan, plain as plain_scan

SEMGREP_JSON = {
    "results": [
        {
            "check_id": "/Users/marco/Projects/kalsa/scripts/review/rules.yml.kalsa.eval-python",
            "path": "src/main.py",
            "start": {"line": 1},
            "extra": {"lines": "requires login"},
        },
        {
            "check_id": "p/secrets.generic.secrets",
            "path": "src/main.py",
            "start": {"line": 1},
            "extra": {"lines": "requires login"},
        },
        {
            "check_id": "/Users/marco/Projects/kalsa/scripts/review/rules.yml.kalsa.eval-python",
            "path": "tests/test-backend-ops.cpp",
            "start": {"line": 1},
            "extra": {"lines": "requires login"},
        },
    ],
}


def test_incomplete_diff_cannot_be_reviewed():
    comparison = {"files": [{"filename": "src/a.py", "status": "modified"}, {"filename": "src/b.py", "status": "modified", "patch": "@@ -1 +1 @@\n-x\n+y\n"}]}
    assert review.incomplete_diff(comparison, 300)["reason"] == "files-without-patch"
    capped = {"files": [{"filename": f"f{i}", "status": "modified", "patch": "@@ -0,0 +1 @@\n+y\n"} for i in range(300)]}
    assert review.incomplete_diff(capped, 300)["reason"] == "diff-cap"


def test_added_lines_handles_double_plus():
    assert diff.added_lines("@@ -0,0 +1 @@\n+++x\n") == {1}


def test_semgrep_gate_uses_recorded_json_and_source_snippet(tmp_path, monkeypatch):
    source = tmp_path / "src/main.py"
    source.parent.mkdir()
    source.write_text("exec(requests.get(u).text)\n")
    test = tmp_path / "tests/test-backend-ops.cpp"
    test.parent.mkdir()
    test.write_text("test->eval(b);\n")
    files = [source, test]
    added = {"src/main.py": {1}, "tests/test-backend-ops.cpp": {1}}
    monkeypatch.setattr(semgrep, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(SEMGREP_JSON), ""))
    findings, signals = semgrep.scan(files, tmp_path, added)
    assert len(findings) == 2
    assert any(row["rule"] == "kalsa.eval-python" for row in findings)
    assert any(row["rule"] == "p/secrets.generic.secrets" for row in findings)
    assert all(row["snippet"] for row in findings)
    assert all("requires login" not in row["snippet"] for row in findings)
    suppressed = [row for row in signals if row.get("suppressed_because")]
    assert suppressed and suppressed[0]["rule"] == "kalsa.eval-python"


def test_osv_exit_policy(tmp_path, monkeypatch):
    manifest = tmp_path / "requirements.txt"
    manifest.write_text("django==1.0\n")
    payload = (Path(__file__).parent / "fixtures/osv-django-1.0.json").read_text()
    monkeypatch.setattr(osv_scan, "run_tool", lambda *a, **k: common.ToolResult(1, payload, ""))
    findings = osv_scan.scan([manifest], tmp_path)
    assert findings and findings[0]["rule"] == "GHSA-3f7w-6pp4-r9m4"
    monkeypatch.setattr(osv_scan, "run_tool", lambda *a, **k: common.ToolResult(2, "", "boom"))
    findings = osv_scan.scan([manifest], tmp_path)
    assert findings and findings[0]["rule"] == "scanner-error"


def test_url_owner_is_checked_not_just_host():
    data = {"url": "https://raw.githubusercontent.com/attacker/repo/main/x.sh", "file": "src/main.py", "line": 1, "comment": False}
    assert not plain_scan.classify_url(data, set(), "owner/fork", "upstream/repo")["signal"]
    data["url"] = "https://huggingface.co/attacker/model"
    assert not plain_scan.classify_url(data, set(), "owner/fork", "upstream/repo")["signal"]


def test_url_from_pieces_is_a_finding():
    data = {"url": 'https://" + host', "file": "src/main.py", "line": 1, "comment": False}
    result = plain_scan.classify_url(data, set(), "owner/fork", "upstream/repo")
    assert not result["signal"] and result["row"]["rule"] == "constructed-url"


def test_comment_url_in_shipped_code_is_a_finding():
    data = {"url": "https://evil.example/x.sh", "file": "src/main.py", "line": 1, "comment": True}
    result = plain_scan.classify_url(data, set(), "owner/fork", "upstream/repo")
    assert result["signal"] and result["row"]["suppressed_because"] == "comment-url"


def test_apply_requires_full_sha_and_pin(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\ncommit = "' + "a" * 40 + '"\n')
    reports = tmp_path / "reviews"
    reports.mkdir()
    (reports / ("one-" + "a" * 40 + ".json")).write_text(json.dumps({
        "verdict": "no findings",
        "inputs": {"commit": "a" * 40, "upstream": "up/repo"},
    }))
    monkeypatch.setattr(review_apply, "REVIEWS", reports)
    patch = review_apply.apply_review("one", catalog)
    assert "[engine.review]" in patch
    (reports / ("one-" + "b" * 7 + ".json")).write_text(json.dumps({
        "verdict": "no findings",
        "inputs": {"commit": "b" * 40, "upstream": "up/repo"},
    }))
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog)


