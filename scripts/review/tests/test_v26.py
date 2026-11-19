"""Failing-first regressions: the real API returns an object, not an array."""

import json
import sys
import urllib.error

from review import corpus_run
from review.reader import client, prompt

ROW = {"id": "a", "verdict": "harmless", "reason": "ok", "quoted_line": "return 1234"}
BLOCKS = [{"id": "a", "path": "a.py", "text": "return 1234"}]


def config():
    return client.Config("https://example.invalid/v1", "m", "k", effort="high", session="s")


def envelope(content, **message_fields):
    message = {"role": "assistant", "content": content}
    message.update(message_fields)
    return {"choices": [{"message": message}]}


def results_payload(rows):
    return json.dumps({"results": rows})


def test_prompt_asks_for_a_results_object():
    assert '"results"' in prompt.READER_PROMPT_V2
    request = client.build_request(prompt.READER_PROMPT_V2, BLOCKS, [], [], "DELIM")
    assert request["response_format"] == {"type": "json_object"}
    assert '"results"' in request["messages"][0]["content"]


def test_recorded_deepseek_response_shape_parses():
    # Recorded live: message keys are role / content / reasoning_content.
    response = envelope(results_payload([ROW]), reasoning_content="thinking about the block")

    def http(_config, _request, _effort):
        return response

    rows = client.read(config(), BLOCKS, [], [], http=http)
    assert [row["verdict"] for row in rows] == ["harmless"]
    assert client.tally(rows)["errors"] == 0


def test_recorded_mimo_response_shape_parses():
    # Recorded live: message keys are role / content / refusal / reasoning / reasoning_details.
    response = envelope(
        results_payload([ROW]), refusal=None, reasoning="thinking",
        reasoning_details=[{"type": "reasoning.text", "text": "thinking"}],
    )

    def http(_config, _request, _effort):
        return response

    rows = client.read(config(), BLOCKS, [], [], http=http)
    assert [row["verdict"] for row in rows] == ["harmless"]


def read_with(content):
    def http(_config, _request, _effort):
        return envelope(content)

    return client.read(config(), BLOCKS, [], [], http=http)


def test_bare_list_is_a_shape_error():
    rows = read_with(json.dumps([ROW]))
    assert [row["reason"] for row in rows] == ["reader error: shape"]
    counts = client.tally(rows)
    assert counts["errors"] == 1 and counts["unsure"] == 0
    assert counts["error_classes"] == {"reader error: shape": 1}


def test_bare_single_row_is_a_shape_error():
    assert read_with(json.dumps(ROW))[0]["reason"] == "reader error: shape"


def test_missing_or_extra_top_level_keys_are_shape_errors():
    for payload in ({}, {"rows": [ROW]}, {"results": [ROW], "extra": 1}):
        rows = read_with(json.dumps(payload))
        assert [row["reason"] for row in rows] == ["reader error: shape"], payload


def test_results_must_be_a_list():
    assert read_with(json.dumps({"results": ROW}))[0]["reason"] == "reader error: shape"


def test_wrong_count_and_duplicate_ids_are_shape_errors():
    for rows in ([ROW, {**ROW, "id": "b"}], [ROW, ROW]):
        got = read_with(results_payload(rows))
        assert [row["reason"] for row in got] == ["reader error: shape"]


def test_unparsable_json_has_its_own_reason_class():
    rows = read_with("not json")
    assert [row["reason"] for row in rows] == ["reader error: json"]
    assert client.tally(rows)["error_classes"] == {"reader error: json": 1}


def test_http_4xx_has_its_own_reason_class():
    def http(_config, _request, _effort):
        raise urllib.error.HTTPError("https://example.invalid/v1", 404, "Not Found", {}, None)

    rows = client.read(config(), BLOCKS, [], [], http=http)
    assert [row["reason"] for row in rows] == ["reader error: http 4xx"]
    assert client.tally(rows)["errors"] == 1


def test_http_5xx_is_distinct_from_4xx():
    def http(_config, _request, _effort):
        raise urllib.error.HTTPError("https://example.invalid/v1", 503, "Unavailable", {}, None)

    rows = client.read(config(), BLOCKS, [], [], http=http)
    assert [row["reason"] for row in rows] == ["reader error: http 5xx"]


def test_timeout_still_is_not_an_error_class():
    def http(_config, _request, _effort):
        raise TimeoutError("read timed out")

    counts = client.tally(client.read(config(), BLOCKS, [], [], http=http))
    assert counts["timeouts"] == 1 and counts["errors"] == 0
    assert counts["error_classes"] == {}


def test_model_unsure_is_not_an_error_class():
    rows = [{"id": "a", "verdict": "unsure", "reason": "looks odd", "quoted_line": ""}]
    counts = client.tally(rows)
    assert counts["unsure"] == 1 and counts["errors"] == 0 and counts["error_classes"] == {}


def test_corpus_results_show_the_failure_cause(tmp_path, monkeypatch, capsys):
    def broken(_config, _request, _effort):
        return envelope(json.dumps([ROW]))

    monkeypatch.setattr(client, "_http", broken)
    monkeypatch.setenv("REVIEW_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setattr(sys, "argv", ["corpus_run", "--summary"])
    corpus_run.main()
    data = json.loads((tmp_path / "results" / "corpus-results.json").read_text())
    assert data["totals"]["error_classes"]["reader error: shape"] > 0
    assert all(row["error_classes"] for row in data["records"])
    assert "reader error: shape" in capsys.readouterr().out
    assert "reader error: shape" in (tmp_path / "results" / "corpus-summary.md").read_text()
