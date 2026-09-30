#!/usr/bin/env python3
"""Bits-per-byte over the gate's held-out text, via our llama.cpp build.

Each language file is split into contiguous byte segments (default 8);
llama-perplexity runs per segment and bpb = log2(ppl) * n_tokens / n_bytes
with the model's own tokenizer. The overall bpb is the byte-weighted mean of
the segment bpbs, which is exactly the whole-file value because pooled
nats/ln2 add across segments. Per-segment values go to --out as JSON, giving
run_gen_eval-style units for the paired bootstrap CIs in bootstrap_ci.py.

Usage: run_bpb_eval.py --llama <build/bin> --model <gguf> --tokenizer <dir>
                       --corpus <corpus_dir> --out bpb.json
                       [--langs en,it,es,fr,zh] [--segments 8]
"""

import argparse
import json
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
        capture_output=True, text=True, timeout=7200)
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
    ap.add_argument("--out", required=True, help="per-segment JSON for CIs")
    ap.add_argument("--langs", default="en,it,es,fr,zh")
    ap.add_argument("--segments", type=int, default=8)
    ap.add_argument("--max-bytes", type=int, default=600_000,
                    help="evaluate the leading N bytes per language (the "
                         "corpus files are longer; 600 KB >= the 500 KB gate "
                         "floor and keeps the big-model runs tractable)")
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-perplexity")
    corpus = pathlib.Path(a.corpus)
    tmp = pathlib.Path("/tmp/kalsa-bpb")
    tmp.mkdir(exist_ok=True)
    report = {}

    for lang in a.langs.split(","):
        data = (corpus / f"{lang}.txt").read_bytes()[: a.max_bytes]
        edge = len(data) // a.segments
        segs = [data[i * edge:(i + 1) * edge] for i in range(a.segments - 1)]
        segs.append(data[(a.segments - 1) * edge:])   # last one absorbs the remainder
        # a raw byte slice can cut a UTF-8 sequence in half; drop the broken
        # edge bytes (<=3 per boundary) and count only what is evaluated
        segs = [s.decode("utf-8", errors="ignore").encode("utf-8") for s in segs]

        seg_bpbs, tot_bytes, tot_wsum = [], 0, 0.0
        for i, seg in enumerate(segs):
            work = tmp / f"{lang}-{i}.txt"
            work.write_bytes(seg)
            n_bytes = len(seg)
            n_tok = len(tok(seg.decode("utf-8"), add_special_tokens=False)["input_ids"])
            ppl = run_perplexity(binary, a.model, work)
            bpb = math.log2(ppl) * n_tok / n_bytes
            seg_bpbs.append(round(bpb, 5))
            tot_bytes += n_bytes
            tot_wsum += bpb * n_bytes
            print(f"{lang} seg {i + 1}/{len(segs)}: bytes {n_bytes} tok {n_tok} "
                  f"ppl {ppl:.4f} bpb {bpb:.4f}", flush=True)
        overall = tot_wsum / tot_bytes
        report[lang] = {"segments": seg_bpbs, "bytes": tot_bytes,
                        "overall_bpb": round(overall, 5)}
        print(f"== {lang}: overall bpb {overall:.4f} ({tot_bytes} bytes) ==")

    pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
    print("\n| lang | bpb |")
    print("|---|---|")
    for lang, r in report.items():
        print(f"| {lang} | {r['overall_bpb']:.4f} |")
    print(f"per-segment -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
