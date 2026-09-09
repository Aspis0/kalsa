#!/usr/bin/env python3
import argparse
import json
import os
import time

from checks import raw_message_from, raw_text_from, strip_reasoning
from v2_tools import complete_with_tools, endpoint


def prompt_language(lang):
    return "it" if lang == "it" else "en"


def load_prompts(args):
    prompts = {}
    for lang, path in {"en": args.system_prompt_en_file, "it": args.system_prompt_it_file}.items():
        with open(path, encoding="utf-8") as handle:
            prompts[lang] = handle.read().rstrip("\n")
    return prompts


def row_for(question, lang, cell, matrix, prompts, tools, args, url):
    system_lang = prompt_language(lang)
    messages = [
        {"role": "system", "content": prompts[system_lang]},
        {"role": "user", "content": question["prompts"][lang]},
    ]
    defaults = matrix["defaults"]
    request_fields = {
        "model": args.model_label,
        "temperature": defaults["temp"],
        "top_k": defaults["topK"],
        "top_p": defaults["topP"],
        "seed": defaults["seed"],
        "max_tokens": defaults["maxTokens"],
        "thinking_budget_tokens": cell["budget"],
        "tools": tools,
        "tool_choice": "auto",
    }
    started = time.perf_counter()
    final, responses, meta = complete_with_tools(
        url, messages, request_fields, args.timeout, args.retry_delay
    )
    message = raw_message_from(final)
    content = raw_text_from(final)
    choices = final.get("choices") or []
    finish = choices[0].get("finish_reason") if choices else None
    row = {
        "cell": cell["id"],
        "model": cell["model"],
        "model_label": args.model_label,
        "quant": "QAD-Q4_0" if cell["model"] == "lfm25-2.6b" else "Q4_K_M",
        "kvK": cell["kvK"],
        "kvV": cell["kvV"],
        "budget": cell["budget"],
        "system": prompts[system_lang],
        "system_lang": system_lang,
        "qid": question["id"],
        "lang": lang,
        "prompt": question["prompts"][lang],
        "content": content,
        "answer": strip_reasoning(content),
        "reasoning_content": meta["reasoning_text"],
        "finish": finish or ("error" if meta["error"] else None),
        "timings": final.get("timings"),
        "round_timings": meta["round_timings"],
        "prompt_tokens": meta["prompt_tokens"],
        "completion_tokens": meta["completion_tokens"],
        "wallMs": round((time.perf_counter() - started) * 1000),
        "tool_rounds": meta["tool_rounds"],
        "tool_names": meta["tool_names"],
        "final_contains_raw_tool_syntax": meta["final_contains_raw_tool_syntax"],
        "tool_calls": (message.get("tool_calls") or []),
        "raw_response": final,
        "round_responses": responses,
        "tools_file": os.path.abspath(args.tools_file),
    }
    if meta["error"]:
        row["error"] = meta["error"]
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--cell", required=True)
    parser.add_argument("--matrix", required=True)
    parser.add_argument("--questions", required=True)
    parser.add_argument("--tools-file", required=True)
    parser.add_argument("--system-prompt-en-file", required=True)
    parser.add_argument("--system-prompt-it-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    args = parser.parse_args()
    with open(args.matrix, encoding="utf-8") as handle:
        matrix = json.load(handle)
    cell = next(cell for cell in matrix["cells"] if cell["id"] == args.cell)
    with open(args.questions, encoding="utf-8") as handle:
        questions = json.load(handle)["questions"]
    with open(args.tools_file, encoding="utf-8") as handle:
        tools = json.load(handle)
    prompts = load_prompts(args)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    url = endpoint(args.base_url)
    rows = []
    for question in questions:
        for lang in ("en", "it", "es", "fr"):
            rows.append(row_for(question, lang, cell, matrix, prompts, tools, args, url))
    with open(args.out, "w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    errors = sum(1 for row in rows if row.get("error"))
    print(f"wrote={args.out} cell={args.cell} rows={len(rows)} errors={errors}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
