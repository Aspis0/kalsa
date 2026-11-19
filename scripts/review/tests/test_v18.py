"""Failing-first regressions: budget wiring, image exclusion, budget skip."""

import json
import subprocess
import sys

import pytest

from review import batch, pr_step, review, weekly
from review.reader import client
from review.scanners import plain
from test_v16 import git, scan_fixture
from test_v17 import REAL_PNG_BYTES

BUDGET_VERDICT = "not reviewed this week (budget)"


def fork_with_files(tmp_path, files):
    """Two commits; the second adds `files`. Returns (first, second, remote)."""
    work, remote = tmp_path / "work", tmp_path / "remote.git"
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@e")
    git(work, "config", "user.name", "T")
    (work / "a.py").write_text("def a():\n    return 1\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "first")
    first = git(work, "rev-parse", "HEAD")
    for name, data in files.items():
        target = work / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    git(work, "add", ".")
    git(work, "commit", "-m", "second")
    second = git(work, "rev-parse", "HEAD")
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "origin", "main")
    git(remote, "config", "uploadpack.allowAnySHA1InWant", "true")
    return first, second, remote


def scan_files(tmp_path, monkeypatch, files, budget=None):
    first, second, remote = fork_with_files(tmp_path, files)
    reviews = scan_fixture(tmp_path, monkeypatch, first, second, remote)
    review.scan("synthetic", 2000, 200000, first, second, budget=budget)
    return json.loads((reviews / f"synthetic-{second}.json").read_text())


TEXT_FILE = {"src/mod.py": b"def compute_total(values):\n    return sum(values)\n"}


def test_budget_from_env_reads_token_limit(monkeypatch):
    monkeypatch.setenv("REVIEW_TOKEN_BUDGET", "1000")
    assert client.budget_from_env().limit == 1000 * client.CHARS_PER_TOKEN
    monkeypatch.delenv("REVIEW_TOKEN_BUDGET")
    assert client.budget_from_env().limit == 3_000_000 * client.CHARS_PER_TOKEN


def test_weekly_shares_one_budget_and_prints_real_usage(monkeypatch, capsys):
    monkeypatch.setenv("REVIEW_TOKEN_BUDGET", "1000")
    seen = []

    def fake_scan(engine_id, max_files, max_lines, base_override="", head_override="", budget=None):
        seen.append(budget)
        budget.spend(400)

    monkeypatch.setattr(weekly.review, "scan", fake_scan)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "a", "head": "a" * 40}, {"id": "b", "head": "b" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    assert len(seen) == 2 and seen[0] is seen[1]
    assert "tokens used: 200 / 1000" in capsys.readouterr().out


def test_plain_image_is_not_exported_to_readers(tmp_path, monkeypatch):
    data = scan_files(tmp_path, monkeypatch, {**TEXT_FILE, "docs/shot.png": REAL_PNG_BYTES})
    assert not any(row["path"].endswith(".png") for row in data["blocks"])
    assert data["blocks"], "the text file must still be read"
    assert any(
        row["rule"] == "asset-binary" and row["file"] == "docs/shot.png"
        for row in data["signals"]
    )
    assert set(data["decisions"]) == {row["id"] for row in data["blocks"]}
    assert data["verdict"] != BUDGET_VERDICT


def test_polyglot_png_still_needs_a_person(tmp_path, monkeypatch):
    polyglot = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16 + b"x" * 100 + b"\x7fELF"
    assert plain.assess_binary("docs/evil.png", polyglot) == (True, False)
    data = scan_files(tmp_path, monkeypatch, {**TEXT_FILE, "docs/evil.png": polyglot})
    assert any(
        row["rule"] == "binary-or-nul-content" and row.get("needs_person")
        for row in data["findings"]
    )
    assert not any(row["path"] == "docs/evil.png" for row in data["blocks"])


def test_budget_exhaustion_skips_fork_without_digest_flood(tmp_path, monkeypatch):
    data = scan_files(tmp_path, monkeypatch, TEXT_FILE, budget=client.TokenBudget(limit=1))
    assert data["verdict"] == BUDGET_VERDICT
    assert data["stats"]["reason"] == "budget exhausted"
    assert not data.get("decisions")
    assert not any(row.get("needs_person") for row in data["findings"])
    path = tmp_path / "report.json"
    path.write_text(json.dumps(data))
    digest = pr_step.digest([path], tmp_path)
    assert "src/mod.py" not in digest


def test_budget_skipped_report_cannot_apply(tmp_path, monkeypatch):
    from review import apply as review_apply

    data = scan_files(tmp_path, monkeypatch, TEXT_FILE, budget=client.TokenBudget(limit=1))
    sha = data["inputs"]["commit"]
    reviews = tmp_path / "apply-reviews"
    reviews.mkdir()
    (reviews / f"synthetic-{sha}.json").write_text(json.dumps(data))
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "synthetic"\nkind = "fork"\nupstream = "u/up"\nrepo = "o/fork"\n')
    monkeypatch.setattr(review_apply, "REVIEWS", reviews)
    monkeypatch.setattr(review_apply, "current_head", lambda repo, branch="": sha)
    with pytest.raises(ValueError):
        review_apply.apply_review("synthetic", catalog)


def test_fully_read_fork_keeps_its_verdict(tmp_path, monkeypatch):
    data = scan_files(tmp_path, monkeypatch, TEXT_FILE, budget=client.TokenBudget(limit=10_000_000))
    assert data["verdict"] != BUDGET_VERDICT
    assert "reason" not in data["stats"]
    assert data["decisions"]
    assert all("readers" in row for row in data["blocks"])


def test_budget_skipped_fork_is_retried_next_week():
    engines = [{"id": "aaa", "kind": "fork", "repo": "o/aaa", "upstream": "u/aaa"}]
    head = "b" * 40
    reports = {
        ("aaa", "a" * 40): {"verdict": "no findings", "created_at": "2026-01-01", "inputs": {"commit": "a" * 40}},
        ("aaa", head): {"verdict": BUDGET_VERDICT, "created_at": "2026-02-01", "inputs": {"commit": head}},
    }
    picked = batch.pick(engines, reports, {"aaa": head}, {}, 5)
    assert [row["id"] for row in picked] == ["aaa"]
    assert picked[0]["base_sha"] == "a" * 40
