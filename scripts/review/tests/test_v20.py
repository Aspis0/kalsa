"""Failing-first regressions for audit v17."""

import json
import subprocess
import sys
from pathlib import Path

from review import corpus_run, pr_step, review, weekly
from review.reader import client
from review.scanners import plain
from review.verdict import BUDGET_VERDICT
from image_fixtures import jpeg, png
import reader_responses
from test_v16 import git

WORKFLOW = Path(__file__).resolve().parents[3] / ".github/workflows/review.yml"
PNG_HEAD = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def test_no_fake_reader_env_switch_in_production():
    for module in (weekly, corpus_run):
        assert "REVIEW_FAKE" not in Path(module.__file__).read_text(), module.__name__


def test_weekly_ignores_review_fake(monkeypatch, tmp_path):
    monkeypatch.setenv("REVIEW_FAKE", "1")
    before = client._http
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    (reviews / f"a-{'a' * 40}.json").write_text(json.dumps({"verdict": "no findings", "blocks": []}))
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "a", "head": "a" * 40}])
    monkeypatch.setattr(weekly.review, "scan", lambda *a, **k: None)
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    assert client._http is before


def test_png_with_elf_in_the_middle_needs_person():
    data = PNG_HEAD + b"\x00" * 100_000 + b"\x7fELF" + b"\x00" * 100_000 + IEND
    assert len(data) > 200_000
    assert data.endswith(IEND)
    window = data[:65_536] + data[-65_536:]
    assert b"\x7fELF" not in window, "fixture must defeat the old 64 KB window"
    assert plain.assess_binary("docs/big.png", data) == (True, False)


def test_png_with_bytes_after_iend_needs_person():
    clean = png()
    assert plain.assess_binary("docs/a.png", clean) == (False, True)
    assert plain.assess_binary("docs/a.png", clean + b"appended") == (True, False)


def test_jpeg_and_gif_always_need_person():
    gif = b"GIF89a" + b"\x00" * 32 + b"\x3b"
    assert plain.assess_binary("a.jpg", jpeg()) == (True, False)
    assert plain.assess_binary("a.jpg", jpeg() + b"x") == (True, False)
    assert plain.assess_binary("a.gif", gif) == (True, False)
    assert plain.assess_binary("a.gif", gif + b"x") == (True, False)


def test_workflow_has_concurrency_group():
    from ruamel.yaml import YAML

    document = YAML(typ="safe").load(WORKFLOW.read_text())
    assert document["concurrency"] == {"group": "review", "cancel-in-progress": False}


def test_budget_verdict_on_empty_scan_is_writable(tmp_path, monkeypatch):
    reviews = tmp_path / "reviews"
    monkeypatch.setattr(review, "REVIEWS", reviews)
    report = {"engine": "one", "inputs": {"commit": "b" * 40, "base_sha": "a" * 40}}
    review.write_gated(
        "one", "b" * 40, report, "budget exhausted", {"files": 0, "lines": 0}, "*", [], BUDGET_VERDICT,
    )
    data = json.loads((reviews / f"one-{'b' * 40}.json").read_text())
    assert data["verdict"] == BUDGET_VERDICT


def reader_config():
    return client.Config("https://example.invalid/v1", "m", "k", effort="high", session="s")


def harmless_http(_config, request, _effort):
    body = request["messages"][0]["content"]
    start = body.index('"blocks": ') + len('"blocks": ')
    blocks = json.JSONDecoder().raw_decode(body[start:])[0]
    rows = [
        {"id": b["id"], "verdict": "harmless", "reason": "ok", "quoted_line": b["text"].split("\n")[0]}
        for b in blocks
    ]
    return reader_responses.results(rows)


def test_budget_counts_the_whole_request():
    blocks = [{"id": "a", "text": "return 1234"}]
    seen = []

    def http(config, request, effort):
        seen.append(len(request["messages"][0]["content"]))
        return harmless_http(config, request, effort)

    budget = client.TokenBudget(limit=10_000_000)
    client.read(reader_config(), blocks, [], [], http=http, budget=budget)
    assert seen
    assert budget.used == sum(seen)
    assert budget.used > sum(len(block["text"]) for block in blocks)


def test_budget_exhausts_on_request_overhead():
    blocks = [{"id": "a", "text": "return 1234"}]
    budget = client.TokenBudget(limit=50)
    result = client.read(reader_config(), blocks, [], [], http=harmless_http, budget=budget)
    assert [row["id"] for row in result] == ["a"]
    assert all(row["reason"] == "budget reached" for row in result)


def test_pr_step_rerun_commits_only_reports_and_digest(tmp_path, monkeypatch):
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@e")
    git(work, "config", "user.name", "T")
    (work / "reviews").mkdir()
    report = work / "reviews" / "a.json"
    report.write_text(json.dumps({"verdict": "seed", "blocks": []}))
    (work / "unrelated.txt").write_text("original\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "seed")
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "-u", "origin", "main")
    monkeypatch.chdir(work)
    monkeypatch.setattr(sys, "argv", ["pr_step"])
    real_run = subprocess.run

    def fake_run(args, **kwargs):
        if args[0] != "gh":
            return real_run(args, **kwargs)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(pr_step.subprocess, "run", fake_run)
    report.write_text(json.dumps({"verdict": "run-one", "blocks": []}))
    pr_step.main()
    # main advances with an unrelated change after the weekly branch was cut
    git(work, "checkout", "main")
    (work / "unrelated.txt").write_text("advanced on main\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "unrelated main work")
    git(work, "push", "origin", "main")
    report.write_text(json.dumps({"verdict": "run-two", "blocks": []}))
    pr_step.main()

    branch = f"review/weekly-{pr_step.week()}"
    tip = git(remote, "rev-parse", branch)
    changed = git(remote, "diff", "--name-only", f"{tip}^", tip).split()
    assert changed and all(path.startswith("reviews/") for path in changed), changed
    assert git(remote, "show", f"{tip}:unrelated.txt") == "original"
    assert json.loads(git(remote, "show", f"{tip}:reviews/a.json"))["verdict"] == "run-two"
    assert json.loads(git(remote, "show", f"{tip}^:reviews/a.json"))["verdict"] == "run-one"
