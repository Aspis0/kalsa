"""Regressions: prompt V3 quote instruction, and per-fixture quote + refusal rule."""

import json
import sys

from review import corpus_run, decide
from review.reader import client, pipeline, prompt, report
import reader_responses

TEXT = "def f():\n    return 1234\n"
BLOCK = {"id": "probe", "path": "probe.txt", "text": TEXT}


def row(quoted, verdict="harmless", reason="ordinary code"):
    return {"id": "probe", "verdict": verdict, "reason": reason, "quoted_line": quoted}


def test_prompt_v3_asks_for_one_whole_line():
    assert '"results"' in prompt.READER_PROMPT_V4
    assert "whole line" in prompt.READER_PROMPT_V4
    assert "best supports" in prompt.READER_PROMPT_V4
    assert "8" in prompt.READER_PROMPT_V4
    assert not hasattr(prompt, "READER_PROMPT_V2"), "the bumped prompt must not leave dead code"


def test_request_and_report_use_v3():
    request = client.build_request(prompt.READER_PROMPT_V4, [BLOCK], [], [], "DELIM")
    assert "whole line" in request["messages"][0]["content"]
    annotated = report.annotate({"blocks": []}, [], [], {})
    assert annotated["prompt_version"] == prompt.READER_PROMPT_V4


def test_judge_names_each_refusing_rule():
    both = row("return 1234")
    assert decide.judge(BLOCK, both, both, [], [], []) == ("auto-clean", "")
    assert decide.judge(BLOCK, both, both, [], [], [], None, ["r"])[1] == "hard-rule"
    assert decide.judge(BLOCK, both, both, [], ["i"], [])[1] == "injection"
    assert decide.judge(BLOCK, both, both, [], [], ["m"])[1] == "malware"
    assert decide.judge(BLOCK, {**both, "needs_person": True}, both, [], [], [])[1] == "reader-needs-person"
    assert decide.judge(BLOCK, row("return 1234", verdict="unsure"), both, [], [], [])[1] == "a:verdict-not-harmless"
    assert decide.judge(BLOCK, row("return 1234", reason="  "), both, [], [], [])[1] == "a:empty-reason"
    assert decide.judge(BLOCK, row("return 123"), both, [], [], [])[1] == "a:quote-not-a-whole-line"
    assert decide.judge(BLOCK, row("def f():"), both, [], [], [])[1] == "a:quote-shorter-than-8"
    assert decide.judge(BLOCK, both, row("def f():"), [], [], [])[1] == "b:quote-shorter-than-8"


def test_decide_verdicts_are_unchanged():
    both = row("return 1234")
    assert decide.decide(BLOCK, both, both, [], [], []) == "auto-clean"
    assert decide.decide(BLOCK, row("def f():"), row("def f():"), [], [], []) == "needs person"
    assert decide.decide(BLOCK, row(TEXT), row(TEXT), [], [], []) == "needs person"
    assert decide.decide(BLOCK, row("return 123"), row("return 123"), [], [], []) == "needs person"


def test_pipeline_judge_block_returns_the_rule():
    both = row("return 1234")
    assert pipeline.judge_block(BLOCK, both, both, [], [], []) == ("auto-clean", "")
    assert pipeline.review_block(BLOCK, row("def f():"), row("def f():"), [], [], []) == "needs person"


def run_corpus(tmp_path, monkeypatch, quoted, text=TEXT):
    monkeypatch.setattr(corpus_run, "fixtures", lambda: [("probe", {"text": text, "good": True})])

    def http(_config, request, _effort):
        body = request["messages"][0]["content"]
        start = body.index('"blocks": ') + len('"blocks": ')
        blocks = json.JSONDecoder().raw_decode(body[start:])[0]
        return reader_responses.results([
            {"id": b["id"], "verdict": "harmless", "reason": "ordinary code", "quoted_line": quoted}
            for b in blocks
        ])

    monkeypatch.setattr(client, "_http", http)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    return json.loads((tmp_path / "results" / "corpus-results.json").read_text())["records"][0]


def test_corpus_records_the_quote_and_the_short_line_refusal(tmp_path, monkeypatch):
    record = run_corpus(tmp_path, monkeypatch, "def f():")
    assert record["gate"] is False
    assert record["quoted_a"] == ["def f():"] and record["quoted_b"] == ["def f():"]
    assert record["refusals"] == {"probe": "a:quote-shorter-than-8"}


def test_corpus_records_the_multiline_refusal(tmp_path, monkeypatch):
    record = run_corpus(tmp_path, monkeypatch, "def f():\n    return 1234")
    assert record["refusals"] == {"probe": "a:quote-not-a-whole-line"}
    assert record["quoted_a"] == ["def f():\n    return 1234"]


def test_corpus_records_the_fragment_refusal(tmp_path, monkeypatch):
    record = run_corpus(tmp_path, monkeypatch, "return 123")
    assert record["refusals"] == {"probe": "a:quote-not-a-whole-line"}


def test_corpus_auto_clean_records_no_refusal(tmp_path, monkeypatch):
    record = run_corpus(tmp_path, monkeypatch, "return 1234")
    assert record["gate"] is True
    assert record["refusals"] == {}
    assert record["quoted_a"] == ["return 1234"]


def test_corpus_quotes_are_escaped_and_capped(tmp_path, monkeypatch):
    line = "x = '<script>" + "y" * 400 + "' & done"
    record = run_corpus(tmp_path, monkeypatch, line, text=line + "\n")
    quoted = record["quoted_a"][0]
    assert len(quoted) <= 200
    assert "&lt;script&gt;" in quoted and "<script>" not in quoted
    assert record["gate"] is True
