"""Failing-first tests for the weekly workflow and provider wiring."""

import json
import os
import re
import sys
from pathlib import Path

import pytest

from review import apply as review_apply
from review import batch, client, weekly


def test_batch_picker_is_deterministic_and_incremental():
    engines = [
        {"id": "aaa", "kind": "fork", "repo": "o/aaa", "upstream": "u/aaa"},
        {"id": "bbb", "kind": "fork", "repo": "o/bbb", "upstream": "u/bbb"},
        {"id": "ccc", "kind": "fork", "repo": "o/ccc", "upstream": "u/ccc"},
        {"id": "ddd", "kind": "fork", "repo": "o/ddd", "upstream": "u/ddd"},
    ]
    reports = {
        ("aaa", "a" * 40): {"inputs": {"commit": "a" * 40, "base_sha": "b" * 40}},
        ("bbb", "b" * 40): {"inputs": {"commit": "b" * 40}},
    }
    heads = {"aaa": "c" * 40, "bbb": "b" * 40, "ccc": "d" * 40, "ddd": "e" * 40}
    sizes = {"aaa": 50, "ccc": 10, "ddd": 5}
    picked = batch.pick(engines, reports, heads, sizes, max_repos=3)
    assert [row["id"] for row in picked] == ["aaa", "ddd", "ccc"]
    assert picked[0]["base_sha"] == "a" * 40
    assert picked[0]["head"] == "c" * 40
    assert "bbb" not in [row["id"] for row in picked]


