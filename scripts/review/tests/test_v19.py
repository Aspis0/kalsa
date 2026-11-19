"""Failing-first regressions: one verdict per block id, never by position."""

import json

from review.reader import client, runner
import reader_responses

BLOCKS = [
    {"id": "a", "path": "a.py", "text": "return 1234"},
    {"id": "b", "path": "b.py", "text": "return 5678"},
]


def row(identifier, verdict="harmless", quoted=None):
    return {
        "id": identifier, "verdict": verdict, "reason": "ok",
        "quoted_line": quoted if quoted is not None else f"return {identifier}",
    }


def payload(rows):
    return reader_responses.results(rows)


def config(effort="max"):
    return client.Config("https://example.invalid/v1", "reader-a", "secret", effort=effort, session="s")


def test_effort_fallback_replaces_rows_not_appends():
    calls = []

    def http(_cfg, _request, effort):
        calls.append(effort)
        if effort == "max":
            raise OSError("connection reset")
        return payload([row("a", quoted="return 1234"), row("b", quoted="return 5678")])

    result = client.read(config(), BLOCKS, [], [], http=http)
    assert calls == ["max", "max", "max", "high"]
    assert [entry["id"] for entry in result] == ["a", "b"]
    assert all(entry["verdict"] == "harmless" for entry in result)
    assert all(entry["effort"] == "high" for entry in result)


def test_verdicts_are_matched_by_id_not_position():
    def http(_cfg, _request, _effort):
        return payload([
            row("b", "suspicious", "return 5678"),
            row("a", "harmless", "return 1234"),
        ])

    result = client.read(config("high"), BLOCKS, [], [], http=http)
    by_id = {entry["id"]: entry for entry in result}
    assert len(result) == 2
    assert by_id["a"]["verdict"] == "harmless"
    assert by_id["b"]["verdict"] == "suspicious"


def test_all_efforts_failing_still_yields_one_unsure_row_per_block():
    def http(_cfg, _request, _effort):
        raise client.ProviderError("reasoning_effort rejected")

    result = client.read(config(), BLOCKS, [], [], http=http)
    assert [entry["id"] for entry in result] == ["a", "b"]
    assert all(entry["verdict"] == "unsure" for entry in result)


def test_runner_rejects_misaligned_verdict_ids(monkeypatch):
    good = [row("a", quoted="return 1234"), row("b", quoted="return 5678")]
    misaligned = [
        [good[0], good[0]],
        [good[0]],
        good + [row("c", quoted="return 9999")],
    ]
    for bad in misaligned:
        monkeypatch.setattr(runner.client, "read", lambda cfg, blocks, hints, precedents, budget=None: bad)
        _, _, decisions = runner.run(BLOCKS, {}, {}, {})
        assert set(decisions) == {"a", "b"}
        assert set(decisions.values()) == {"needs person"}, bad


def test_runner_matches_verdicts_by_id_when_order_differs(monkeypatch):
    reversed_rows = [row("b", quoted="return 5678"), row("a", quoted="return 1234")]
    monkeypatch.setattr(runner.client, "read", lambda cfg, blocks, hints, precedents, budget=None: reversed_rows)
    _, _, decisions = runner.run(BLOCKS, {}, {}, {})
    assert decisions == {"a": "auto-clean", "b": "auto-clean"}
