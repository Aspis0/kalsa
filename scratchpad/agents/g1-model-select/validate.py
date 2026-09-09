#!/usr/bin/env python3
"""Validate the G1 corpus schema, document sizes, and planned distribution."""

import argparse
import json
from collections import Counter


ALLOWED = {"exact", "regex", "json_schema", "contains_all", "rubric"}
EXPECTED = {
    "category": {"conversation": 20, "instructions": 20, "tools": 16, "documents": 12, "memory": 12},
    "lang": {"it": 40, "en": 40},
    "split": {"dev": 60, "holdout": 20},
}


def fail(errors, line, message):
    errors.append(f"line {line}: {message}")


def validate(path):
    errors = []
    cases = []
    with open(path, encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                fail(errors, line_number, "blank line")
                continue
            try:
                case = json.loads(raw)
            except json.JSONDecodeError as error:
                fail(errors, line_number, f"invalid JSON: {error}")
                continue
            cases.append(case)
            required = {"id", "lang", "category", "split", "turns", "check", "check_payload"}
            missing = required - set(case)
            if missing:
                fail(errors, line_number, "missing " + ", ".join(sorted(missing)))
            if case.get("lang") not in {"it", "en"}:
                fail(errors, line_number, "bad lang")
            if case.get("category") not in EXPECTED["category"]:
                fail(errors, line_number, "bad category")
            if case.get("split") not in {"dev", "holdout"}:
                fail(errors, line_number, "bad split")
            turns = case.get("turns")
            if not isinstance(turns, list) or not turns or turns[-1].get("role") != "user":
                fail(errors, line_number, "turns must be nonempty and end with user")
            for turn in turns or []:
                if turn.get("role") not in {"system", "user", "assistant"} or not isinstance(turn.get("content"), str):
                    fail(errors, line_number, "invalid turn")
            if case.get("check") not in ALLOWED or not isinstance(case.get("check_payload"), dict):
                fail(errors, line_number, "invalid check or payload")
            else:
                payload = case["check_payload"]
                check = case["check"]
                if check == "exact" and not isinstance(payload.get("value"), str):
                    fail(errors, line_number, "exact check needs string value")
                if check == "regex" and not isinstance(payload.get("pattern"), str):
                    fail(errors, line_number, "regex check needs pattern")
                if check == "contains_all" and (not isinstance(payload.get("items"), list) or not payload["items"] or not all(isinstance(item, str) for item in payload["items"])):
                    fail(errors, line_number, "contains_all check needs string items")
                if check == "json_schema" and not isinstance(payload.get("schema"), dict):
                    fail(errors, line_number, "json_schema check needs schema")
            if case.get("check") == "rubric":
                criteria = case["check_payload"].get("criteria")
                if not isinstance(criteria, list) or len(criteria) != 3:
                    fail(errors, line_number, "rubric must have three criteria")
                else:
                    for criterion in criteria:
                        if not criterion.get("name") or set(criterion.get("anchors", {})) != {"1", "3", "5"}:
                            fail(errors, line_number, "rubric criterion needs name and 1/3/5 anchors")
            if case.get("category") == "documents":
                words = len(case.get("document", "").split())
                if not 150 <= words <= 400:
                    fail(errors, line_number, f"document has {words} words, expected 150-400")
                if not any(case["document"] in turn["content"] for turn in turns or []):
                    fail(errors, line_number, "document is not inline in turns")
            if case.get("category") == "memory" and (not isinstance(turns, list) or len(turns) < 5):
                fail(errors, line_number, "memory case needs at least five turns")
            if case.get("category") == "tools":
                tools = case.get("tools")
                expected_tool = case.get("expected_tool")
                if not isinstance(tools, list) or not tools or not isinstance(expected_tool, dict):
                    fail(errors, line_number, "tool case needs tools and expected_tool")
                elif not expected_tool.get("name") or not isinstance(expected_tool.get("required_arguments"), dict):
                    fail(errors, line_number, "invalid expected_tool")
                else:
                    names = []
                    for tool in tools:
                        function = tool.get("function", {}) if isinstance(tool, dict) else {}
                        parameters = function.get("parameters", {})
                        names.append(function.get("name"))
                        if tool.get("type") != "function" or not function.get("name") or parameters.get("type") != "object":
                            fail(errors, line_number, "tool is not OpenAI function format")
                        required = set(parameters.get("required", []))
                        if not set(expected_tool["required_arguments"]) <= required:
                            fail(errors, line_number, "expected arguments are not required by tool schema")
                    if expected_tool["name"] not in names:
                        fail(errors, line_number, "expected tool name is absent from tools")
            elif "tools" in case or "expected_tool" in case:
                fail(errors, line_number, "only tool cases may define tools")
    ids = [case.get("id") for case in cases]
    if len(ids) != len(set(ids)):
        errors.append("duplicate case id")
    if len(cases) != 80:
        errors.append(f"expected 80 cases, found {len(cases)}")
    prompts = {}
    for case in cases:
        prompt = json.dumps([(turn.get("role"), turn.get("content")) for turn in case.get("turns", []) if turn.get("role") == "user"], ensure_ascii=False)
        prior = prompts.get(prompt)
        if prior and prior != case.get("split"):
            errors.append(f"identical user prompt in dev/holdout: {case.get('id')}")
        prompts[prompt] = case.get("split")
    for field, expected in EXPECTED.items():
        counts = Counter(case.get(field) for case in cases)
        if dict(counts) != expected:
            errors.append(f"{field} distribution {dict(counts)} != {expected}")
    category_split = Counter((case.get("category"), case.get("split")) for case in cases)
    expected_split = {"conversation": (15, 5), "instructions": (15, 5), "tools": (12, 4), "documents": (9, 3), "memory": (9, 3)}
    for category, (dev, holdout) in expected_split.items():
        if category_split[(category, "dev")] != dev or category_split[(category, "holdout")] != holdout:
            errors.append(f"{category} split is {category_split[(category, 'dev')]}/{category_split[(category, 'holdout')]}")
    expected_lang_split = {("it", "dev"): 30, ("it", "holdout"): 10, ("en", "dev"): 30, ("en", "holdout"): 10}
    lang_split = Counter((case.get("lang"), case.get("split")) for case in cases)
    for key, expected in expected_lang_split.items():
        if lang_split[key] != expected:
            errors.append(f"{key[0]}/{key[1]} count {lang_split[key]} != {expected}")
    return cases, errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default="corpus/cases.jsonl")
    args = parser.parse_args()
    cases, errors = validate(args.path)
    if errors:
        print("VALIDATION FAILED")
        print("\n".join(errors))
        return 1
    print("VALIDATION OK")
    print(f"cases={len(cases)}")
    for field in ("category", "lang", "split"):
        print(f"{field}={dict(Counter(case[field] for case in cases))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
