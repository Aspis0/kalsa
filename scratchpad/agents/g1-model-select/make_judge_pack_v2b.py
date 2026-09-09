#!/usr/bin/env python3
import json
from pathlib import Path

from checks import strip_reasoning


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def answer_maps():
    wild = {}
    bakeoff = {}
    for model in ("lfm", "minicpm"):
        for row in rows(RESULTS / "wild-v2b" / f"{model}.jsonl"):
            wild.setdefault(row["id"], {})[model] = row.get("assistant_text", "")
        path = RESULTS / "bakeoff-v2b" / f"{model}@256.jsonl"
        for row in rows(path):
            bakeoff[f"bakeoff/{row['qid']}/{row['lang']}"] = bakeoff.get(f"bakeoff/{row['qid']}/{row['lang']}", {})
            bakeoff[f"bakeoff/{row['qid']}/{row['lang']}"][model] = row.get("answer", row.get("content", ""))
    return {**wild, **bakeoff}


def main():
    source = [json.loads(line) for line in (RESULTS / "judge-pack-v2.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    key = json.loads((RESULTS / "judge-key-v2.json").read_text(encoding="utf-8"))
    answers = answer_maps()
    original = {row["id"]: {"lfm": row["answer_A"] if key[row["id"]]["A"] == "lfm" else row["answer_B"],
                             "minicpm": row["answer_A"] if key[row["id"]]["A"] == "minicpm" else row["answer_B"]}
                for row in source}
    pack, subset_key = [], {}
    for row in source:
        if row["id"] not in answers:
            continue
        mapping = key[row["id"]]
        by_model = {**original[row["id"]], **answers.get(row["id"], {})}
        pack.append({
            "id": row["id"], "category": row["category"], "lang": row["lang"],
            "prompt": row["prompt"], "rubric": row["rubric"],
            "answer_A": strip_reasoning(by_model[mapping["A"]]),
            "answer_B": strip_reasoning(by_model[mapping["B"]]),
        })
        subset_key[row["id"]] = mapping
    (RESULTS / "judge-pack-v2b.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in pack), encoding="utf-8")
    (RESULTS / "judge-key-v2b.json").write_text(json.dumps(subset_key, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (RESULTS / "judge-pack-v2b.md").open("w", encoding="utf-8") as handle:
        handle.write("# Blind judge pack v2b\n\nAnswers use the same A/B mapping as judge-key-v2.json.\n\n")
        for row in pack:
            handle.write(f"## {row['id']}\n\nCategory: `{row['category']}`; language: `{row['lang']}`\n\n### Prompt\n\n")
            for turn in row["prompt"]:
                handle.write(f"**{turn['role']}**: {turn['content']}\n\n")
            handle.write("### Rubric\n\n```json\n" + json.dumps(row["rubric"], ensure_ascii=False, indent=2) + "\n```\n\n")
            handle.write("### Answer A\n\n" + (row["answer_A"] or "[empty]") + "\n\n### Answer B\n\n" + (row["answer_B"] or "[empty]") + "\n\n")
    print(f"judge pack v2b written: rows={len(pack)} mapping=v2-subset")


if __name__ == "__main__":
    main()
