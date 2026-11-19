"""Failing-first regressions from audit v10."""

import hashlib

import pytest
import json
from pathlib import Path

from review import apply as review_apply, diff, review
from review.scanners import plain
from image_fixtures import png


def test_binary_file_exports_removed_blocks(tmp_path):
    data = b'/* \x00 */\nverify_signature(blob);\n'
    (tmp_path / "src").mkdir()
    path = tmp_path / "src/x.c"
    path.write_bytes(data)
    patch = "@@ -1,2 +1,2 @@\n /* \\x00 */\n-verify_signature(blob);\n+int y;\n"
    findings, signals, removed = plain.scan([path], [("src/x.c", patch)], tmp_path, "owner/fork", "up/repo")
    assert removed
    assert removed[0]["text"] == "verify_signature(blob);"
    assert any(row["rule"] == "removed-security-line" for row in signals)


def test_digest_covers_every_block_field():
    base = {
        "verdict": "no findings", "inputs": {"commit": "a" * 40},
        "findings": [], "signals": [], "stats": {},
        "blocks": [{
            "id": "x", "path": "src/a.py", "start": 1, "end": 2, "kind": "text",
            "ships": True, "truncated": False, "text": "abc", "context": [{"line": 1, "text": "a"}],
            "old_sha": "", "new_sha": "s", "old_size": 0, "new_size": 3,
        }],
        "removed_blocks": [],
    }
    digest = review_apply.findings_digest(base)
    for field, value in [
        ("path", "src/b.py"), ("start", 9), ("end", 9), ("kind", "binary"),
        ("ships", False), ("truncated", True), ("context", []),
        ("old_sha", "o"), ("new_sha", "n"), ("old_size", 1), ("new_size", 4),
    ]:
        changed = json.loads(json.dumps(base))
        changed["blocks"][0][field] = value
        assert review_apply.findings_digest(changed) != digest, field


def test_long_removed_line_does_not_gate_the_badge(tmp_path, monkeypatch):
    import shutil
    import subprocess

    from review import catalog, github, localdiff

    work = tmp_path / "work"; bare = tmp_path / "repo.git"
    work.mkdir()
    git = lambda *a: subprocess.run(["git", "-C", str(work), *a], check=True, capture_output=True)
    git("init", "-b", "main"); git("config", "user.email", "t@e"); git("config", "user.name", "T")
    (work / "a.py").write_text("verify_signature(" + "x" * 40_010 + ");\n")
    git("add", "."); git("commit", "-m", "base")
    base = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    git("checkout", "-b", "fork")
    (work / "a.py").write_text("pass\n")
    git("add", "."); git("commit", "-m", "fork")
    fork = subprocess.check_output(["git", "-C", str(work), "rev-parse", "HEAD"]).decode().strip()
    subprocess.run(["git", "clone", "--bare", str(work), str(bare)], check=True, capture_output=True)
    engine = {"id": "synthetic", "repo": "owner/fork", "upstream": "owner/up", "kind": "fork"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "t")
    monkeypatch.setattr(github, "fork_head", lambda repo, token: (fork, "fork") if repo == "owner/fork" else (base, "main"))
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    monkeypatch.setattr(localdiff, "init", lambda target: shutil.copytree(bare, target, dirs_exist_ok=True))
    monkeypatch.setattr(localdiff, "find_base", lambda *args: base)
    reviews = tmp_path / "reviews"; reviews.mkdir()
    monkeypatch.setattr(review, "REVIEWS", reviews)
    monkeypatch.setattr(review.fetch, "fetch_all", lambda *args: None)
    review.scan("synthetic", 2000, 200000)
    data = json.loads((reviews / f"synthetic-{fork}.json").read_text())
    assert data["verdict"] != "too large to review"
    assert "reason" not in data["stats"]
    assert any("verify_signature(" in row["text"] for row in data["removed_blocks"])


def test_escape_is_injective_for_binary_blocks():
    literal = b"x = \\x00\n"
    real = b"x = \x00\n"
    def info(data):
        return {
            "blocks": {"x.py": [[1]]}, "blobs": {"x.py": data}, "paths": ["x.py"],
            "statuses": {"x.py": "A"},
            "binary_info": {"x.py": {"old_size": 0, "new_size": len(data), "old_sha": "", "new_sha": "s"}},
        }
    literal_text = review.export_blocks(info(literal))[0]["text"]
    real_text = review.export_blocks(info(real))[0]["text"]
    assert literal_text != real_text
    assert "\\x00" in literal_text and "\\x00" in real_text


PNG_MAGIC = png()


def test_plain_png_is_a_signal_only(tmp_path):
    path = tmp_path / "shot.png"
    path.write_bytes(PNG_MAGIC)
    patch = "@@ -0,0 +1,1 @@\n+" + diff.decode(PNG_MAGIC[:8]) + "\n"
    findings, signals, _ = plain.scan([path], [("shot.png", patch)], tmp_path, "owner/fork", "up/repo")
    assert not any(row.get("needs_person") for row in findings)
    assert any(row.get("suppressed_because") == "plain-image" for row in signals)


def test_fake_png_with_elf_magic_needs_person(tmp_path):
    path = tmp_path / "fake.png"
    path.write_bytes(b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 20)
    patch = "@@ -0,0 +1,1 @@\n+\\x7fELF\n"
    findings, _, _ = plain.scan([path], [("fake.png", patch)], tmp_path, "owner/fork", "up/repo")
    assert any(row.get("needs_person") for row in findings)


def test_verdict_reads_needs_person():
    findings = [{"tool": "plain", "file": "x", "line": 0, "rule": "binary-or-nul-content", "snippet": "x", "needs_person": True}]
    assert review.verdict_for(findings, []) == "human review needed"


def _needs_person_report(tmp_path, monkeypatch):
    path = tmp_path / "engines.toml"
    path.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "owner/fork"\n')
    reviews = tmp_path / "reviews"; reviews.mkdir()
    sha = "a" * 40
    report = {
        "verdict": "human review needed", "created_at": "2026-01-01T00:00:00Z",
        "inputs": {"commit": sha, "upstream": "up/repo", "fork": "owner/fork"},
        "findings": [{
            "file": "x", "line": 0, "rule": "binary-or-nul-content",
            "snippet": "x", "needs_person": True,
        }],
    }
    report["findings_digest"] = review_apply.findings_digest(report)
    (reviews / f"one-{sha}.json").write_text(json.dumps(report))
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    return path, report


def test_needs_person_blocks_only_plain_apply(tmp_path, monkeypatch):
    path, _ = _needs_person_report(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        review_apply.apply_review("one", path)


def test_human_approval_resolves_needs_person(tmp_path, monkeypatch):
    path, report = _needs_person_report(tmp_path, monkeypatch)
    patch = review_apply.apply_review("one", path, human_approved=report["findings_digest"])
    assert 'approval = "approved after human review"' in patch


def test_human_decline_resolves_needs_person(tmp_path, monkeypatch):
    path, report = _needs_person_report(tmp_path, monkeypatch)
    patch = review_apply.apply_review(
        "one", path, human_declined=report["findings_digest"], reason="manual decision",
    )
    assert "[engine.review_declined]" in patch


