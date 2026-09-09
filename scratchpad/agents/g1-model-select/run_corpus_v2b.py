#!/usr/bin/env python3
import argparse
import json
import os
import time

from checks import check_response, raw_text_from, tool_call_mode, tool_calls_from
from v2_tools import endpoint
from v2b_tools import complete_with_app_semantics, response_with_visible_text


def prompt_language(lang):
    return "it" if lang == "it" else "en"


def load_cases(path, split, ids):
    cases = []
    for line in open(path, encoding="utf-8"):
        if line.strip():
            case = json.loads(line)
            if (split == "all" or case["split"] == split) and case["id"] in ids:
                cases.append(case)
    return cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--split", choices=("dev", "holdout", "all"), required=True)
    parser.add_argument("--sampler", required=True)
    parser.add_argument("--system-prompt-en-file", required=True)
    parser.add_argument("--system-prompt-it-file", required=True)
    parser.add_argument("--tools-file", required=True)
    parser.add_argument("--ids-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--corpus", default=os.path.join(os.path.dirname(__file__), "corpus", "wild.jsonl"))
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    args = parser.parse_args()
    sampler = json.loads(open(args.sampler, encoding="utf-8").read())
    tools = json.loads(open(args.tools_file, encoding="utf-8").read())
    ids = {line.strip() for line in open(args.ids_file, encoding="utf-8") if line.strip()}
    prompts = {
        "en": open(args.system_prompt_en_file, encoding="utf-8").read().rstrip("\n"),
        "it": open(args.system_prompt_it_file, encoding="utf-8").read().rstrip("\n"),
    }
    cases = load_cases(args.corpus, args.split, ids)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    url = endpoint(args.base_url)
    errors = 0
    with open(args.out, "w", encoding="utf-8") as output:
        for case in cases:
            lang = prompt_language(case["lang"])
            messages = [{"role": "system", "content": prompts[lang]}, *case["turns"]]
            fields = {"model": args.model_label, **sampler, "tools": tools, "tool_choice": "auto"}
            started = time.perf_counter()
            final, responses, meta = complete_with_app_semantics(url, messages, fields, args.timeout, args.retry_delay)
            scored = response_with_visible_text(final, meta["final_text"])
            row = {
                "id": case["id"], "model_label": args.model_label, "lang": case["lang"],
                "category": case["category"], "split": case["split"], "system_lang": lang,
                "raw_response": final, "round_responses": responses,
                "assistant_text_raw": raw_text_from(final), "assistant_text": meta["final_text"],
                "reasoning_text": meta["reasoning_text"], "tool_call_mode": tool_call_mode(final),
                "tool_calls": tool_calls_from(final), "tool_rounds": meta["tool_rounds"],
                "tool_names": meta["tool_names"], "round_log": meta["round_log"],
                "round_call_counts": meta["round_call_counts"],
                "final_contains_raw_tool_syntax": meta["final_contains_raw_tool_syntax"],
                "final_empty": meta["final_empty"], "elapsed_seconds": round(time.perf_counter() - started, 6),
                "timings": final.get("timings"), "round_timings": meta["round_timings"],
                "prompt_tokens": meta["prompt_tokens"], "completion_tokens": meta["completion_tokens"],
                "v2b_reason": "selected from v2: finish_reason=tool_calls or empty content",
                "tools_file": os.path.abspath(args.tools_file),
            }
            if meta["error"]:
                row["check"] = {"status": "ERROR", "detail": meta["error"]}
                errors += 1
            else:
                row["check"] = check_response(case, scored)
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote={args.out} selected={len(cases)} errors={errors}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
