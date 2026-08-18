#!/usr/bin/env python3
"""Run --ppl-decode on corpus/multi5 for a given model; write bpb + fertility JSON.

bpb_L = (sum -log2 p) / N_bytes = -sum_logprob / (ln(2) * N_bytes)
sum_logprob from bmoe-cli is natural log (ln p), same as llama.cpp.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LN2 = math.log(2.0)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_ppl_json(stdout: str) -> dict:
    """Last JSON object in stdout with ppl / sum_logprob keys."""
    # Prefer full-line JSON
    candidates = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        if "sum_logprob" not in line and '"ppl"' not in line:
            continue
        try:
            candidates.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if candidates:
        return candidates[-1]
    # Fallback: search for JSON blob
    m = re.findall(r"\{[^{}]*sum_logprob[^{}]*\}", stdout)
    if m:
        return json.loads(m[-1])
    raise RuntimeError("no ppl JSON found in stdout")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--tag", required=True, help="label e.g. KEXP / Marco / Qwen35-4B")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--langs", default="en,es,fr,it,zh")
    ap.add_argument("--threads", type=int, default=max(2, (os.cpu_count() or 8) // 2))
    ap.add_argument("--ctx", type=int, default=4096)
    ap.add_argument("--ubatch", type=int, default=512)
    ap.add_argument("--moe-stream", action="store_true")
    ap.add_argument("--cache-mb", type=int, default=2000)
    ap.add_argument("--dense-weights", default="anon")
    ap.add_argument("--overlap", action="store_true", default=True)
    ap.add_argument("--no-overlap", action="store_true")
    ap.add_argument("--io-threads", type=int, default=4)
    ap.add_argument("--n-expert-used", type=int, default=0)
    ap.add_argument(
        "--drop-cold-experts",
        type=float,
        default=0.0,
        help="lossy drop threshold (campaign KEXP: 0.65 with k=6)",
    )
    ap.add_argument("--ppl-mode", choices=["decode", "file"], default="decode")
    ap.add_argument(
        "--extra",
        action="append",
        default=[],
        help="extra CLI token (repeat; use --extra=--flag form)",
    )
    ap.add_argument(
        "--stock-kernel",
        action="store_true",
        help="append --no-moe-fused-gemv --no-moe-fused-ffn (S23 5.151 config)",
    )
    args = ap.parse_args()

    binary = Path(args.binary)
    model = Path(args.model)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    corpus_dir = ROOT / "corpus" / "multi5"
    langs = [x.strip() for x in args.langs.split(",") if x.strip()]

    meta = {
        "tag": args.tag,
        "binary": str(binary),
        "binary_sha256": sha256_file(binary) if binary.exists() else None,
        "model": str(model),
        "model_sha256": sha256_file(model) if model.exists() else None,
        "model_bytes": model.stat().st_size if model.exists() else None,
        "ppl_mode": args.ppl_mode,
        "threads": args.threads,
        "ctx": args.ctx,
        "config": {},
        "langs": {},
        "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    if not binary.exists():
        print(f"FAIL binary missing: {binary}", file=sys.stderr)
        return 2
    if not model.exists():
        print(f"FAIL model missing: {model}", file=sys.stderr)
        return 2

    for lang in langs:
        corpus = corpus_dir / f"{lang}.txt"
        if not corpus.exists():
            print(f"FAIL corpus missing: {corpus}", file=sys.stderr)
            return 2
        n_bytes = corpus.stat().st_size
        corpus_sha = sha256_file(corpus)
        run_dir = outdir / lang
        run_dir.mkdir(parents=True, exist_ok=True)
        csv_path = run_dir / "per_token.csv"
        stdout_path = run_dir / "stdout.txt"
        stderr_path = run_dir / "stderr.txt"

        cmd = [
            str(binary),
            "-m",
            str(model),
            "-t",
            str(args.threads),
            "-c",
            str(args.ctx),
            "--ubatch",
            str(args.ubatch),
            f"--ppl-{args.ppl_mode}",
            str(corpus),
            "--ppl-csv",
            str(csv_path),
        ]
        if args.moe_stream:
            cmd += [
                "--moe-stream",
                "--cache-mb",
                str(args.cache_mb),
                "--dense-weights",
                args.dense_weights,
                "--io-threads",
                str(args.io_threads),
            ]
            if not args.no_overlap:
                cmd.append("--overlap")
            if args.n_expert_used > 0:
                cmd += ["--n-expert-used", str(args.n_expert_used)]
            if args.drop_cold_experts and args.drop_cold_experts > 0:
                cmd += ["--drop-cold-experts", str(args.drop_cold_experts)]
        extra = list(args.extra)
        if args.stock_kernel:
            extra += ["--no-moe-fused-gemv", "--no-moe-fused-ffn"]
        if extra:
            cmd += extra

        meta["config"] = {
            "cmd_tail": cmd[1:],
            "moe_stream": args.moe_stream,
            "cache_mb": args.cache_mb if args.moe_stream else None,
        }

        env = os.environ.copy()
        lib_dirs = [str(binary.parent)]
        sibling_bin = binary.parent.parent / "bin"
        if sibling_bin.is_dir():
            lib_dirs.append(str(sibling_bin))
        env["LD_LIBRARY_PATH"] = os.pathsep.join(lib_dirs) + (
            os.pathsep + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else ""
        )
        # Windows: DLL next to exe, or sibling bin/ (Ninja layout)
        env["PATH"] = os.pathsep.join(lib_dirs) + os.pathsep + env.get("PATH", "")

        print(f"=== {args.tag} {lang} bytes={n_bytes} ===", flush=True)
        print("CMD:", " ".join(cmd), flush=True)
        t0 = time.time()
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            cwd=str(binary.parent),
        )
        dt = time.time() - t0
        stdout_path.write_text(proc.stdout, encoding="utf-8")
        stderr_path.write_text(proc.stderr, encoding="utf-8")
        (run_dir / "rc.txt").write_text(str(proc.returncode), encoding="utf-8")

        entry: dict = {
            "lang": lang,
            "corpus": str(corpus),
            "corpus_sha256": corpus_sha,
            "n_bytes": n_bytes,
            "rc": proc.returncode,
            "seconds": round(dt, 3),
        }
        if proc.returncode != 0:
            print(f"FAIL rc={proc.returncode} lang={lang}", file=sys.stderr)
            print(proc.stderr[-2000:] if proc.stderr else proc.stdout[-2000:], file=sys.stderr)
            entry["error"] = "nonzero_rc"
            meta["langs"][lang] = entry
            (outdir / f"{args.tag}_multi5.json").write_text(
                json.dumps(meta, indent=2) + "\n", encoding="utf-8"
            )
            return proc.returncode or 1

        try:
            pj = parse_ppl_json(proc.stdout + "\n" + proc.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL parse ppl JSON lang={lang}: {e}", file=sys.stderr)
            entry["error"] = f"parse:{e}"
            meta["langs"][lang] = entry
            (outdir / f"{args.tag}_multi5.json").write_text(
                json.dumps(meta, indent=2) + "\n", encoding="utf-8"
            )
            return 3

        sum_lp = float(pj["sum_logprob"])
        n_scored = int(pj.get("n_scored") or pj.get("n_tokens") or 0)
        n_tokens = int(pj.get("n_tokens") or n_scored)
        ppl = float(pj["ppl"])
        # bpb from natural-log sum_logprob
        bpb = (-sum_lp) / (LN2 * n_bytes)
        fertility = n_bytes / n_tokens if n_tokens else None

        entry.update(
            {
                "n_tokens": n_tokens,
                "n_scored": n_scored,
                "sum_logprob": sum_lp,
                "ppl": ppl,
                "bpb": bpb,
                "bytes_per_token": fertility,
                "raw": pj,
            }
        )
        meta["langs"][lang] = entry
        print(
            f"  ppl={ppl:.4f} bpb={bpb:.4f} tok={n_tokens} fert={fertility:.3f} s={dt:.1f}",
            flush=True,
        )
        (outdir / f"{args.tag}_multi5.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )

    # macro
    bpbs = [meta["langs"][L]["bpb"] for L in langs if "bpb" in meta["langs"].get(L, {})]
    meta["macro_bpb"] = sum(bpbs) / len(bpbs) if bpbs else None
    meta["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    (outdir / f"{args.tag}_multi5.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    print(f"MACRO bpb={meta['macro_bpb']:.4f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
