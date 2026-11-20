"""Regressions: prompt V4 defines the task and all three verdicts, neutrally."""

from review.reader import client, prompt, report

BLOCKS = [{"id": "a", "path": "a.py", "text": "return 1234"}]


def test_v4_names_what_counts_as_suspicious():
    text = prompt.READER_PROMPT_V4
    for phrase in (
        "downloading or executing code",
        "network endpoints",
        "credentials",
        "persistence",
        "privilege",
        "disabling checks",
        "obfuscated",
        "hidden or misleading text",
    ):
        assert phrase in text, phrase


def test_v4_defines_harmless_by_behaviour_not_familiarity():
    text = prompt.READER_PROMPT_V4
    assert "none of the above applies" in text
    for phrase in ("numeric kernels", "build flags", "tests", "docs", "refactors"):
        assert phrase in text, phrase
    assert "not by being unfamiliar" in text


def test_v4_defines_unsure_narrowly():
    text = prompt.READER_PROMPT_V4
    assert "cannot be determined from its text" in text
    assert "say what is missing" in text
    assert "library or a GPU API" in text


def test_v4_judges_each_block_on_its_own_text():
    assert "only on its own text" in prompt.READER_PROMPT_V4


def test_v4_stays_neutral():
    text = prompt.READER_PROMPT_V4.lower()
    assert "most code" not in text
    assert "find something" not in text
    assert "assume" not in text


def test_v4_keeps_the_data_and_output_contracts():
    text = prompt.READER_PROMPT_V4
    assert "untrusted" in text
    assert '"results"' in text
    assert "whole line" in text
    assert "8" in text


def test_v3_is_gone_and_everything_uses_v4():
    assert not hasattr(prompt, "READER_PROMPT_V3")
    request = client.build_request(prompt.READER_PROMPT_V4, BLOCKS, [], [], "DELIM")
    assert "only on its own text" in request["messages"][0]["content"]
    assert report.annotate({"blocks": []}, [], [], {})["prompt_version"] == prompt.READER_PROMPT_V4
