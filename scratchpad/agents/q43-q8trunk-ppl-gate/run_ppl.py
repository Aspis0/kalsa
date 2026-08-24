#!/usr/bin/env python3
"""q43: run locked llama-perplexity CLI on one GGUF x one corpus. Parse final PPL.

Adaptation of the audited q41 run_ppl.py. LOCKED settings unchanged (PREREG.md).
Arms: control | q8_0. Corpora: wiki (q41 file, reused) + it/es/fr/zh (q43 corpus).
Chunk floor >=100 enforced on EVERY corpus (prereg: each language >=100 chunks).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate"
Q37 = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
Q41 = ROOT / "scratchpad" / "agents" / "q41-ppl-gate"
BINDIR = ROOT / "build-llama-pc" / "bin"
PPLBIN = BINDIR / "llama-perplexity.exe"
PREFIX = "Marco-Mini-Instruct-KEXP-fromsrc"

CORPORA = {
    "wiki": Q41 / "corpus" / "wikitext-2-raw" / "wiki.test.raw",
    "it": HERE / "corpus" / "it.txt",
    "es": HERE / "corpus" / "es.txt",
    "fr": HERE / "corpus" / "fr.txt",
    "zh": HERE / "corpus" / "zh.txt",
}
ARMS = ("control", "q8_0")

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
    m3 = re.search(r"over\s+(\d+)\s+chunks", text, re.I)
    if m3:
        out["n_chunks"] = int(m3.group(1))
    else:
        idxs = [int(x) for x in re.findall(r"\[(\d+)\]\s*[0-9.]+", text)]
        if idxs:
            out["n_chunks"] = max(idxs)
    return out


def run(arm: str, corpus: str) -> dict:
    if arm not in ARMS:
        raise SystemExit(f"bad arm {arm}")
    if corpus not in CORPORA:
        raise SystemExit(f"bad corpus {corpus}")
    src = CORPORA[corpus]
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
    if rec.get("n_chunks", 0) < 100:
        raise SystemExit(f"chunks {rec.get('n_chunks')} < 100 on {corpus}")
    return rec


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: run_ppl.py control|q8_0 wiki|it|es|fr|zh", file=sys.stderr)
        return 2
    run(sys.argv[1], sys.argv[2])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
