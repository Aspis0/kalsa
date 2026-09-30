#!/usr/bin/env python3
"""Generation scorer for the eval gate, via our llama.cpp server (or CLI).

Runs on the Mac or the Runpod probe against any GGUF. Probe mode is
`--server`: POST /v1/chat/completions so the SERVER applies the model's own
chat template and tokenizes once — the probe's raw-prompt path caused a
double BOS (the server prepends BOS to text that already starts with the
BOS special token; the fork warns "final prompt starts with 2 BOS tokens",
llama-vocab.cpp). The CLI path stays for single-artifact checks locally.

Product-parity conditions (owner + Fable-2 review, 2026-09-30):
  thinking ON for every model — the product runs thinking on. The Qwen
    template takes enable_thinking=true via chat_template_kwargs; LFM's
    template always opens a think block, so it reasons regardless and the
    flag is simply ignored there. Either reasoning dialect is stripped
    before matching: Qwen's <think>...</think> and LFM QAD's
    "[Start thinking] ... [End thinking]".
  n_predict >= 4096 (default here) — at 1024, 3 of 4 regenerated LFM GSM8K
    items hit the cap mid-reasoning and scored as misses.
  raw model output (content) is stored per item in --out for auditing.
  tools match on canonicalised JSON (order-insensitive, type-lenient
    scalars): eval/toolcalls.py args_match — not str(args).

Usage: run_gen_eval.py --dataset gsm8k|tools --holdout <jsonl> --out r.json
                       (--server URL [--max-tokens 4096] |
                        --llama <bin dir> --model <gguf> --tokenizer <dir>)
                       [--limit N]
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
from transformers import AutoTokenizer

NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)
LFM_END_THINKING = "[End thinking]"


def chat_completion(server: str, messages: list, max_tokens: int,
                    timeout: int = 1800) -> str:
    body = json.dumps({
        "messages": messages, "temperature": 0.0,
        "max_tokens": max_tokens, "stream": False,
        # the product runs thinking on; LFM's template ignores the kwarg
        "chat_template_kwargs": {"enable_thinking": True},
    }).encode()
    req = urllib.request.Request(
        f"{server}/v1/chat/completions", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    return data["choices"][0]["message"].get("content", "") or ""


def generate(binary: str, model: str, prompt: str, n: int) -> str:
    # CLI fallback: prompt pre-rendered by the model's template (thinking on).
    # pid-tagged temp file: two runners must not share one.
    tmp = pathlib.Path(f"/tmp/kalsa-gen-prompt-{os.getpid()}.txt")
    tmp.write_text(prompt, encoding="utf-8")
    out = subprocess.run(
        [binary, "-m", model, "-f", str(tmp), "-n", str(n), "--temp", "0",
         "--no-warmup", "-c", "8192", "--single-turn", "--simple-io",
         "--no-display-prompt"],
        stdin=subprocess.DEVNULL,
        capture_output=True, text=True, timeout=3600)
    if out.returncode != 0:
        return ""
    reply = out.stdout
    for marker in ("[ Prompt:", "Prompt:", "llama_perf", "total time", "Exiting"):
        reply = reply.split(marker)[0]
    return reply


def strip_reasoning(reply: str) -> str:
    """Remove the model's reasoning section, whichever dialect it speaks."""
    if LFM_END_THINKING in reply:
        return reply.rsplit(LFM_END_THINKING, 1)[1]   # the answer side
    return THINK_RE.sub("", reply)


def score_text(reply: str, item: dict) -> bool:
    if LFM_END_THINKING not in reply and UNCLOSED_THINK_RE.search(reply):
        return False  # still inside reasoning at the token cap; no answer
    nums = NUMBER_RE.findall(strip_reasoning(reply).replace(",", ""))
    return bool(nums) and nums[-1] == item["answer_number"].replace(",", "")


def score_tools(reply: str, item: dict) -> bool:
    expect = item["expect"]
    want_name = expect.get("name")
    want_args = expect.get("arguments") if isinstance(expect.get("arguments"), dict) else {}
    for name, args in parse_tool_calls(strip_reasoning(reply)):
        if name == want_name and args_match(args, want_args):
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["gsm8k", "tools"], required=True)
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

    def gen(messages: list) -> str:
        if a.server:
            return chat_completion(a.server, messages, a.max_tokens)
        prompt = AutoTokenizer.from_pretrained(a.tokenizer).apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False,
            enable_thinking=True)
        return generate(a.llama, a.model, prompt, a.max_tokens)

    items = [json.loads(l) for l in open(a.holdout)]
    if a.limit:
        items = items[: a.limit]

    results = []
    for i, item in enumerate(items):
        if a.dataset == "gsm8k":
            raw = gen([{"role": "user", "content": item["question"]}])
            hit = score_text(raw, item)
        else:
            raw = gen(item["prompt_messages"])
            hit = score_tools(raw, item, args_match)
        results.append({"id": item["id"], "pass": int(hit), "raw": raw})
        print(f"[{i + 1}/{len(items)}] {item['id']} -> {'PASS' if hit else 'FAIL'}",
              flush=True)

    ok = sum(r["pass"] for r in results)
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": a.dataset, "model": a.model or a.server,
        "max_tokens": a.max_tokens, "n": len(results), "ok": ok,
        "items": results}, indent=1))
    print(f"\n{a.dataset}: {ok}/{len(results)} = {ok / max(1, len(results)):.3f}"
          f" (raw outputs -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
