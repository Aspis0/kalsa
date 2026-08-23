#!/usr/bin/env python3
"""Run locked llama-perplexity CLI on one GGUF. Parse final PPL. Do not change flags."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q41-ppl-gate"
Q37 = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
BINDIR = ROOT / "build-llama-pc" / "bin"
PPLBIN = BINDIR / "llama-perplexity.exe"
WIKI = HERE / "corpus" / "wikitext-2-raw" / "wiki.test.raw"
IT = ROOT / "corpus" / "multi5" / "it.txt"
PREFIX = "Marco-Mini-Instruct-KEXP-fromsrc"

# LOCKED in PREREG.md — do not edit without invalidating the gate.
CTX = "512"
BATCH = "512"
UBATCH = "512"
THREADS = "16"
NGL = "0"
CHUNKS = "-1"
STRIDE = "0"


def model_path(arm: str) -> Path:
    return Q37 / "gguf" / "marco" / f"{PREFIX}-trunk-{arm}.gguf"


def parse_ppl(text: str) -> dict:
    out: dict = {}
    m = re.search(
        r"Final estimate:\s*PPL\s*=\s*([0-9.]+)\s*\+/-\s*([0-9.]+)",
        text,
        re.I,
    )
    if m:
        out["ppl"] = float(m.group(1))
        out["ppl_err"] = float(m.group(2))
    m2 = re.findall(r"perplexity:\s*([0-9.]+)", text, re.I)
    if m2 and "ppl" not in out:
        out["ppl"] = float(m2[-1])
    # chunk count: lines like [123]x.xxxx or "calculating perplexity over N chunks"
    m3 = re.search(r"over\s+(\d+)\s+chunks", text, re.I)
    if m3:
        out["n_chunks"] = int(m3.group(1))
    else:
        idxs = [int(x) for x in re.findall(r"\[(\d+)\]\s*[0-9.]+", text)]
        if idxs:
            out["n_chunks"] = max(idxs)
    return out


def run(arm: str, corpus: str) -> dict:
    if corpus == "wiki":
        src = WIKI
    elif corpus == "it":
        src = IT
    else:
        raise SystemExit(f"bad corpus {corpus}")
    gguf = model_path(arm)
    log = HERE / "logs" / f"ppl-{arm}-{corpus}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(PPLBIN),
        "-m", str(gguf),
        "-f", str(src),
        "-c", CTX, "-b", BATCH, "-ub", UBATCH,
        "-t", THREADS, "-ngl", NGL,
        "--chunks", CHUNKS, "--ppl-stride", STRIDE,
    ]
    env = os.environ.copy()
    env["PATH"] = f"{BINDIR}{os.pathsep}" + env.get("PATH", "")
    t0 = time.time()
    with log.open("w", encoding="utf-8", errors="replace") as f:
        f.write("CMD " + " ".join(cmd) + "\n")
        f.flush()
        p = subprocess.run(cmd, cwd=str(ROOT), env=env, stdout=f, stderr=subprocess.STDOUT)
    wall = time.time() - t0
    text = log.read_text(encoding="utf-8", errors="replace")
    parsed = parse_ppl(text)
    rec = {
        "arm": arm,
        "corpus": corpus,
        "model": str(gguf),
        "model_bytes": gguf.stat().st_size,
        "file": str(src),
        "file_bytes": src.stat().st_size,
        "cmd": cmd,
        "rc": p.returncode,
        "wall_s": wall,
        "log": str(log),
        **parsed,
    }
    (HERE / "logs" / f"ppl-{arm}-{corpus}.json").write_text(
        json.dumps(rec, indent=2), encoding="utf-8"
    )
    print(json.dumps(rec, indent=2))
    if p.returncode != 0:
        raise SystemExit(p.returncode)
    if "ppl" not in rec:
        raise SystemExit("no PPL parsed")
    if rec.get("n_chunks", 0) < 100 and corpus == "wiki":
        raise SystemExit(f"chunks {rec.get('n_chunks')} < 100")
    return rec


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: run_ppl.py control|iq4_nl|q4_0 wiki|it", file=sys.stderr)
        return 2
    run(sys.argv[1], sys.argv[2])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
