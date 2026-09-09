#!/usr/bin/env python3
import json
import secrets
from pathlib import Path

from checks import strip_reasoning


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def anonymize(pack, key, row_id, category, lang, prompt, rubric, lfm, minicpm):
    if secrets.randbelow(2):
        a, b, mapping = minicpm, lfm, {"A": "minicpm", "B": "lfm"}
    else:
        a, b, mapping = lfm, minicpm, {"A": "lfm", "B": "minicpm"}
    pack.append({"id": row_id, "category": category, "lang": lang, "prompt": prompt,
                 "rubric": rubric, "answer_A": strip_reasoning(a), "answer_B": strip_reasoning(b)})
    key[row_id] = mapping


def bakeoff_rubric(question):
    return {
        "measure": question.get("measures", ""),
        "score": question.get("score", {}),
        "criteria": [
            {"name": "Language fidelity", "anchors": {"1": "Wrong or unusable language.", "3": "Understandable with minor drift.", "5": "Natural language appropriate to the prompt."}},
            {"name": "Honesty and accuracy", "anchors": {"1": "Materially false or overconfident.", "3": "Mostly sound with a minor issue.", "5": "Accurate, honest, and appropriately uncertain."}},
            {"name": "Task fit", "anchors": {"1": "Misses the task or central constraint.", "3": "Addresses the task adequately.", "5": "Fully addresses the task concisely."}},
        ],
    }


def main():
    wild_cases = [case for case in read_rows(ROOT / "corpus" / "wild.jsonl") if case["check"] == "rubric"]
    wild_lfm = {row["id"]: row for row in read_rows(RESULTS / "wild-v2" / "lfm.jsonl")}
    wild_minicpm = {row["id"]: row for row in read_rows(RESULTS / "wild-v2" / "minicpm.jsonl")}
    questions = json.loads(Path("/Users/marco/Projects/kalsa/scripts/quality/questions.json").read_text(encoding="utf-8"))["questions"]
    q_by_id = {question["id"]: question for question in questions}
    lfm = {(row["qid"], row["lang"]): row for row in read_rows(RESULTS / "bakeoff-v2" / "lfm@256.jsonl")}
    minicpm = {(row["qid"], row["lang"]): row for row in read_rows(RESULTS / "bakeoff-v2" / "minicpm@256.jsonl")}
    pack, key = [], {}
    for case in wild_cases:
        anonymize(pack, key, case["id"], case["category"], case["lang"], case["turns"], case["check_payload"],
                  wild_lfm[case["id"]].get("assistant_text", ""), wild_minicpm[case["id"]].get("assistant_text", ""))
    for pair in sorted(lfm):
        question = q_by_id[pair[0]]
        anonymize(pack, key, f"bakeoff/{pair[0]}/{pair[1]}", question.get("kind", "bakeoff"), pair[1],
                  [{"role": "user", "content": question["prompts"][pair[1]]}], bakeoff_rubric(question),
                  lfm[pair].get("answer", lfm[pair].get("content", "")), minicpm[pair].get("answer", minicpm[pair].get("content", "")))
    (RESULTS / "judge-pack-v2.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in pack), encoding="utf-8")
    (RESULTS / "judge-key-v2.json").write_text(json.dumps(key, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (RESULTS / "judge-pack-v2.md").open("w", encoding="utf-8") as handle:
        handle.write("# Blind judge pack v2\n\nAnswers are anonymized as A and B. Do not infer model identity from style.\n\n")
        for row in pack:
            handle.write(f"## {row['id']}\n\nCategory: `{row['category']}`; language: `{row['lang']}`\n\n")
            handle.write("### Prompt\n\n")
            for turn in row["prompt"]:
                handle.write(f"**{turn['role']}**: {turn['content']}\n\n")
            handle.write("### Rubric\n\n```json\n" + json.dumps(row["rubric"], ensure_ascii=False, indent=2) + "\n```\n\n")
            handle.write("### Answer A\n\n" + (row["answer_A"] or "[empty]") + "\n\n")
            handle.write("### Answer B\n\n" + (row["answer_B"] or "[empty]") + "\n\n")
    print(f"judge pack v2 written: rows={len(pack)} wild={len(wild_cases)} bakeoff={len(pack)-len(wild_cases)}")


if __name__ == "__main__":
    main()
