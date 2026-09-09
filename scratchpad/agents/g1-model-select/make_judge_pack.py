#!/usr/bin/env python3
import json
import secrets
from pathlib import Path

from checks import strip_reasoning


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def corpus_cases(path, predicate):
    return [case for case in rows(path) if predicate(case)]


def add_case(pack, key, case, answer_a, answer_b):
    if secrets.randbelow(2):
        answer_a, answer_b = answer_b, answer_a
        key[case["id"]] = {"A": "minicpm", "B": "lfm"}
    else:
        key[case["id"]] = {"A": "lfm", "B": "minicpm"}
    pack.append({
        "id": case["id"],
        "category": case["category"],
        "lang": case["lang"],
        "prompt": case.get("turns", case.get("prompt", [])),
        "rubric": case.get("check_payload", case.get("rubric", {})),
        "answer_A": answer_a,
        "answer_B": answer_b,
    })


def answer_map(path):
    return {row["id"]: row.get("assistant_text", "") for row in rows(path)}


def bakeoff_rows():
    questions = json.loads((Path("/Users/marco/Projects/kalsa/scripts/quality/questions.json")).read_text(encoding="utf-8"))
    q_by_id = {question["id"]: question for question in questions["questions"]}
    lfm = {(row["qid"], row["lang"]): row for row in rows(RESULTS / "bakeoff" / "lfm@256.jsonl")}
    minicpm = {(row["qid"], row["lang"]): row for row in rows(RESULTS / "bakeoff" / "minicpm@256.jsonl")}
    out = []
    for pair in sorted(lfm):
        question = q_by_id[pair[0]]
        prompt = [{"role": "user", "content": lfm[pair]["prompt"]}]
        rubric = {
            "measure": question.get("measures", ""),
            "score": question.get("score", {}),
            "criteria": [
                {"name": "Language fidelity", "anchors": {"1": "Wrong or unusable language.", "3": "Understandable with minor drift.", "5": "Natural language appropriate to the prompt."}},
                {"name": "Honesty and accuracy", "anchors": {"1": "Materially false or overconfident.", "3": "Mostly sound with a minor issue.", "5": "Accurate, honest, and appropriately uncertain."}},
                {"name": "Task fit", "anchors": {"1": "Misses the task or central constraint.", "3": "Addresses the task adequately.", "5": "Fully addresses the task concisely."}},
            ],
        }
        out.append({"id": f"bakeoff/{pair[0]}/{pair[1]}", "category": question.get("kind", "bakeoff"), "lang": pair[1], "prompt": prompt, "rubric": rubric,
                    "answer_A": "", "answer_B": "", "_answers": (strip_reasoning(lfm[pair].get("content", "")), strip_reasoning(minicpm[pair].get("content", "")))})
    return out


def main():
    dev = corpus_cases(ROOT / "corpus" / "cases.jsonl", lambda c: c["split"] == "dev" and c["check"] == "rubric")
    wild = corpus_cases(ROOT / "corpus" / "wild.jsonl", lambda c: c["check"] == "rubric")
    lfm_dev = answer_map(RESULTS / "lfm-dev.jsonl")
    minicpm_dev = answer_map(RESULTS / "minicpm-dev.jsonl")
    lfm_wild = answer_map(RESULTS / "wild" / "lfm-dev.jsonl")
    minicpm_wild = answer_map(RESULTS / "wild" / "minicpm-dev.jsonl")
    pack = []
    key = {}
    for case in dev:
        add_case(pack, key, case, lfm_dev.get(case["id"], ""), minicpm_dev.get(case["id"], ""))
    for case in wild:
        add_case(pack, key, case, lfm_wild.get(case["id"], ""), minicpm_wild.get(case["id"], ""))
    for case in bakeoff_rows():
        answers = case.pop("_answers")
        add_case(pack, key, case, answers[0], answers[1])

    RESULTS.mkdir(exist_ok=True)
    with (RESULTS / "judge-pack.jsonl").open("w", encoding="utf-8") as handle:
        for case in pack:
            handle.write(json.dumps(case, ensure_ascii=False) + "\n")
    (RESULTS / "judge-key.json").write_text(json.dumps(key, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (RESULTS / "judge-pack.md").open("w", encoding="utf-8") as handle:
        handle.write("# Blind judge pack\n\n")
        handle.write("Answers are anonymized as A and B. Do not infer model identity from style.\n\n")
        for case in pack:
            handle.write(f"## {case['id']}\n\n")
            handle.write(f"Category: `{case['category']}`; language: `{case['lang']}`\n\n")
            handle.write("### Prompt\n\n")
            for turn in case["prompt"]:
                handle.write(f"**{turn['role']}**: {turn['content']}\n\n")
            handle.write("### Rubric\n\n```json\n" + json.dumps(case["rubric"], ensure_ascii=False, indent=2) + "\n```\n\n")
            handle.write("### Answer A\n\n" + (case["answer_A"] or "[empty]") + "\n\n")
            handle.write("### Answer B\n\n" + (case["answer_B"] or "[empty]") + "\n\n")
    print(f"judge pack written: rows={len(pack)} dev={len(dev)} wild={len(wild)} bakeoff={len(pack) - len(dev) - len(wild)}")


if __name__ == "__main__":
    main()
