#!/usr/bin/env python3
"""Bits-per-byte over the post-cutoff corpus, via llama-perplexity.

Corpus layout: <corpus>/<lang>/<doc>.txt (eval/build_postcutoff_corpus.py).
Per language, the documents are concatenated (sorted order, deterministic)
and scored in ONE llama-perplexity run with a small context: the fork
REFUSES to evaluate fewer than 2*n_ctx tokens (perplexity.cpp:480), which
killed the earlier per-document design (docs are 0.6-7k tokens vs a 16k
floor); at -c 1024 a whole language (~70k tokens) is one legal run.

bpb = log2(ppl) * n_tokens / n_bytes with the model's own tokenizer over the
same concatenated text. The overall value uses the tool's pooled "Final
estimate"; the per-CHUNK people printed as "[n]ppl," are the bootstrap
units (eval/bootstrap_ci.py) — every chunk is exactly n_ctx tokens, so the
unweighted chunk mean and the pooled estimate share one scale factor per
language. Note llama-perplexity conditions each window on its first half
and scores the second; that bias is identical for every arm and cancels in
the paired diff.

Usage: run_bpb_eval.py --llama <build/bin> --model <gguf> --tokenizer <dir>
                       --corpus <corpus_dir> --out bpb.json
                       [--langs en,it,es,fr,zh] [--ctx 1024] [--ngl 99]
"""

import argparse
import json
import math
import pathlib
import re
import subprocess
import sys

from transformers import AutoTokenizer

FINAL_PPL_RE = re.compile(r"Final estimate: PPL = ([0-9.]+)")
CHUNK_PPL_RE = re.compile(r"\[(\d+)\]([0-9.]+)")


def run_perplexity(binary: str, model: str, text_file: pathlib.Path,
                   ctx: int, ngl: int) -> tuple[float, list[float]]:
    out = subprocess.run(
        [binary, "-m", model, "-f", str(text_file), "--no-warmup",
         "-ngl", str(ngl), "-c", str(ctx), "-b", str(2 * ctx)],
        capture_output=True, text=True, timeout=7200)
    log = out.stdout + out.stderr
    if out.returncode != 0 or "you need at least" in log:
        sys.exit(f"bpb: llama-perplexity rc={out.returncode} on {text_file}\n{log[-800:]}")
    final = FINAL_PPL_RE.findall(log)
    chunks = [float(p) for _, p in CHUNK_PPL_RE.findall(log)]
    if not final or not chunks:
        sys.exit(f"bpb: no PPL in output for {text_file.name}\n{log[-400:]}")
    return float(final[-1]), chunks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llama", required=True, help="llama.cpp build/bin dir")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--corpus", required=True,
                    help="dir with <lang>/<doc>.txt per language")
    ap.add_argument("--out", required=True, help="per-chunk JSON for CIs")
    ap.add_argument("--langs", default="en,it,es,fr,zh")
    ap.add_argument("--ctx", type=int, default=1024,
                    help="per-chunk context; the tool needs >= 2*ctx tokens "
                         "per run, so this is the whole-language window size")
    ap.add_argument("--ngl", type=int, default=99)
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-perplexity")
    corpus = pathlib.Path(a.corpus)
    tmp = pathlib.Path(f"/tmp/kalsa-bpb-{pathlib.Path(a.model).stem}")
    tmp.parent.mkdir(exist_ok=True)
    report = {}

    for lang in a.langs.split(","):
        docs = sorted((corpus / lang).glob("*.txt"))
        assert docs, f"no documents under {corpus / lang}"
        text = "\n".join(d.read_text(encoding="utf-8") for d in docs)
        n_bytes = len(text.encode("utf-8"))
        n_tok = len(tok(text, add_special_tokens=False)["input_ids"])
        # perplexity.cpp needs >= 2*n_ctx tokens; check before the run so the
        # failure names the cause, not the tool's error text
        if n_tok < 2 * a.ctx:
            sys.exit(f"bpb: {lang} is {n_tok} tokens, needs >= {2 * a.ctx} at -c {a.ctx}")
        work = tmp.with_suffix(f".{lang}.txt")
        work.write_text(text, encoding="utf-8")
        print(f"{lang}: {len(docs)} docs, {n_bytes} bytes, {n_tok} tokens", flush=True)
        ppl, chunk_ppls = run_perplexity(binary, a.model, work, a.ctx, a.ngl)
        scale = n_tok / n_bytes
        chunk_bpbs = [round(math.log2(p) * scale, 5) for p in chunk_ppls]
        overall = math.log2(ppl) * scale
        report[lang] = {"chunks": chunk_bpbs, "n_chunks": len(chunk_ppls),
                        "bytes": n_bytes, "n_docs": len(docs),
                        "overall_bpb": round(overall, 5)}
        print(f"== {lang}: bpb {overall:.4f} (ppl {ppl:.4f}, "
              f"{len(chunk_ppls)} chunks) ==")

    pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
    print(f"per-chunk -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
