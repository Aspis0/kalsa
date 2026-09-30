#!/usr/bin/env python3
"""Greedy generation scorer for the eval gate, via our llama.cpp build.

Runs on the Mac (or any box with a llama.cpp build) against any GGUF.
Rendering uses the model's own tokenizer chat template; scoring is
format-fair and prompt-blind:
  gsm8k  — last number of the reply (after think-strip) equals answer_number
  tools  — a tool call (either the Qwen or the LFM dialect, eval/toolcalls.py)
           whose name matches and whose args are a superset of the expected

Fixed conditions for every model (2026-09-30 review):
  thinking OFF (enable_thinking=False) — LFM2.5's template has no thinking
    switch, so enabling it anywhere would compare different settings; the
    gate measures the one-pass assistant. Any reasoning section a model
    emits anyway is stripped before matching, in BOTH dialects: Qwen's
    <think>...</think> and LFM QAD's "[Start thinking] ... [End thinking]"
    plain-text markers (that model never emits </think>). An unclosed
    <think> with no bracket closer (budget exhausted mid-reasoning) is a
    miss.
  --no-display-prompt on the CLI path — and even so, this fork's llama-cli
    ECHOES the -f prompt in conversation mode (verified 2026-09-30), so the
    probe runs against llama-server (/completion returns clean JSON with no
    echo, one model load for the whole holdout). The CLI path stays for
    single-artifact checks.
  --single-turn, no tty — llama-cli otherwise stays interactive and hangs.
  Per-item pass/fail is written to --out for paired bootstrap CIs
    (eval/bootstrap_ci.py).

Usage: run_gen_eval.py --dataset gsm8k|tools --holdout <jsonl> --llama <bin>
                       --model <gguf> --tokenizer <dir> [--limit N]
                       [--server URL] --out results.json
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request

from transformers import AutoTokenizer

from toolcalls import parse_tool_calls

NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)
LFM_END_THINKING = "[End thinking]"


def generate(binary: str, model: str, prompt: str, n: int) -> str:
    # -f (raw file): conversation-mode llama-cli would re-template a -p prompt;
    # the prompt here is already rendered by the model's own chat template.
    # The prompt file is pid-tagged: two runners must not share it.
    tmp = pathlib.Path(f"/tmp/kalsa-gen-prompt-{os.getpid()}.txt")
    tmp.write_text(prompt, encoding="utf-8")
    out = subprocess.run(
        [binary, "-m", model, "-f", str(tmp), "-n", str(n), "--temp", "0",
         "--no-warmup", "-c", "4096", "--single-turn", "--simple-io",
         "--no-display-prompt"],
        stdin=subprocess.DEVNULL,
        capture_output=True, text=True, timeout=3600)
    if out.returncode != 0:
        return ""
    reply = out.stdout
    for marker in ("[ Prompt:", "Prompt:", "llama_perf", "total time", "Exiting"):
        reply = reply.split(marker)[0]
    return reply


def generate_server(server: str, prompt: str, n: int, timeout: int = 1200) -> str:
    body = json.dumps({"prompt": prompt, "n_predict": n, "temperature": 0.0,
                       "cache_prompt": False}).encode()
    req = urllib.request.Request(
        f"{server}/completion", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r).get("content", "")


def strip_reasoning(reply: str) -> str:
    """Remove the model's reasoning section, whichever dialect it speaks."""
    if LFM_END_THINKING in reply:
        return reply.rsplit(LFM_END_THINKING, 1)[1]   # the answer side
    return THINK_RE.sub("", reply)


def score_text(reply: str, item: dict) -> bool:
    if LFM_END_THINKING not in reply and UNCLOSED_THINK_RE.search(reply):
        return False  # ran out of budget inside reasoning; no answer emitted
    nums = NUMBER_RE.findall(strip_reasoning(reply).replace(",", ""))
    return bool(nums) and nums[-1] == item["answer_number"].replace(",", "")


def score_tools(reply: str, item: dict) -> bool:
    expect = item["expect"]
    want_name = expect.get("name")
    want_args = expect.get("arguments") if isinstance(expect.get("arguments"), dict) else {}
    for name, args in parse_tool_calls(strip_reasoning(reply)):
        if name != want_name:
            continue
        if all(str(args.get(k)) == str(v) for k, v in want_args.items()):
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["gsm8k", "tools"], required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--llama", help="llama.cpp build/bin dir (CLI path)")
    ap.add_argument("--server", help="llama-server base URL (probe path)")
    ap.add_argument("--model")
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", required=True, help="per-item JSON for bootstrap CIs")
    a = ap.parse_args()
    if not a.server and not (a.llama and a.model):
        ap.error("need --server, or --llama + --model")

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    items = [json.loads(l) for l in open(a.holdout)]
    if a.limit:
        items = items[: a.limit]

    def gen(prompt: str) -> str:
        if a.server:
            return generate_server(a.server, prompt, 1024)
        binary = str(pathlib.Path(a.llama) / "llama-cli")
        return generate(binary, a.model, prompt, 1024)

    results = []
    for i, item in enumerate(items):
        if a.dataset == "gsm8k":
            prompt = tok.apply_chat_template(
                [{"role": "user", "content": item["question"]}],
                add_generation_prompt=True, tokenize=False,
                enable_thinking=False)
            hit = score_text(gen(prompt), item)
        else:
            prompt = tok.apply_chat_template(
                item["prompt_messages"], add_generation_prompt=True,
                tokenize=False, enable_thinking=False)
            hit = score_tools(gen(prompt), item)
        results.append({"id": item["id"], "pass": int(hit)})
        print(f"[{i + 1}/{len(items)}] {item['id']} -> {'PASS' if hit else 'FAIL'}",
              flush=True)

    ok = sum(r["pass"] for r in results)
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": a.dataset, "model": a.model or a.server, "n": len(results),
        "ok": ok, "items": results}, indent=1))
    print(f"\n{a.dataset}: {ok}/{len(results)} = {ok / max(1, len(results)):.3f}"
          f" (per-item -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
