"""Regressions: real-world quote forms, and per-row refusals are shape errors."""

import json
import sys

from review import corpus_run, decide, weekly
from review.reader import client
import reader_responses

TEXT = "def f():\n    return 1234\n"
BLOCK = {"id": "known_good", "path": "known_good.txt", "text": TEXT}


def row(quoted, verdict="harmless"):
    return {"id": "known_good", "verdict": verdict, "reason": "ordinary function", "quoted_line": quoted}


def verdict_for(quoted):
    return decide.decide(BLOCK, row(quoted), row(quoted), [], [], [])


def test_whole_line_quote_counts_with_or_without_indentation():
    assert verdict_for("return 1234") == "auto-clean"
    assert verdict_for("    return 1234") == "auto-clean"
    assert verdict_for("return 1234   ") == "auto-clean"
    assert verdict_for("\treturn 1234") == "auto-clean"


def test_fragment_of_a_line_never_counts():
    assert verdict_for("return 123") == "needs person"
    assert verdict_for("f():") == "needs person"
    assert verdict_for("def f(): return 1234") == "needs person"


def test_short_whole_line_is_refused_by_the_length_rule():
    # "def f():" is a whole line but has only 7 non-space characters.
    assert verdict_for("def f():") == "needs person"


def test_multiline_quote_is_refused():
    assert verdict_for("def f():\n    return 1234") == "needs person"
    assert verdict_for(TEXT) == "needs person"


def test_known_good_gates_clean_when_the_quote_is_a_whole_long_line():
    assert verdict_for("return 1234") == "auto-clean"


def config():
    return client.Config("https://example.invalid/v1", "m", "k", effort="high", session="s")


def read_rows(rows):
    def http(_config, _request, _effort):
        return reader_responses.results(rows)

    return client.read(config(), [BLOCK], [], [], http=http)


def test_invalid_row_shape_is_a_shape_error_not_unsure():
    rows = read_rows([{"id": "known_good", "verdict": "harmless", "reason": "ok"}])
    counts = client.tally(rows)
    assert counts["errors"] == 1
    assert counts["error_classes"] == {"reader error: shape": 1}
    assert counts["unsure"] == 0


def test_bad_quote_is_a_shape_error_not_unsure():
    rows = read_rows([row("not in the block at all")])
    counts = client.tally(rows)
    assert counts["errors"] == 1
    assert counts["error_classes"] == {"reader error: shape": 1}
    assert counts["unsure"] == 0


def test_wrong_id_is_a_shape_error_not_unsure():
    rows = read_rows([{**row("return 1234"), "id": "other"}])
    assert client.tally(rows)["error_classes"] == {"reader error: shape": 1}


def test_genuine_model_unsure_is_still_not_an_error():
    rows = read_rows([row("return 1234", verdict="unsure")])
    counts = client.tally(rows)
    assert counts["unsure"] == 1 and counts["errors"] == 0


def test_corpus_json_records_reader_reasons(tmp_path, monkeypatch):
    long_reason = "why <script> & " + "x" * 400

    def http(_config, _request, _effort):
        return reader_responses.results([
            {"id": "known_good", "verdict": "unsure", "reason": long_reason, "quoted_line": ""},
        ])

    monkeypatch.setattr(client, "_http", http)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    data = json.loads((tmp_path / "results" / "corpus-results.json").read_text())
    record = next(r for r in data["records"] if r["name"] == "known_good")
    for key in ("reasons_a", "reasons_b"):
        assert len(record[key]) == 1
        reason = record[key][0]
        assert len(reason) <= 200
        assert "&lt;script&gt;" in reason and "<script>" not in reason
        assert "&amp;" in reason


def test_weekly_stderr_never_carries_reasons(tmp_path, monkeypatch, capsys):
    secret_reason = "REASON-TEXT-MUST-NOT-REACH-STDERR"
    report = {
        "engine": "aaa", "verdict": "human review needed",
        "inputs": {"commit": "a" * 40}, "stats": {"files": 1, "lines": 2},
        "blocks": [{"id": "x", "path": "a.py", "readers": {
            "a": {"verdict": "unsure", "reason": secret_reason},
            "b": {"verdict": "unsure", "reason": secret_reason}}}],
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
    assert secret_reason not in captured.err
    assert "reason" not in captured.err.lower()
