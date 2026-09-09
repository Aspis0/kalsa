#!/usr/bin/env python3
import argparse
import json
import os
import socket
import time
from http.client import RemoteDisconnected
from urllib.error import URLError
from urllib.request import Request, urlopen

from checks import (check_response, reasoning_from, raw_text_from, strip_reasoning,
                    text_from, token_counts, tool_call_mode, tool_calls_from)


def load_cases(path, split, limit):
    cases = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            case = json.loads(line)
            if split == "all" or case["split"] == split:
                cases.append(case)
            if limit and len(cases) >= limit:
                break
    return cases


def endpoint(base_url):
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def prompt_language(lang):
    return "it" if lang == "it" else "en"


def post_json(url, payload, timeout):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


REQUEST_ERRORS = (ConnectionResetError, RemoteDisconnected, URLError, TimeoutError, socket.timeout, ValueError)


def request_with_retry(url, payload, timeout, retry_delay):
    for attempt in range(2):
        try:
            return post_json(url, payload, timeout), None
        except REQUEST_ERRORS as error:
            if attempt == 0:
                time.sleep(retry_delay)
            else:
                return {}, str(error)
    return {}, "request failed"


def sampler_payload(sampler):
    required = ("temperature", "top_p", "max_tokens")
    missing = [key for key in required if key not in sampler]
    if missing:
        raise ValueError("sampler missing: " + ", ".join(missing))
    if "reasoning_budget" in sampler:
        raise ValueError("use thinking_budget_tokens, not reasoning_budget")
    return dict(sampler)


def run_case(case, args, sampler, prompts, url):
    system_lang = prompt_language(case["lang"])
    messages = [{"role": "system", "content": prompts[system_lang]}, *case["turns"]]
    payload = {"model": args.model_label, "messages": messages}
    payload.update(sampler)
    if case.get("tools"):
        payload["tools"] = case["tools"]
    started = time.perf_counter()
    response, error = request_with_retry(url, payload, args.timeout, args.retry_delay)
    elapsed = time.perf_counter() - started
    prompt_tokens, completion_tokens = token_counts(response)
    result = {
        "id": case["id"],
        "model_label": args.model_label,
        "lang": case["lang"],
        "category": case["category"],
        "split": case["split"],
        "system_lang": system_lang,
        "raw_response": response,
        "assistant_text_raw": raw_text_from(response),
        "assistant_text": text_from(response),
        "reasoning_text": reasoning_from(response),
        "tool_call_mode": tool_call_mode(response),
        "tool_calls": tool_calls_from(response),
        "elapsed_seconds": round(elapsed, 6),
        "timings": response.get("timings"),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "endpoint": url,
        "sampler_file": os.path.abspath(args.sampler),
        "thinking_budget_tokens": sampler.get("thinking_budget_tokens"),
        "chat_template_kwargs": sampler.get("chat_template_kwargs"),
        "system_prompt_file": os.path.abspath(args.system_prompt_files[system_lang]),
    }
    if error:
        result["check"] = {"status": "ERROR", "detail": error}
        return result, False
    result["check"] = check_response(case, response)
    return result, True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--split", choices=("dev", "holdout", "all"), required=True)
    parser.add_argument("--sampler", required=True)
    parser.add_argument("--system-prompt-en-file", required=True)
    parser.add_argument("--system-prompt-it-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--corpus", default=os.path.join(os.path.dirname(__file__), "corpus", "cases.jsonl"))
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--retry-delay", type=float, default=5)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--ids-file")
    args = parser.parse_args()
    with open(args.sampler, encoding="utf-8") as handle:
        sampler = sampler_payload(json.load(handle))
    args.system_prompt_files = {"en": args.system_prompt_en_file, "it": args.system_prompt_it_file}
    prompts = {}
    for lang, path in args.system_prompt_files.items():
        with open(path, encoding="utf-8") as handle:
            prompts[lang] = handle.read().rstrip("\n")
        if not prompts[lang]:
            raise ValueError(f"system prompt file is empty: {path}")
    selected_ids = None
    if args.ids_file:
        with open(args.ids_file, encoding="utf-8") as handle:
            selected_ids = {line.strip() for line in handle if line.strip()}
    cases = load_cases(args.corpus, args.split, args.limit)
    if selected_ids is not None:
        cases = [case for case in cases if case["id"] in selected_ids]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    url = endpoint(args.base_url)
    ok = 0
    counts = {"PASS": 0, "FAIL": 0, "RUBRIC": 0, "ERROR": 0}
    with open(args.out, "w", encoding="utf-8") as output:
        for case in cases:
            result, request_ok = run_case(case, args, sampler, prompts, url)
            output.write(json.dumps(result, ensure_ascii=False) + "\n")
            status = result["check"]["status"]
            counts[status] += 1
            ok += int(request_ok)
    print(f"wrote={args.out} cases={len(cases)} requests_ok={ok}/{len(cases)}")
    print(f"pass={counts['PASS']} fail={counts['FAIL']} rubric={counts['RUBRIC']} error={counts['ERROR']}")
    print(f"endpoint={url} model={args.model_label} split={args.split}")
    return 0 if ok == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
