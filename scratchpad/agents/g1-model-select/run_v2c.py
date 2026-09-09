#!/usr/bin/env python3
import argparse
import json
import os
import time

from checks import check_response
from v2_tools import endpoint
from v2b_tools import complete_with_app_semantics
from v2c_metrics import response_metrics


def prompt_language(lang):
    return "it" if lang == "it" else "en"


def load_jsonl(path):
    return [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]


def load_inputs(args):
    judged = load_jsonl(args.judge_pack)
    if args.block == "wild":
        cases = {case["id"]: case for case in load_jsonl(args.corpus)}
        return [(row, cases[row["id"]]) for row in judged if "/" not in row["id"]]
    questions = json.load(open(args.questions, encoding="utf-8"))["questions"]
    by_id = {question["id"]: question for question in questions}
    values = []
    for row in judged:
        if "/" not in row["id"]:
            continue
        _, qid, lang = row["id"].split("/", 2)
        values.append((row, (by_id[qid], lang)))
    return values


def request_fields(args, sampler, tools):
    fields = {"model": "minicpm-v2c", **sampler, "tools": tools, "tool_choice": "auto"}
    if args.block == "bakeoff":
        fields["seed"] = 1234
    if args.budget == "1024":
        fields["thinking_budget_tokens"] = 1024
    else:
        fields.pop("thinking_budget_tokens", None)
    return fields


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--block", choices=("wild", "bakeoff"), required=True)
    parser.add_argument("--budget", choices=("1024", "nobudget"), required=True)
    parser.add_argument("--sampler", required=True)
    parser.add_argument("--judge-pack", default="results/judge-pack-v2.jsonl")
    parser.add_argument("--corpus", default="corpus/wild.jsonl")
    parser.add_argument("--questions", required=True)
    parser.add_argument("--tools-file", required=True)
    parser.add_argument("--system-prompt-en-file", required=True)
    parser.add_argument("--system-prompt-it-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    args = parser.parse_args()

    sampler = json.load(open(args.sampler, encoding="utf-8"))
    tools = json.load(open(args.tools_file, encoding="utf-8"))
    prompts = {
        "en": open(args.system_prompt_en_file, encoding="utf-8").read().rstrip("\n"),
        "it": open(args.system_prompt_it_file, encoding="utf-8").read().rstrip("\n"),
    }
    values = load_inputs(args)
    fields = request_fields(args, sampler, tools)
    url = endpoint(args.base_url)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    rows = []
    errors = 0
    for judged, source in values:
        if args.block == "wild":
            case = source
            lang = case["lang"]
            messages = [{"role": "system", "content": prompts[prompt_language(lang)]}, *case["turns"]]
            row_id = case["id"]
            category = case["category"]
            split = case["split"]
            qid = None
            user_prompt = case["turns"][-1]["content"]
        else:
            question, lang = source
            messages = [
                {"role": "system", "content": prompts[prompt_language(lang)]},
                {"role": "user", "content": question["prompts"][lang]},
            ]
            row_id = judged["id"]
            category = question["kind"]
            split = "bakeoff"
            qid = question["id"]
            user_prompt = question["prompts"][lang]
        started = time.perf_counter()
        final, responses, meta = complete_with_app_semantics(
            url, messages, fields, args.timeout, args.retry_delay
        )
        metrics = response_metrics(args.base_url, responses, args.timeout)
        wall_ms = round((time.perf_counter() - started) * 1000)
        if meta["error"]:
            errors += 1
        row = {
            "id": row_id, "qid": qid, "model": "minicpm5-2b", "model_label": "minicpm-v2c",
            "block": args.block, "budget_label": args.budget,
            "budget": 1024 if args.budget == "1024" else None,
            "lang": lang, "category": category, "split": split,
            "system_lang": prompt_language(lang), "prompt": user_prompt,
            "content": meta["final_text"], "answer": meta["final_text"],
            "model_visible_answer": metrics["model_visible_answer"],
            "reasoning_content": meta["reasoning_text"],
            "reasoning_tokens": metrics["reasoning_tokens"],
            "visible_answer_tokens": metrics["visible_answer_tokens"],
            "predicted_tokens": metrics["predicted_tokens"],
            "wall_ms": wall_ms,
            "model_answer_empty": metrics["model_answer_empty"],
            "model_answer_bare_gt": metrics["model_answer_bare_gt"],
            "finish": (final.get("choices") or [{}])[0].get("finish_reason"),
            "timings": final.get("timings"), "round_timings": meta["round_timings"],
            "prompt_tokens": meta["prompt_tokens"], "completion_tokens": meta["completion_tokens"],
            "tool_rounds": meta["tool_rounds"], "tool_names": meta["tool_names"],
            "round_log": meta["round_log"], "round_call_counts": meta["round_call_counts"],
            "final_contains_raw_tool_syntax": meta["final_contains_raw_tool_syntax"],
            "raw_response": final, "round_responses": responses,
            "tools_file": os.path.abspath(args.tools_file),
        }
        if metrics["tokenize_error"]:
            row["tokenize_error"] = metrics["tokenize_error"]
        if meta["error"]:
            row["error"] = meta["error"]
        if args.block == "wild":
            from v2b_tools import response_with_visible_text
            row["check"] = {"status": check_response(case, response_with_visible_text(final, meta["final_text"]))["status"]}
        rows.append(row)
    with open(args.out, "w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote={args.out} rows={len(rows)} errors={errors} budget={args.budget}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
