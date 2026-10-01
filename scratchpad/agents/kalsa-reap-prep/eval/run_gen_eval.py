#!/usr/bin/env python3
"""Generation scorer for the eval gate, via our llama.cpp server (or CLI).

Runs on the Mac or the Runpod probe against any GGUF. Probe mode is
`--server`: POST /v1/chat/completions so the SERVER applies the model's own
chat template and tokenizes once (single BOS; the raw-prompt path doubled
it — the fork warns at llama-vocab.cpp "final prompt starts with 2 BOS
tokens"). The CLI path stays for single-artifact checks locally.

Product-parity conditions (owner + Fable-2/3 reviews, 2026-09-30):
  thinking ON for every model — the product runs thinking on. The Qwen
    template takes enable_thinking=true via chat_template_kwargs; LFM's own
    template unconditionally ends "<|im_start|>assistant\\n<think>" (read
    from the ship GGUF), so it reasons regardless and the flag is a no-op
    there. Only the <think>...</think> dialect is stripped before matching
    (that is what the templates actually emit); an UNCLOSED <think> at the
    token cap is a miss, and the truncation rate is reported per arm.
  tools requests carry the `tools` field (extracted from the holdout's
    system message), so the server renders EACH model's native tool format
    and returns structured message.tool_calls — scored first, with content
    parsing as fallback. No model is asked to imitate another's dialect.
  n_predict >= 4096 (default here); raw output + finish_reason stored per
    item in --out for auditing and the truncation report.
  tools match on canonicalised JSON (order-insensitive, type-lenient
    scalars): eval/toolcalls.py args_match — never str(args).

Usage: run_gen_eval.py --dataset gsm8k|gsm8kit|tools --holdout <jsonl> --out r.json
                       (--server URL [--max-tokens 4096] |
                        --llama <bin dir> --model <gguf> --tokenizer <dir>)
                       [--limit N]

gsm8kit shares the gsm8k scorer (last-number exact match); the holdout is
Italian (eval/gsm8kit-100.jsonl, Eurolingua/gsm8kx, MIT). The A40 probe cut
reasoning models at 4096 tokens (REPORT.md reading 3), so the gate passes
--max-tokens 8192 for the math datasets.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request

from toolcalls import args_match, parse_tool_calls

NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)
TOOLS_ARRAY_RE = re.compile(r"\[.*\]", re.S)


def chat_completion(server: str, messages: list, max_tokens: int,
                    tools: list | None = None, timeout: int = 1800) -> dict:
    body = {"messages": messages, "temperature": 0.0,
            "max_tokens": max_tokens, "stream": False,
            # the product runs thinking on; LFM's template ignores the kwarg
            "chat_template_kwargs": {"enable_thinking": True}}
    if tools:
        body["tools"] = tools
    req = urllib.request.Request(
        f"{server}/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        msg = json.load(r)["choices"][0]
    out = msg.get("message", {})
    return {"content": out.get("content", "") or "",
            "tool_calls": out.get("tool_calls", []) or [],
            "finish_reason": msg.get("finish_reason", "")}


def generate(binary: str, model: str, prompt: str, n: int) -> dict:
    # CLI fallback: prompt pre-rendered by the model's template (thinking on).
    # pid-tagged temp file: two runners must not share one.
    tmp = pathlib.Path(f"/tmp/kalsa-gen-prompt-{os.getpid()}.txt")
    tmp.write_text(prompt, encoding="utf-8")
    out = subprocess.run(
        [binary, "-m", model, "-f", str(tmp), "-n", str(n), "--temp", "0",
         "--no-warmup", "-c", str(n + 2048), "--single-turn", "--simple-io",
         "--no-display-prompt"],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=3600)
    if out.returncode != 0:
        return {"content": "", "tool_calls": [], "finish_reason": "error"}
    reply = out.stdout
    for marker in ("[ Prompt:", "Prompt:", "llama_perf", "total time", "Exiting"):
        reply = reply.split(marker)[0]
    # a length-capped CLI run is undetectable; treat any unclosed <think> as such
    return {"content": reply, "tool_calls": [],
            "finish_reason": "length" if UNCLOSED_THINK_RE.search(reply) else "stop"}


def strip_reasoning(reply: str) -> str:
    return THINK_RE.sub("", reply)


def score_text(reply: str, item: dict) -> bool:
    if UNCLOSED_THINK_RE.search(reply):
        return False  # still inside reasoning at the token cap; no answer
    nums = NUMBER_RE.findall(strip_reasoning(reply).replace(",", ""))
    return bool(nums) and nums[-1] == item["answer_number"].replace(",", "")


def calls_from(tool_calls: list, content: str) -> list[tuple[str, dict]]:
    """Structured tool_calls first, then any calls the model put in content."""
    out = []
    for tc in tool_calls:
        fn = tc.get("function", {})
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = None
        out.append((fn.get("name"), args if isinstance(args, dict) else {}))
    out.extend(parse_tool_calls(strip_reasoning(content)))
    return out


def score_tools(tool_calls: list, content: str, item: dict) -> bool:
    expect = item["expect"]
    want_name = expect.get("name")
    want_args = expect.get("arguments") if isinstance(expect.get("arguments"), dict) else {}
    for name, args in calls_from(tool_calls, content):
        if name == want_name and args_match(args, want_args):
            return True
    return False


def extract_tools(item: dict) -> list | None:
    """The holdout embeds the tool schemas as a JSON array inside the system
    message; the request needs them as a structured field so each model gets
    its own native rendering (Fable-3 §3)."""
    for m in item.get("prompt_messages", []):
        if m.get("role") == "system":
            match = TOOLS_ARRAY_RE.search(m.get("content", ""))
            if match:
                try:
                    parsed = json.loads(match.group(0))
                except json.JSONDecodeError:
                    continue
                if parsed and "function" in parsed[0]:
                    return parsed
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["gsm8k", "gsm8kit", "tools"], required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--server", help="llama-server base URL (probe path)")
    ap.add_argument("--llama", help="llama.cpp build/bin dir (CLI path)")
    ap.add_argument("--model", help="GGUF for the CLI path")
    ap.add_argument("--tokenizer", help="tokenizer dir for the CLI path")
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", required=True, help="per-item JSON incl. raw outputs")
    a = ap.parse_args()
    if not a.server and not (a.llama and a.model and a.tokenizer):
        ap.error("need --server, or --llama + --model + --tokenizer")

    def gen(messages: list, tools: list | None = None) -> dict:
        if a.server:
            return chat_completion(a.server, messages, a.max_tokens, tools)
        from transformers import AutoTokenizer  # CLI path only; server needs no torch stack
        prompt = AutoTokenizer.from_pretrained(a.tokenizer).apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False,
            enable_thinking=True)
        return generate(a.llama, a.model, prompt, a.max_tokens)

    items = [json.loads(l) for l in open(a.holdout)]
    if a.limit:
        items = items[: a.limit]

    results = []
    for i, item in enumerate(items):
        if a.dataset in ("gsm8k", "gsm8kit"):
            r = gen([{"role": "user", "content": item["question"]}])
            hit = score_text(r["content"], item)
        else:
            r = gen(item["prompt_messages"], extract_tools(item))
            hit = score_tools(r["tool_calls"], r["content"], item)
        results.append({"id": item["id"], "pass": int(hit),
                        "finish_reason": r["finish_reason"], "raw": r["content"]})
        print(f"[{i + 1}/{len(items)}] {item['id']} -> "
              f"{'PASS' if hit else 'FAIL'} ({r['finish_reason']})", flush=True)

    ok = sum(r["pass"] for r in results)
    truncated = sum(1 for r in results if r["finish_reason"] == "length")
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": a.dataset, "model": a.model or a.server,
        "max_tokens": a.max_tokens, "n": len(results), "ok": ok,
        "truncated": truncated, "items": results}, indent=1))
    print(f"\n{a.dataset}: {ok}/{len(results)} = {ok / max(1, len(results)):.3f}"
          f", hit the {a.max_tokens}-token cap on {truncated}/{len(results)}"
          f" (raw outputs -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
