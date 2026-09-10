#!/usr/bin/env python3
import json
import re
import secrets
from pathlib import Path

from checks import strip_reasoning


ROOT = Path(__file__).resolve().parent


def rows(path):
    return {row["id"]: row for line in path.read_text(encoding="utf-8").splitlines() if line.strip() for row in [json.loads(line)]}


def clean(text):
    text = strip_reasoning(text or "")
    text = re.sub(r"<\|tool_call_start\|>[\s\S]*?(?:<\|tool_call_end\|>|$)", "", text, flags=re.I)
    text = re.sub(r"<function\b[^>]*>[\s\S]*?</function>", "", text, flags=re.I)
    return text.strip()


def model_answer(pack, key, model):
    side = next(side for side in ("A", "B") if key[side] == model)
    return pack["answer_" + side]


def main():
    base = rows(ROOT / "results/judge-pack-v2.jsonl")
    base_key = json.loads((ROOT / "results/judge-key-v2.json").read_text())
    repaired = rows(ROOT / "results/judge-pack-v2b.jsonl")
    repaired_key = json.loads((ROOT / "results/judge-key-v2b.json").read_text())
    mini = rows(ROOT / "results/bakeoff-v2d/minicpm-q8@nobudget.jsonl")
    mini.update(rows(ROOT / "results/wild-v2d/minicpm-q8@nobudget.jsonl"))
    output = ROOT / "results/judge-pack-v2d-q8.jsonl"
    key_output = ROOT / "results/judge-key-v2d-q8.json"
    mapping = {}
    with output.open("w", encoding="utf-8") as handle:
        for ident, old in base.items():
            lfm = model_answer(repaired[ident], repaired_key[ident], "lfm") if ident in repaired else model_answer(old, base_key[ident], "lfm")
            q8 = mini[ident]["answer"]
            if secrets.randbelow(2):
                answer_a, answer_b = q8, lfm
                mapping[ident] = {"A": "minicpm-q8", "B": "lfm-v2b-merged"}
            else:
                answer_a, answer_b = lfm, q8
                mapping[ident] = {"A": "lfm-v2b-merged", "B": "minicpm-q8"}
            row = {"id": ident, "category": old["category"], "lang": old["lang"], "prompt": old["prompt"], "rubric": old["rubric"], "answer_A": clean(answer_a), "answer_B": clean(answer_b)}
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    key_output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote={output} rows={len(mapping)} key={key_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
