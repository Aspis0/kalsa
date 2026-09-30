#!/usr/bin/env python3
"""Per-document bits-per-byte over the post-cutoff corpus, via llama.cpp.

Corpus layout: <corpus>/<lang>/<doc>.txt (eval/build_postcutoff_corpus.py).
Each DOCUMENT is one evaluation unit: llama-perplexity runs once per doc
(one model load per doc — the fork's server exposes logprobs for generated
tokens only, so teacher-forced NLL needs the CLI), bpb = log2(ppl) *
n_tokens / n_bytes with the model's own tokenizer. The per-language value is
the byte-weighted mean; per-doc values go to --out for the paired bootstrap
over documents (eval/bootstrap_ci.py).

Usage: run_bpb_eval.py --llama <build/bin> --model <gguf> --tokenizer <dir>
                       --corpus <corpus_dir> --out bpb.json
                       [--langs en,it,es,fr,zh] [--ctx 8192]
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


def run_perplexity(binary: str, model: str, text_file: pathlib.Path,
                   ctx: int) -> float:
    out = subprocess.run(
        [binary, "-m", model, "-f", str(text_file), "--no-warmup",
         "-ngl", "99", "-c", str(ctx), "-b", "2048"],
        capture_output=True, text=True, timeout=3600)
    log = out.stdout + out.stderr
    if out.returncode != 0:
        sys.exit(f"bpb: llama-perplexity rc={out.returncode} on {text_file}\n{log[-800:]}")
    hits = PPL_RE.findall(log) or PPL_RE_FALLBACK.findall(log)
    if not hits:
        sys.exit(f"bpb: no PPL in output for {text_file.name}\n{log[-400:]}")
    return float(hits[-1])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llama", required=True, help="llama.cpp build/bin dir")
    ap.add_argument("--model", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--corpus", required=True,
                    help="dir with <lang>/<doc>.txt per language")
    ap.add_argument("--out", required=True, help="per-doc JSON for CIs")
    ap.add_argument("--langs", default="en,it,es,fr,zh")
    ap.add_argument("--ctx", type=int, default=8192,
                    help="per-doc context; docs are capped at ~12 KB by the "
                         "builder, so 8192 tokens covers every doc in one pass")
    a = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(a.tokenizer)
    binary = str(pathlib.Path(a.llama) / "llama-perplexity")
    corpus = pathlib.Path(a.corpus)
    report = {}

    for lang in a.langs.split(","):
        docs = sorted((corpus / lang).glob("*.txt"))
        assert docs, f"no documents under {corpus / lang}"
        doc_bpbs, doc_bytes = [], []
        for i, doc in enumerate(docs):
            text = doc.read_text(encoding="utf-8")
            n_bytes = len(text.encode())
            n_tok = len(tok(text, add_special_tokens=False)["input_ids"])
            ppl = run_perplexity(binary, a.model, doc, a.ctx)
            bpb = math.log2(ppl) * n_tok / n_bytes
            doc_bpbs.append(round(bpb, 5))
            doc_bytes.append(n_bytes)
            print(f"{lang} doc {i + 1}/{len(docs)}: {doc.name} bytes {n_bytes} "
                  f"tok {n_tok} ppl {ppl:.4f} bpb {bpb:.4f}", flush=True)
        total = sum(doc_bytes)
        overall = sum(b * n for b, n in zip(doc_bpbs, doc_bytes)) / total
        report[lang] = {"docs": doc_bpbs, "bytes": total,
                        "n_docs": len(docs), "overall_bpb": round(overall, 5)}
        print(f"== {lang}: overall bpb {overall:.4f} "
              f"({len(docs)} docs, {total} bytes) ==")

    pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
    print(f"per-document -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
