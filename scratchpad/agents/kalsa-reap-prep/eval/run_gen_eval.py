#!/usr/bin/env python3
"""Greedy generation scorer for the FASE-C holdouts, via our llama.cpp build.

Works on the Mac (or any box with a llama.cpp build) against any GGUF —
LFM2.5-2.6B Q4_0 today, Kalsa REAP quants later. Rendering uses the model's
own tokenizer chat template; matching is strict:
  gsm8k  — the last number in the reply equals answer_number
  tools  — reply contains a <tool_call> JSON whose name matches and whose
           arguments are a superset of the expected arguments

Usage: run_gen_eval.py --dataset gsm8k|tools --holdout <jsonl> --llama <bin>
                       --model <gguf> --tokenizer <dir> [--limit N]
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

from transformers import AutoTokenizer

TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)
NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def generate(binary: str, model: str, prompt: str, n: int) -> str:
    # -f (raw file): conversation-mode llama-cli would re-template a -p prompt;
    # the prompt here is already rendered by the model's own chat template.
    # --single-turn: this fork's llama-cli stays interactive after a -p/-f
    # turn otherwise (first smoke hung in interactive mode for 19 CPU-min).
    tmp = pathlib.Path("/tmp/kalsa-gen-prompt.txt")
    tmp.write_text(prompt, encoding="utf-8")
    out = subprocess.run(
        [binary, "-m", model, "-f", str(tmp), "-n", str(n), "--temp", "0",
         "--no-warmup", "-c", "4096", "--single-turn", "--simple-io"],
        capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        return ""
    reply = out.stdout
    for marker in ("[ Prompt:", "Prompt:", "llama_perf", "total time", "Exiting"):
        reply = reply.split(marker)[0]
    return reply


def score_gsm8k(reply: str, item: dict) -> bool:
    nums = NUMBER_RE.findall(reply.replace(",", ""))
    return bool(nums) and nums[-1] == item["answer_number"].replace(",", "")


def score_tools(reply: str, item: dict) -> bool:
    expect = item["expect"]
    want_name = expect.get("name")
    want_args = expect.get("arguments") if isinstance(expect.get("arguments"), dict) else {}
    for m in TOOL_CALL_RE.finditer(reply):
        try:
            call = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if call.get("name") != want_name:
            continue
        args = call.get("arguments")
        if not isinstance(args, dict):
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
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-cli")
    items = [json.loads(l) for l in open(a.holdout)]
    if a.limit:
        items = items[: a.limit]

    ok = 0
    for i, item in enumerate(items):
        if a.dataset == "gsm8k":
            prompt = tok.apply_chat_template(
                [{"role": "user", "content": item["question"]}],
                add_generation_prompt=True, tokenize=False,
                enable_thinking=False)
            reply = generate(binary, a.model, prompt, 1024)
            hit = score_gsm8k(reply, item)
        else:
            prompt = tok.apply_chat_template(
                item["prompt_messages"], add_generation_prompt=True, tokenize=False)
            reply = generate(binary, a.model, prompt, 1024)
            hit = score_tools(reply, item)
        ok += hit
        print(f"[{i + 1}/{len(items)}] {item['id']} -> {'PASS' if hit else 'FAIL'}")
    print(f"\n{a.dataset}: {ok}/{len(items)} = {ok / max(1, len(items)):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
