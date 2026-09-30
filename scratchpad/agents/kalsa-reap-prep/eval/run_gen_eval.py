#!/usr/bin/env python3
"""Greedy generation scorer for the eval gate, via our llama.cpp build.

Runs on the Mac (or any box with a llama.cpp build) against any GGUF —
LFM2.5-2.6B today, Kalsa REAP quants later. Rendering uses the model's own
tokenizer chat template; scoring is format-fair and prompt-blind:
  gsm8k  — last number of the reply (after think-strip) equals answer_number
  tools  — a tool call (either the Qwen or the LFM dialect, eval/toolcalls.py)
           whose name matches and whose args are a superset of the expected

Fixed conditions for every model (2026-09-30 review):
  thinking OFF (enable_thinking=False) — LFM2.5's template has no thinking
    switch, so enabling it anywhere would compare different settings; the
    gate measures the one-pass assistant, and any think block a model emits
    anyway is stripped before matching.
  --no-display-prompt — the echoed prompt contains digits (GSM8K questions),
    so a scorer reading plain stdout could "pass" without any generation.
  --single-turn, no tty — llama-cli otherwise stays interactive and hangs.
  Per-item pass/fail is written to --out for paired bootstrap CIs
    (eval/bootstrap_ci.py).

Usage: run_gen_eval.py --dataset gsm8k|tools --holdout <jsonl> --llama <bin>
                       --model <gguf> --tokenizer <dir> [--limit N]
                       --out results.json
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

from transformers import AutoTokenizer

from toolcalls import parse_tool_calls

NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
UNCLOSED_THINK_RE = re.compile(r"<think>(?!.*?</think>)", re.S)


def generate(binary: str, model: str, prompt: str, n: int) -> str:
    # -f (raw file): conversation-mode llama-cli would re-template a -p prompt;
    # the prompt here is already rendered by the model's own chat template.
    tmp = pathlib.Path("/tmp/kalsa-gen-prompt.txt")
    tmp.write_text(prompt, encoding="utf-8")
    out = subprocess.run(
        [binary, "-m", model, "-f", str(tmp), "-n", str(n), "--temp", "0",
         "--no-warmup", "-c", "4096", "--single-turn", "--simple-io",
         "--no-display-prompt"],
        stdin=subprocess.DEVNULL,
        capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        return ""
    reply = out.stdout
    for marker in ("[ Prompt:", "Prompt:", "llama_perf", "total time", "Exiting"):
        reply = reply.split(marker)[0]
    return reply


def score_text(reply: str, item: dict) -> bool:
    """Think-strip, then last-number match."""
    if UNCLOSED_THINK_RE.search(reply):
        return False  # ran out of budget inside reasoning; no answer emitted
    nums = NUMBER_RE.findall(THINK_RE.sub("", reply).replace(",", ""))
    return bool(nums) and nums[-1] == item["answer_number"].replace(",", "")


def score_tools(reply: str, item: dict) -> bool:
    expect = item["expect"]
    want_name = expect.get("name")
    want_args = expect.get("arguments") if isinstance(expect.get("arguments"), dict) else {}
    for name, args in parse_tool_calls(THINK_RE.sub("", reply)):
        if name != want_name:
            continue
        if all(str(args.get(k)) == str(v) for k, v in want_args.items()):
            return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["gsm8k", "tools"], required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--llama", required=True, help="llama.cpp build/bin dir")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", required=True, help="per-item JSON for bootstrap CIs")
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-cli")
    items = [json.loads(l) for l in open(a.holdout)]
    if a.limit:
        items = items[: a.limit]

    results = []
    for i, item in enumerate(items):
        if a.dataset == "gsm8k":
            prompt = tok.apply_chat_template(
                [{"role": "user", "content": item["question"]}],
                add_generation_prompt=True, tokenize=False,
                enable_thinking=False)
            hit = score_text(generate(binary, a.model, prompt, 1024), item)
        else:
            prompt = tok.apply_chat_template(
                item["prompt_messages"], add_generation_prompt=True,
                tokenize=False, enable_thinking=False)
            hit = score_tools(generate(binary, a.model, prompt, 1024), item)
        results.append({"id": item["id"], "pass": int(hit)})
        print(f"[{i + 1}/{len(items)}] {item['id']} -> {'PASS' if hit else 'FAIL'}",
              flush=True)

    ok = sum(r["pass"] for r in results)
    pathlib.Path(a.out).write_text(json.dumps({
        "dataset": a.dataset, "model": a.model, "n": len(results),
        "ok": ok, "items": results}, indent=1))
    print(f"\n{a.dataset}: {ok}/{len(results)} = {ok / max(1, len(results)):.3f}"
          f" (per-item -> {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
