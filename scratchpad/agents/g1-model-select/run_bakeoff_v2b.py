#!/usr/bin/env python3
import argparse
import json
import os
import time

from checks import raw_message_from, raw_text_from
from v2_tools import endpoint
from v2b_tools import complete_with_app_semantics


def prompt_language(lang):
    return "it" if lang == "it" else "en"


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
    parser.add_argument("--ids-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    args = parser.parse_args()
    matrix = json.loads(open(args.matrix, encoding="utf-8").read())
    cell = next(cell for cell in matrix["cells"] if cell["id"] == args.cell)
    questions = json.loads(open(args.questions, encoding="utf-8").read())["questions"]
    tools = json.loads(open(args.tools_file, encoding="utf-8").read())
    ids = {line.strip() for line in open(args.ids_file, encoding="utf-8") if line.strip()}
    prompts = {
        "en": open(args.system_prompt_en_file, encoding="utf-8").read().rstrip("\n"),
        "it": open(args.system_prompt_it_file, encoding="utf-8").read().rstrip("\n"),
    }
    defaults = matrix["defaults"]
    url = endpoint(args.base_url)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    rows = []
    for question in questions:
        for lang in ("en", "it", "es", "fr"):
            if f"{question['id']}|{lang}" not in ids:
                continue
            system_lang = prompt_language(lang)
            messages = [{"role": "system", "content": prompts[system_lang]}, {"role": "user", "content": question["prompts"][lang]}]
            fields = {
                "model": args.model_label, "temperature": defaults["temp"], "top_k": defaults["topK"],
                "top_p": defaults["topP"], "seed": defaults["seed"], "max_tokens": defaults["maxTokens"],
                "thinking_budget_tokens": cell["budget"], "tools": tools, "tool_choice": "auto",
            }
            started = time.perf_counter()
            final, responses, meta = complete_with_app_semantics(url, messages, fields, args.timeout, args.retry_delay)
            message = raw_message_from(final)
            choices = final.get("choices") or []
            finish = choices[0].get("finish_reason") if choices else None
            rows.append({
                "cell": cell["id"], "model": cell["model"], "model_label": args.model_label,
                "quant": "QAD-Q4_0" if cell["model"] == "lfm25-2.6b" else "Q4_K_M",
                "kvK": cell["kvK"], "kvV": cell["kvV"], "budget": cell["budget"],
                "system": prompts[system_lang], "system_lang": system_lang,
                "qid": question["id"], "lang": lang, "prompt": question["prompts"][lang],
                "content": meta["final_text"], "content_raw": raw_text_from(final), "answer": meta["final_text"],
                "reasoning_content": meta["reasoning_text"], "finish": finish,
                "timings": final.get("timings"), "round_timings": meta["round_timings"],
                "prompt_tokens": meta["prompt_tokens"], "completion_tokens": meta["completion_tokens"],
                "wallMs": round((time.perf_counter() - started) * 1000),
                "tool_rounds": meta["tool_rounds"], "tool_names": meta["tool_names"],
                "round_log": meta["round_log"], "round_call_counts": meta["round_call_counts"],
                "final_contains_raw_tool_syntax": meta["final_contains_raw_tool_syntax"],
                "final_empty": meta["final_empty"],
                "tool_calls": message.get("tool_calls") or [], "raw_response": final,
                "round_responses": responses, "v2b_reason": "selected from v2: finish_reason=tool_calls or empty content",
                "tools_file": os.path.abspath(args.tools_file),
                **({"error": meta["error"]} if meta["error"] else {}),
            })
    with open(args.out, "w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    errors = sum(1 for row in rows if row.get("error"))
    print(f"wrote={args.out} cell={args.cell} selected={len(rows)} errors={errors}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
