#!/usr/bin/env python3
import argparse
import json
import os
import time

from checks import check_response, raw_text_from, reasoning_from, text_from, tool_call_mode, tool_calls_from
from v2_tools import complete_with_tools, endpoint


def load_cases(path, split):
    with open(path, encoding="utf-8") as handle:
        return [
            case for line in handle if line.strip()
            for case in [json.loads(line)]
            if split == "all" or case["split"] == split
        ]


def prompt_language(lang):
    return "it" if lang == "it" else "en"


def run_case(case, args, sampler, prompts, tools, url):
    system_lang = prompt_language(case["lang"])
    messages = [{"role": "system", "content": prompts[system_lang]}, *case["turns"]]
    request_fields = {
        "model": args.model_label,
        **sampler,
        "tools": tools,
        "tool_choice": "auto",
    }
    started = time.perf_counter()
    final, responses, meta = complete_with_tools(
        url, messages, request_fields, args.timeout, args.retry_delay
    )
    elapsed = time.perf_counter() - started
    result = {
        "id": case["id"],
        "model_label": args.model_label,
        "lang": case["lang"],
        "category": case["category"],
        "split": case["split"],
        "system_lang": system_lang,
        "raw_response": final,
        "round_responses": responses,
        "assistant_text_raw": raw_text_from(final),
        "assistant_text": text_from(final),
        "reasoning_text": meta["reasoning_text"] or reasoning_from(final),
        "tool_call_mode": tool_call_mode(final),
        "tool_calls": tool_calls_from(final),
        "tool_rounds": meta["tool_rounds"],
        "tool_names": meta["tool_names"],
        "final_contains_raw_tool_syntax": meta["final_contains_raw_tool_syntax"],
        "elapsed_seconds": round(elapsed, 6),
        "timings": final.get("timings"),
        "round_timings": meta["round_timings"],
        "prompt_tokens": meta["prompt_tokens"],
        "completion_tokens": meta["completion_tokens"],
        "endpoint": url,
        "sampler_file": os.path.abspath(args.sampler),
        "thinking_budget_tokens": sampler.get("thinking_budget_tokens"),
        "chat_template_kwargs": sampler.get("chat_template_kwargs"),
        "tools_file": os.path.abspath(args.tools_file),
        "system_prompt_file": os.path.abspath(args.system_prompt_files[system_lang]),
    }
    if meta["error"]:
        result["check"] = {"status": "ERROR", "detail": meta["error"]}
        return result, False
    result["check"] = check_response(case, final)
    return result, True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--split", choices=("dev", "holdout", "all"), required=True)
    parser.add_argument("--sampler", required=True)
    parser.add_argument("--system-prompt-en-file", required=True)
    parser.add_argument("--system-prompt-it-file", required=True)
    parser.add_argument("--tools-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--corpus", default=os.path.join(os.path.dirname(__file__), "corpus", "wild.jsonl"))
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    args = parser.parse_args()
    with open(args.sampler, encoding="utf-8") as handle:
        sampler = json.load(handle)
    with open(args.tools_file, encoding="utf-8") as handle:
        tools = json.load(handle)
    args.system_prompt_files = {"en": args.system_prompt_en_file, "it": args.system_prompt_it_file}
    prompts = {}
    for lang, path in args.system_prompt_files.items():
        with open(path, encoding="utf-8") as handle:
            prompts[lang] = handle.read().rstrip("\n")
        if not prompts[lang]:
            raise ValueError(f"system prompt file is empty: {path}")
    cases = load_cases(args.corpus, args.split)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    url = endpoint(args.base_url)
    counts = {"PASS": 0, "FAIL": 0, "RUBRIC": 0, "ERROR": 0}
    requests_ok = 0
    with open(args.out, "w", encoding="utf-8") as output:
        for case in cases:
            result, request_ok = run_case(case, args, sampler, prompts, tools, url)
            output.write(json.dumps(result, ensure_ascii=False) + "\n")
            counts[result["check"]["status"]] += 1
            requests_ok += int(request_ok)
    print(f"wrote={args.out} cases={len(cases)} requests_ok={requests_ok}/{len(cases)}")
    print(f"pass={counts['PASS']} fail={counts['FAIL']} rubric={counts['RUBRIC']} error={counts['ERROR']}")
    print(f"endpoint={url} model={args.model_label} split={args.split}")
    return 0 if requests_ok == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
