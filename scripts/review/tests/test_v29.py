"""Regressions: runner GitHub token, secret-free failures, artifact on early crash."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from review import corpus_run, github, results, weekly

SECRET = "ghp_DO-NOT-LEAK-THIS-TOKEN-123456"
WORKFLOW = Path(__file__).resolve().parents[3] / ".github/workflows/review.yml"


def test_token_prefers_the_environment(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", SECRET)

    def never(*args, **kwargs):
        raise AssertionError("gh must not be called when GITHUB_TOKEN is set")

    monkeypatch.setattr(github.subprocess, "run", never)
    assert github.token() == SECRET


def test_missing_token_raises_a_clear_error(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(
        github.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 1, "", "gh: not logged in"),
    )
    with pytest.raises(RuntimeError) as caught:
        github.token()
    assert not isinstance(caught.value, subprocess.CalledProcessError)
    message = str(caught.value)
    assert "GITHUB_TOKEN" in message and "gh" in message
    assert "not logged in" not in message, "gh stderr must not be echoed"


def test_missing_gh_binary_raises_the_same_clear_error(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    def absent(*args, **kwargs):
        raise FileNotFoundError("gh")

    monkeypatch.setattr(github.subprocess, "run", absent)
    with pytest.raises(RuntimeError, match="GITHUB_TOKEN"):
        github.token()


def test_empty_gh_output_is_not_a_token(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setattr(
        github.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, "  \n", ""),
    )
    with pytest.raises(RuntimeError, match="GITHUB_TOKEN"):
        github.token()


def test_redact_removes_every_secret_env_value(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", SECRET)
    monkeypatch.setenv("REVIEW_A_KEY", "reader-key-abc")
    text = f"boom {SECRET} and reader-key-abc"
    assert SECRET not in results.redact(text)
    assert "reader-key-abc" not in results.redact(text)


def test_weekly_crash_writes_results_without_the_token(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_TOKEN", SECRET)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))

    def leaky(_max_repos):
        raise RuntimeError(f"api refused {SECRET}")

    monkeypatch.setattr(weekly, "_batch", leaky)
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(RuntimeError) as caught:
        weekly.main()
    assert SECRET not in str(caught.value)
    captured = capsys.readouterr()
    assert SECRET not in captured.out and SECRET not in captured.err
    markdown = (tmp_path / "results" / "weekly-summary.md").read_text()
    payload = (tmp_path / "results" / "weekly-results.json").read_text()
    assert SECRET not in markdown and SECRET not in payload
    assert "RuntimeError" in payload
    data = json.loads(payload)
    assert data["records"][0]["error"] == "RuntimeError"


def test_weekly_crash_during_scan_still_writes_results(tmp_path, monkeypatch):
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "aaa", "head": "a" * 40}])

    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(weekly.review, "scan", boom)
    monkeypatch.setattr(sys, "argv", ["weekly"])
    with pytest.raises(RuntimeError, match="OSError"):
        weekly.main()
    assert (tmp_path / "results" / "weekly-results.json").is_file()


def test_corpus_unconfigured_readers_still_write_results(tmp_path, monkeypatch):
    for prefix in ("REVIEW_A", "REVIEW_B"):
        for suffix in ("_BASE_URL", "_MODEL", "_KEY"):
            monkeypatch.delenv(prefix + suffix, raising=False)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    data = json.loads((tmp_path / "results" / "corpus-results.json").read_text())
    assert data["records"][0]["error"] == "RuntimeError"
    assert "readers are not configured" in (tmp_path / "results" / "corpus-summary.md").read_text()


def test_corpus_crash_writes_results_without_secrets(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("REVIEW_A_KEY", SECRET)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))

    def leaky():
        raise RuntimeError(f"provider refused {SECRET}")

    monkeypatch.setattr(corpus_run, "evaluate", leaky)
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    with pytest.raises(RuntimeError) as caught:
        corpus_run.main()
    assert SECRET not in str(caught.value)
    captured = capsys.readouterr()
    assert SECRET not in captured.out and SECRET not in captured.err
    assert SECRET not in (tmp_path / "results" / "corpus-results.json").read_text()


def workflow():
    from ruamel.yaml import YAML

    return YAML(typ="safe").load(WORKFLOW.read_text())


def step(job, name):
    return next(item for item in job["steps"] if item.get("name") == name)


def test_github_token_only_on_the_weekly_step():
    document = workflow()
    scan = document["jobs"]["scan"]
    weekly_step = step(scan, "Weekly batch and reports")
    assert weekly_step["env"]["GITHUB_TOKEN"] == "${{ github.token }}"
    for item in scan["steps"]:
        if item is weekly_step:
            continue
        assert "GITHUB_TOKEN" not in (item.get("env") or {}), item.get("name", item.get("uses"))
    assert "GITHUB_TOKEN" not in (scan.get("env") or {})
    assert "GITHUB_TOKEN" not in (document.get("env") or {})


def test_scan_job_keeps_read_only_permissions():
    document = workflow()
    assert document["permissions"] == {"contents": "read"}
    assert "permissions" not in document["jobs"]["scan"]


def test_pull_request_job_has_only_its_own_gh_token():
    job = workflow()["jobs"]["pull-request"]
    for item in job["steps"]:
        env = item.get("env") or {}
        assert "GITHUB_TOKEN" not in env
        if env:
            assert set(env) == {"GH_TOKEN"}
            assert env["GH_TOKEN"] == "${{ github.token }}"


def test_results_upload_is_unconditional():
    scan = workflow()["jobs"]["scan"]
    uploads = [s for s in scan["steps"] if str(s.get("uses", "")).startswith("actions/upload-artifact")]
    results_upload = [s for s in uploads if "review-results" in str(s.get("with", {}).get("path", ""))]
    assert results_upload and results_upload[0]["if"] == "always()"