def test_provider_config_has_effort_and_headers(monkeypatch):
    monkeypatch.setenv("REVIEW_A_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("REVIEW_A_MODEL", "reader-a")
    monkeypatch.setenv("REVIEW_A_KEY", "secret")
    monkeypatch.setenv("REVIEW_A_EFFORT", "max")
    cfg = client.from_env("REVIEW_A")
    assert cfg.effort == "max"
    request = client.build_request("prompt", [{"id": "a", "text": "return 1"}], [], [], "D")
    headers = client.headers(cfg, "session-1")
    assert headers["User-Agent"] == "kalsa-review/1.0 (+https://kalsa.io)"
    assert headers["x-opencode-session"] == "session-1"
    assert "secret" not in repr(cfg)


def test_effort_fallback_is_recorded(tmp_path, monkeypatch):
    cfg = client.Config("https://example.invalid/v1", "reader-a", "secret", effort="max", session="s")
    calls = []

    def http(_cfg, request, effort):
        calls.append(effort)
        if effort == "max":
            raise client.ProviderError("unsupported reasoning_effort")
        rows = [{"id": "a", "verdict": "harmless", "reason": "ok", "quoted_line": "return 1234"}]
        return {"choices": [{"message": {"content": json.dumps(rows)}}]}

    result = client.read(cfg, [{"id": "a", "text": "return 1234"}], [], [], http=http)
    assert calls == ["max", "high"]
    assert result[0]["effort"] == "high"


def test_dry_run_writes_reports_without_network(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "catalog").mkdir()
    (tmp_path / "catalog/engines.toml").write_text(
        '[[engine]]\nid = "aaa"\nname = "a"\nrepo = "o/aaa"\nauthor = "o"\nlicense = "MIT"\n'
        'kind = "fork"\nupstream = "u/aaa"\nhardware = ["apple-m1"]\nsummary = "s"\n'
    )
    (tmp_path / "scripts").mkdir()
    reports = weekly.dry_run(max_repos=1)
    assert reports and Path(reports[0]).is_file()
    data = json.loads(Path(reports[0]).read_text())
    assert data["shadow"] is True
    assert "secret" not in json.dumps(data)


def test_shadow_flag_blocks_apply(tmp_path, monkeypatch):
    monkeypatch.setenv("KALSA_SHADOW", "true")
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "o/fork"\n')
    with pytest.raises(ValueError, match="shadow"):
        review_apply.apply_review("one", catalog)


def test_workflow_yaml_shape():
    path = Path(__file__).resolve().parents[3] / ".github/workflows/review.yml"
    text = path.read_text()
    assert "workflow_dispatch:" in text and "schedule:" in text
    assert "pull_request" not in text
    assert "environment: review" in text
    assert "KALSA_SHADOW" in text
    assert "add-mask" in text


def test_workflow_pins_verified_values():
    text = (Path(__file__).resolve().parents[3] / ".github/workflows/review.yml").read_text()
    assert "fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8" in text
    assert "CLAMAV_VERSION: \"1.5.4+dfsg-0ubuntu0.24.04.1\"" in text
    assert "YARA_VERSION: \"4.5.0-1build2\"" in text
    assert "runs-on: ubuntu-24.04" in text
    assert "REVIEW_TOKEN_BUDGET: \"3000000\"" in text
    assert "systemctl stop clamav-freshclam" in text
    assert "SEMGREP_VERSION" not in text


def test_pr_step_dry_run_and_failure_message(tmp_path, monkeypatch):
    from review import pr_step

    monkeypatch.chdir(tmp_path)
    (tmp_path / "reviews").mkdir()
    (tmp_path / "reviews/a.json").write_text(json.dumps({"verdict": "no findings", "blocks": []}))
    assert pr_step.digest([tmp_path / "reviews/a.json"], tmp_path / "reviews")
    monkeypatch.setattr(pr_step.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(pr_step.subprocess.CalledProcessError(1, a[0])))
    assert "create and approve pull requests" in pr_step.pr_error()


def test_pr_job_has_no_environment():
    text = (Path(__file__).resolve().parents[3] / ".github/workflows/review.yml").read_text()
    section = text.split("  pull-request:", 1)[1]
    assert "environment: review" not in section
    assert "needs.scan.outputs.mode == 'weekly'" in section


def test_weekly_main_uses_real_scan(monkeypatch, tmp_path):
    from review import weekly

    called = []
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)

    def fake_scan(engine_id, *a, **k):
        called.append(engine_id)
        (reviews / f"{engine_id}-{'a' * 40}.json").write_text(json.dumps({"verdict": "no findings", "blocks": []}))

    monkeypatch.setattr(weekly.review, "scan", fake_scan)
    monkeypatch.setattr(weekly, "dry_run", lambda *a, **k: pytest.fail("dry_run must not be used by weekly"))
    monkeypatch.setattr(weekly, "_batch", lambda max_repos: [{"id": "aaa", "head": "a" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    assert called == ["aaa"]


def test_dry_run_report_cannot_be_applied(tmp_path, monkeypatch):
    from review import weekly

    out = tmp_path / "dry"
    monkeypatch.setenv("REVIEW_REPORTS_DIR", str(out))
    paths = weekly.dry_run(max_repos=1)
    data = json.loads(paths[0].read_text())
    assert data["verdict"] == "dry-run"
    catalog = tmp_path / "engines.toml"
    catalog.write_text('[[engine]]\nid = "one"\nkind = "fork"\nupstream = "up/repo"\nrepo = "o/one"\n')
    with pytest.raises(ValueError):
        review_apply.apply_review("one", catalog)


def test_incremental_base_uses_last_reviewed_commit(tmp_path, monkeypatch):
    from review import batch

    reports = {("aaa", "a" * 40): {"inputs": {"commit": "a" * 40}}}
    heads = {"aaa": "b" * 40}
    picked = batch.pick([{"id": "aaa", "kind": "fork", "repo": "o/aaa", "upstream": "u/aaa"}], reports, heads, {}, 5)
    assert picked[0]["base_sha"] == "a" * 40


def test_corpus_gate_counts_are_real(tmp_path, monkeypatch):
    from review import corpus_run

    result = corpus_run.evaluate()
    assert result["gate_bad_pass"] + result["gate_bad_fail"] == corpus_run.bad_count()
    assert result["gate_good_pass"] + result["gate_good_fail"] == corpus_run.good_count()


def test_pr_step_uses_branch_and_body_file(monkeypatch, tmp_path):
    from review import pr_step

    calls = []
    monkeypatch.setattr(pr_step.subprocess, "run", lambda args, **k: calls.append(args) or type("R", (), {"returncode": 0})())
    monkeypatch.setattr(pr_step, "digest", lambda reports, reports_dir: "safe digest")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "reviews").mkdir()
    (tmp_path / "reviews/a.json").write_text(json.dumps({"verdict": "no findings"}))
    monkeypatch.setattr(sys, "argv", ["pr_step"])
    pr_step.main()
    joined = " ".join(" ".join(call) for call in calls)
    assert "review/weekly-" in joined and "--body-file" in joined
    assert "git push" in joined


PINS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
}


def action_pins(text: str) -> dict:
    from ruamel.yaml import YAML

    document = YAML(typ="safe").load(text)
    pins = {}
    for job in document["jobs"].values():
        for step in job.get("steps", []):
            uses = step.get("uses")
            if not uses:
                continue
            name, _, sha = uses.partition("@")
            assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", name), uses
            assert re.fullmatch(r"[0-9a-f]{40}", sha), uses
            pins[name] = sha
    return pins


def test_actions_are_pinned_by_sha():
    text = (Path(__file__).resolve().parents[3] / ".github/workflows/review.yml").read_text()
    assert action_pins(text) == PINS


def test_truncated_pin_is_rejected():
    text = (Path(__file__).resolve().parents[3] / ".github/workflows/review.yml").read_text()
    sha = PINS["actions/upload-artifact"]
    with pytest.raises(AssertionError):
        action_pins(text.replace(sha, sha[:36]))


def test_weekly_with_nothing_to_do_prints_summary(monkeypatch, capsys):
    from review import weekly

    monkeypatch.setattr(weekly, "_batch", lambda max_repos: [])
    monkeypatch.setattr(weekly.review, "scan", lambda *a, **k: pytest.fail("nothing to scan"))
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    assert "no fork changed since its last review" in capsys.readouterr().out


def test_weekly_module_entry_point_runs(tmp_path):
    """The workflow runs `python -m scripts.review.weekly`; that must reach main()."""
    import shutil
    import subprocess

    shutil.copytree(Path(__file__).resolve().parents[1], tmp_path / "scripts" / "review")
    (tmp_path / "catalog").mkdir()
    (tmp_path / "catalog" / "engines.toml").write_text('[[engine]]\nid = "ref"\nkind = "reference"\n')
    result = subprocess.run(
        [sys.executable, "-m", "scripts.review.weekly", "--max-repos", "1"],
        cwd=tmp_path, env={**os.environ, "GITHUB_TOKEN": "x"},
        capture_output=True, text=True, timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert "no fork changed since its last review" in result.stdout


def test_force_push_falls_back_to_full_read():
    from review import batch

    engines = [{"id": "aaa", "kind": "fork", "repo": "o/aaa", "upstream": "u/aaa"}]
    reports = {("aaa", "a" * 40): {"inputs": {"commit": "a" * 40}}}
    picked = batch.pick(
        engines, reports, {"aaa": "b" * 40}, {}, 5,
        ancestry={"aaa": False},
    )
    assert picked[0]["base_sha"] == ""
