"""Failing-first regressions: reader timeout, stderr progress, result files."""

import json
import sys
import urllib.error

import pytest

from review import corpus_run, weekly
from review.reader import client

SECRET_A = "sk-aaa-DO-NOT-LEAK-111"
SECRET_B = "sk-bbb-DO-NOT-LEAK-222"
# Captured at import time, before conftest's autouse fixture swaps in a fake transport.
REAL_HTTP = client._http


def test_request_timeout_is_300_seconds(monkeypatch):
    assert client.REQUEST_TIMEOUT == 300
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"choices": []}'

    def fake_urlopen(request, timeout=None):
        seen["timeout"] = timeout
        return Response()

    monkeypatch.setattr(client, "_http", REAL_HTTP)
    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    cfg = client.Config("https://example.invalid/v1", "m", "k")
    client._http(cfg, {"messages": [{"content": "x"}]}, "max")
    assert seen["timeout"] == 300


def test_timeout_is_not_a_model_judgement():
    def timeout_http(_config, _request, _effort):
        raise TimeoutError("read timed out")

    cfg = client.Config("https://example.invalid/v1", "m", "k", effort="high")
    blocks = [{"id": "a", "text": "return 1234"}]
    rows = client.read(cfg, blocks, [], [], http=timeout_http)
    assert [row["reason"] for row in rows] == ["reader timeout"]
    counts = client.tally(rows)
    assert counts["timeouts"] == 1
    assert counts["unsure"] == 0


def test_urlerror_timeout_is_also_a_timeout():
    def wrapped(_config, _request, _effort):
        raise urllib.error.URLError(TimeoutError("read timed out"))

    cfg = client.Config("https://example.invalid/v1", "m", "k", effort="high")
    rows = client.read(cfg, [{"id": "a", "text": "return 1234"}], [], [], http=wrapped)
    assert client.tally(rows)["timeouts"] == 1


def test_model_unsure_is_not_an_error():
    rows = [{"id": "a", "verdict": "unsure", "reason": "looks odd", "quoted_line": ""}]
    counts = client.tally(rows)
    assert counts["unsure"] == 1
    assert counts["timeouts"] == 0 and counts["errors"] == 0


def test_corpus_progress_and_results_have_no_secrets(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("REVIEW_A_KEY", SECRET_A)
    monkeypatch.setenv("REVIEW_B_KEY", SECRET_B)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    captured = capsys.readouterr()
    assert SECRET_A not in captured.err and SECRET_B not in captured.err
    assert SECRET_A not in captured.out and SECRET_B not in captured.out
    assert "Authorization" not in captured.err and "Bearer" not in captured.err
    for _, data in corpus_run.fixtures():
        for block in data.get("blocks") or [{"text": data.get("text", "")}]:
            text = block.get("text", "")
            if len(text) > 20:
                assert text[:40] not in captured.err
    lines = [line for line in captured.err.splitlines() if line.strip()]
    assert len(lines) == len(corpus_run.fixtures())
    for line in lines:
        assert "A=" in line and "B=" in line and "tokens=" in line


def test_corpus_writes_markdown_and_json(tmp_path, monkeypatch):
    out = tmp_path / "results"
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(out))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    markdown = out / "corpus-summary.md"
    payload = out / "corpus-results.json"
    assert markdown.is_file() and payload.is_file()
    assert markdown.read_text().strip()
    data = json.loads(payload.read_text())
    records = data["records"]
    assert len(records) == len(corpus_run.fixtures())
    for record in records:
        assert {"name", "expected", "gate", "reader_a", "reader_b", "timeouts", "errors"} <= set(record)
    assert data["totals"]["timeouts"] == 0


def test_weekly_writes_markdown_and_json(tmp_path, monkeypatch, capsys):
    out = tmp_path / "results"
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(out))
    monkeypatch.setenv("REVIEW_A_KEY", SECRET_A)
    monkeypatch.setenv("REVIEW_B_KEY", SECRET_B)
    report = {
        "engine": "aaa", "verdict": "no findings",
        "inputs": {"commit": "a" * 40}, "stats": {"files": 1, "lines": 2},
        "blocks": [{"id": "x", "path": "a.py", "readers": {
            "a": {"verdict": "harmless"}, "b": {"verdict": "harmless"}}}],
    }
    reviews = tmp_path / "reviews"
    reviews.mkdir()
    (reviews / f"aaa-{'a' * 40}.json").write_text(json.dumps(report))
    monkeypatch.setattr(weekly.review, "REVIEWS", reviews)
    monkeypatch.setattr(weekly.review, "scan", lambda *a, **k: None)
    monkeypatch.setattr(weekly, "_batch", lambda n: [{"id": "aaa", "head": "a" * 40}])
    monkeypatch.setattr(sys, "argv", ["weekly"])
    weekly.main()
    captured = capsys.readouterr()
    assert SECRET_A not in captured.err and SECRET_B not in captured.err
    lines = [line for line in captured.err.splitlines() if line.strip()]
    assert lines[0] == "started aaa"
    assert len(lines) == 2, "one started line plus one progress line per fork"
    assert "A=" in captured.err and "tokens=" in captured.err
    data = json.loads((out / "weekly-results.json").read_text())
    assert data["records"][0]["id"] == "aaa"
    assert data["records"][0]["verdict"] == "no findings"
    assert (out / "weekly-summary.md").is_file()


def test_workflow_timeout_and_results_artifact():
    from pathlib import Path

    from ruamel.yaml import YAML

    path = Path(__file__).resolve().parents[3] / ".github/workflows/review.yml"
    document = YAML(typ="safe").load(path.read_text())
    scan = document["jobs"]["scan"]
    assert scan["timeout-minutes"] == 180
    uploads = [step for step in scan["steps"] if str(step.get("uses", "")).startswith("actions/upload-artifact")]
    results = [step for step in uploads if "results" in str(step.get("with", {}).get("path", ""))]
    assert results, "the results dir must be uploaded"
    for step in results:
        assert "weekly" not in str(step.get("if", "")), "results upload must cover both modes"
