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
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--budget", choices=("1024", "nobudget"), required=True)
    args = parser.parse_args()
    base = rows(ROOT / "results/judge-pack-v2.jsonl")
    base_key = json.loads((ROOT / "results/judge-key-v2.json").read_text())
    repaired = rows(ROOT / "results/judge-pack-v2b.jsonl")
    repaired_key = json.loads((ROOT / "results/judge-key-v2b.json").read_text())
    mini = rows(ROOT / "results" / "bakeoff-v2c" / f"minicpm@{args.budget}.jsonl")
    mini.update(rows(ROOT / "results" / "wild-v2c" / f"minicpm@{args.budget}.jsonl"))
    output = ROOT / f"results/judge-pack-v2c-{args.budget}.jsonl"
    key_output = ROOT / f"results/judge-key-v2c-{args.budget}.json"
    mapping = {}
    with output.open("w", encoding="utf-8") as handle:
        for ident, old in base.items():
            if ident in repaired:
                lfm = model_answer(repaired[ident], repaired_key[ident], "lfm")
            else:
                lfm = model_answer(old, base_key[ident], "lfm")
            mini_answer = mini[ident]["answer"]
            if secrets.randbelow(2):
                answer_a, answer_b = mini_answer, lfm
                mapping[ident] = {"A": "minicpm-v2c", "B": "lfm-v2b-merged"}
            else:
                answer_a, answer_b = lfm, mini_answer
                mapping[ident] = {"A": "lfm-v2b-merged", "B": "minicpm-v2c"}
            row = {"id": ident, "category": old["category"], "lang": old["lang"], "prompt": old["prompt"], "rubric": old["rubric"], "answer_A": clean(answer_a), "answer_B": clean(answer_b)}
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    key_output.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote={output} rows={len(mapping)} key={key_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
