#!/usr/bin/env python3
"""Validate the wild corpus without changing any owner-owned corpus files."""

from collections import Counter
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
WILD = ROOT / "corpus" / "wild.jsonl"
BASE = ROOT / "corpus" / "cases.jsonl"
ALLOWED_CHECKS = {"exact", "regex", "contains_all", "json_schema", "rubric"}
REQUIRED = {"id", "lang", "category", "split", "turns", "check", "check_payload"}


def read_jsonl(path):
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                rows.append((line_no, json.loads(line)))
            except json.JSONDecodeError as error:
                raise AssertionError(f"{path.name}:{line_no}: invalid JSON: {error}") from error
    return rows


def validate_case(line_no, case):
    assert isinstance(case, dict), f"wild:{line_no}: case is not an object"
    assert REQUIRED <= set(case), f"wild:{line_no}: missing schema fields"
    assert isinstance(case["id"], str) and case["id"], f"wild:{line_no}: bad id"
    assert case["lang"] in {"en", "it", "es", "fr", "de", "pt", "zh", "ja"}, f"wild:{line_no}: bad lang"
    assert case["category"] in {"multilingual", "absurd"}, f"wild:{line_no}: bad category"
    assert case["split"] == "wild", f"wild:{line_no}: split is not wild"
    assert isinstance(case["turns"], list) and case["turns"], f"wild:{line_no}: turns must be non-empty"
    for turn in case["turns"]:
        assert isinstance(turn, dict), f"wild:{line_no}: turn is not an object"
        assert turn.get("role") in {"user", "assistant"}, f"wild:{line_no}: bad turn role"
        assert isinstance(turn.get("content"), str) and turn["content"].strip(), f"wild:{line_no}: empty turn"
    assert case["check"] in ALLOWED_CHECKS, f"wild:{line_no}: unsupported check"
    payload = case["check_payload"]
    assert isinstance(payload, dict), f"wild:{line_no}: check payload is not an object"
    if case["check"] == "contains_all":
        assert isinstance(payload.get("items"), list) and payload["items"], f"wild:{line_no}: bad contains_all"
        assert all(isinstance(item, str) and item for item in payload["items"]), f"wild:{line_no}: bad contains_all item"
    elif case["check"] == "regex":
        assert isinstance(payload.get("pattern"), str) and payload["pattern"], f"wild:{line_no}: bad regex"
        assert payload.get("flags", "") in {"", "i"}, f"wild:{line_no}: unsupported regex flags"
        re.compile(payload["pattern"], re.I if "i" in payload.get("flags", "") else 0)
    elif case["check"] == "rubric":
        criteria = payload.get("criteria")
        assert isinstance(criteria, list) and 1 <= len(criteria) <= 5, f"wild:{line_no}: bad rubric criteria count"
        for criterion in criteria:
            assert isinstance(criterion, dict), f"wild:{line_no}: rubric criterion is not an object"
            assert isinstance(criterion.get("name"), str) and criterion["name"], f"wild:{line_no}: rubric name missing"
            anchors = criterion.get("anchors")
            assert isinstance(anchors, dict) and set(anchors) == {"1", "3", "5"}, f"wild:{line_no}: rubric anchors must be 1/3/5"
            assert all(isinstance(value, str) and value for value in anchors.values()), f"wild:{line_no}: empty rubric anchor"


def main():
    wild_rows = read_jsonl(WILD)
    base_rows = read_jsonl(BASE)
    assert len(wild_rows) == 30, f"expected 30 wild cases, found {len(wild_rows)}"

    ids = [case["id"] for _, case in wild_rows]
    assert len(set(ids)) == len(ids), "wild case ids are not unique"
    for line_no, case in wild_rows:
        validate_case(line_no, case)

    categories = Counter(case["category"] for _, case in wild_rows)
    assert categories == Counter({"multilingual": 18, "absurd": 12}), categories

    multilingual_langs = Counter(case["lang"] for _, case in wild_rows if case["category"] == "multilingual")
    assert multilingual_langs == Counter({lang: 3 for lang in ("es", "fr", "de", "pt", "zh", "ja")}), multilingual_langs

    absurd_langs = Counter(case["lang"] for _, case in wild_rows if case["category"] == "absurd")
    assert absurd_langs == Counter({"en": 6, "it": 6}), absurd_langs

    base_prompts = {
        turn["content"]
        for _, case in base_rows
        for turn in case["turns"]
    }
    wild_prompts = [
        (case["id"], turn["content"])
        for _, case in wild_rows
        for turn in case["turns"]
    ]
    overlaps = [(case_id, text) for case_id, text in wild_prompts if text in base_prompts]
    assert not overlaps, f"wild prompt text overlaps cases.jsonl: {overlaps}"

    rubric_cases = [case for _, case in wild_rows if case["check"] == "rubric"]
    language_criterion = "Answers in the user's language"
    multilingual_rubrics = [case for case in rubric_cases if case["category"] == "multilingual"]
    assert multilingual_rubrics, "no multilingual rubric cases"
    assert all(
        any(criterion["name"] == language_criterion for criterion in case["check_payload"]["criteria"])
        for case in multilingual_rubrics
    ), "multilingual rubric cases lack the language criterion"

    print(f"wild validation passed: cases={len(wild_rows)} base_cases={len(base_rows)}")
    print(f"categories: multilingual={categories['multilingual']} absurd={categories['absurd']}")
    print("multilingual languages: " + ", ".join(f"{lang}={multilingual_langs[lang]}" for lang in ("es", "fr", "de", "pt", "zh", "ja")))
    print(f"absurd languages: en={absurd_langs['en']} it={absurd_langs['it']}")
    print(f"prompt overlap: none ({len(wild_prompts)} wild prompts checked)")


if __name__ == "__main__":
    main()
