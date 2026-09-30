#!/usr/bin/env python3
"""Bits-per-byte over the five multi5 slices, via our llama.cpp build.

Runs llama-perplexity (greedy teacher-forced) per language file, then
converts per-token PPL to bits/byte with the SAME tokenizer the model uses:
bpb = log2(ppl_tok) * n_tokens / n_bytes. This is the F0 meter (which
reported e.g. EN ppl=12.8942 on the community REAP20 model) with the
per-token/per-byte conversion made explicit.

Usage: run_bpb_eval.py --llama <build/bin> --model <gguf> --tokenizer <dir>
                       --corpus <multi5_dir> [--langs en,it,es,fr,zh]
                       [--max-bytes 0]
"""

import argparse
import math
import pathlib
import re
import subprocess
import sys

from transformers import AutoTokenizer

PPL_RE = re.compile(r"final estimate:\s*PPL\s*=\s*([0-9.]+)", re.IGNORECASE)
PPL_RE_FALLBACK = re.compile(r"PPL:\s*([0-9.]+)")


def run_perplexity(binary: str, model: str, text_file: pathlib.Path) -> float:
    out = subprocess.run(
        [binary, "-m", model, "-f", str(text_file), "--no-warmup",
         "-c", "4096", "-b", "4096"],
        capture_output=True, text=True, timeout=3600)
    log = out.stdout + out.stderr
    if out.returncode != 0:
        sys.exit(f"bpb: llama-perplexity rc={out.returncode} on {text_file.name}\n{log[-800:]}")
    hits = PPL_RE.findall(log) or PPL_RE_FALLBACK.findall(log)
    if not hits:
        sys.exit(f"bpb: no PPL in output for {text_file.name}\n{log[-400:]}")
    return float(hits[-1])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llama", required=True, help="llama.cpp build/bin dir")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--langs", default="en,it,es,fr,zh")
    ap.add_argument("--max-bytes", type=int, default=0,
                    help="truncate each file to N bytes (0 = whole file)")
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-perplexity")
    corpus = pathlib.Path(a.corpus)
    tmp = pathlib.Path("/tmp/kalsa-bpb")
    tmp.mkdir(exist_ok=True)

    print("| lang | bytes | tokens | tok/byte | ppl | bpb |")
    print("|---|---:|---:|---:|---:|---:|")
    for lang in a.langs.split(","):
        src = corpus / f"{lang}.txt"
        data = src.read_bytes()
        if a.max_bytes:
            data = data[: a.max_bytes]
        work = tmp / f"{lang}.txt"
        work.write_bytes(data)
        n_bytes = len(data)
        n_tok = len(tok(work.read_text(encoding="utf-8"), add_special_tokens=False)["input_ids"])
        ppl = run_perplexity(binary, a.model, work)
        bpb = math.log2(ppl) * n_tok / n_bytes
        print(f"| {lang} | {n_bytes} | {n_tok} | {n_tok / n_bytes:.4f} | "
              f"{ppl:.4f} | {bpb:.4f} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
