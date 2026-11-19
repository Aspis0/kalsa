"""Failing-first regressions for audit v16."""

import json
import subprocess
import sys

import pytest

from review import localdiff, pr_step, review


def git(cwd, *args):
    result = subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def fork_fixture(tmp_path):
    """A real fork remote with two commits: (first, second, remote)."""
    work, remote = tmp_path / "work", tmp_path / "remote.git"
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@e")
    git(work, "config", "user.name", "T")
    (work / "a.py").write_text("def a():\n    return 1\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "first")
    first = git(work, "rev-parse", "HEAD")
    (work / "a.py").write_text("def a():\n    return 1\n\n\ndef b():\n    return 2222\n")
    git(work, "add", ".")
    git(work, "commit", "-m", "second")
    second = git(work, "rev-parse", "HEAD")
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "origin", "main")
    git(remote, "config", "uploadpack.allowAnySHA1InWant", "true")
    return first, second, remote


def scan_fixture(tmp_path, monkeypatch, first, second, remote):
    """Wire the catalog to the fixture; git fetches for real from the local remote."""
    from review import catalog, github

    engine = {"id": "synthetic", "kind": "fork", "repo": "o/fork", "upstream": "u/up"}
    monkeypatch.setattr(catalog, "load", lambda: {"engine": [engine]})
    monkeypatch.setattr(github, "token", lambda: "t")
    monkeypatch.setattr(
        github, "fork_head",
        lambda repo, token: (second, "fork") if repo == "o/fork" else (first, "main"),
    )
    monkeypatch.setattr(github, "default_branch", lambda repo, token: "main")
    real_env = localdiff.git_env

    def env(home):
        value = real_env(home)
        value.update({
            "GIT_CONFIG_COUNT": "3",
            "GIT_CONFIG_KEY_0": "protocol.file.allow",
            "GIT_CONFIG_VALUE_0": "always",
            "GIT_CONFIG_KEY_1": f"url.{remote}.insteadOf",
            "GIT_CONFIG_VALUE_1": "https://github.com/o/fork.git",
            "GIT_CONFIG_KEY_2": f"url.{remote}.insteadOf",
            "GIT_CONFIG_VALUE_2": "https://github.com/u/up.git",
        })
        return value

    monkeypatch.setattr(localdiff, "git_env", env)
    reviews = tmp_path / "reviews"
    monkeypatch.setattr(review, "REVIEWS", reviews)
    return reviews


def test_analyze_fails_closed_on_git_error(tmp_path, monkeypatch):
    def bad_git(*args, **kwargs):
        return subprocess.CompletedProcess(args, 128, b"", b"fatal")

    monkeypatch.setattr(localdiff, "git", bad_git)
    with pytest.raises(RuntimeError):
        localdiff.analyze(tmp_path / "empty.git", "a" * 40, "b" * 40, {}, 100, 1000)


def test_hollow_report_is_refused():
    payload = {
        "inputs": {"commit": "b" * 40, "base_sha": "a" * 40},
        "blocks": [], "signals": [], "findings": [], "verdict": "no findings",
        "stats": {"files": 0, "lines": 0},
    }
    with pytest.raises(ValueError, match="hollow"):
        review.write_report("one", "b" * 40, payload)


def test_incremental_scan_fetches_base_and_reads_second_commit(tmp_path, monkeypatch):
    first, second, remote = fork_fixture(tmp_path)
    reviews = scan_fixture(tmp_path, monkeypatch, first, second, remote)
    review.scan("synthetic", 2000, 200000, first, second)
    data = json.loads((reviews / f"synthetic-{second}.json").read_text())
    assert data["inputs"]["base_sha"] == first
    assert data["stats"]["files"] == 1
    assert any("return 2222" in block["text"] for block in data["blocks"])


def test_scan_fails_closed_when_incremental_base_is_missing(tmp_path, monkeypatch):
    first, second, remote = fork_fixture(tmp_path)
    reviews = scan_fixture(tmp_path, monkeypatch, first, second, remote)
    review.scan("synthetic", 2000, 200000, "c" * 40, second)
    data = json.loads((reviews / f"synthetic-{second}.json").read_text())
    assert data["verdict"] == "too large to review"
    assert data["stats"]["reason"] == "scanner error"
    assert not data["blocks"]


def test_pr_step_second_run_commits_on_top_and_edits_pr(tmp_path, monkeypatch):
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    work.mkdir()
    git(work, "init", "-b", "main")
    git(work, "config", "user.email", "t@e")
    git(work, "config", "user.name", "T")
    (work / "reviews").mkdir()
    report = work / "reviews" / "a.json"
    report.write_text(json.dumps({"verdict": "seed", "blocks": []}))
    git(work, "add", ".")
    git(work, "commit", "-m", "seed")
    git(work, "remote", "add", "origin", str(remote))
    git(work, "push", "-u", "origin", "main")
    monkeypatch.chdir(work)
    monkeypatch.setattr(sys, "argv", ["pr_step"])
    calls, real_run = [], subprocess.run

    def fake_run(args, **kwargs):
        if args[0] != "gh":
            return real_run(args, **kwargs)
        calls.append(args)
        created = any(call[:3] == ["gh", "pr", "create"] for call in calls)
        ok = args[1:3] in (["pr", "create"], ["pr", "edit"]) or (args[1:3] == ["pr", "view"] and created)
        return subprocess.CompletedProcess(args, 0 if ok else 1, "", "")

    monkeypatch.setattr(pr_step.subprocess, "run", fake_run)
    report.write_text(json.dumps({"verdict": "run-one", "blocks": []}))
    pr_step.main()
    report.write_text(json.dumps({"verdict": "run-two", "blocks": []}))
    pr_step.main()

    branch = f"review/weekly-{pr_step.week()}"
    assert any(call[:4] == ["gh", "pr", "edit", branch] and "--body-file" in call for call in calls)
    tip = git(remote, "rev-parse", branch)
    assert json.loads(git(remote, "show", f"{tip}:reviews/a.json"))["verdict"] == "run-two"
    assert json.loads(git(remote, "show", f"{tip}^:reviews/a.json"))["verdict"] == "run-one"
