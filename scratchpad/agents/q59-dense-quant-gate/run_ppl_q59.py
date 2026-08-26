#!/usr/bin/env python3
"""q59: one idle-priority llama-perplexity arm x corpus, all chunks."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q59-dense-quant-gate"
GGUF = HERE / "gguf"
PPLBIN = ROOT / "build-llama-pc" / "bin" / "llama-perplexity.exe"
IDLE_PRIORITY_CLASS = 0x40

CORPORA = {
    "wiki": ROOT / "scratchpad" / "agents" / "q41-ppl-gate" / "corpus" / "wikitext-2-raw" / "wiki.test.raw",
    "it": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "it.txt",
    "es": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "es.txt",
    "fr": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "fr.txt",
    "zh": ROOT / "scratchpad" / "agents" / "q43-q8trunk-ppl-gate" / "corpus" / "zh.txt",
}
CORPUS_SHA = {
    "wiki": "173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08",
    "it": "fddf963377e1a90cd02dde9baf1fbe95a003e86f9ec0eebfda6e9b3652027aac",
    "es": "45b4bdbf62de82f8640d259368572553b07240dae7f42eb8c0bdfaa762146915",
    "fr": "c477f06d166a387f937784742eb4ac04ac9b4f268f663618f8e28fee8a924f0e",
    "zh": "234fe0fdfa8785838f995a9681ea3e1871bcb7c8ca74bf2180e4c90310a5c606",
}
ARMS = {
    "control": GGUF / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf",
    "iq4_nl": GGUF / "Qwen3.5-4B-fromsrc-IQ4_NL.gguf",
    "q4_0": GGUF / "Qwen3.5-4B-fromsrc-Q4_0.gguf",
}
CTX, BATCH, UBATCH, THREADS, NGL, STRIDE = "2048", "512", "512", "8", "0", "0"
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
IDLE_PRIORITY_CLASS = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)


def ignore_console_signals() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    sigbreak = getattr(signal, "SIGBREAK", None)
    if sigbreak is not None:
        signal.signal(sigbreak, signal.SIG_IGN)
    if os.name == "nt":
        try:
            ctypes.windll.kernel32.SetConsoleCtrlHandler(None, True)
        except Exception:
            pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_ppl(text: str) -> dict:
    out: dict = {}
    m = re.search(r"Final estimate:\s*PPL\s*=\s*([0-9.]+)\s*\+/-\s*([0-9.]+)", text, re.I)
    if m:
        out["ppl"], out["ppl_err"] = float(m.group(1)), float(m.group(2))
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


def run(arm: str, corpus: str, chunks: str | None = None) -> dict:
    if arm not in ARMS or corpus not in CORPORA:
        raise SystemExit(f"usage arm={sorted(ARMS)} corpus={sorted(CORPORA)}")
    model, data = ARMS[arm], CORPORA[corpus]
    if not model.exists() or not data.exists() or not PPLBIN.exists():
        raise SystemExit("missing model, corpus, or PPL binary")
    got_sha = sha256(data)
    if got_sha != CORPUS_SHA[corpus]:
        raise SystemExit(f"corpus sha mismatch {corpus}: {got_sha}")
    log = GGUF / "ppl" / f"ppl-{arm}-{corpus}.log"
    out_json = GGUF / "ppl" / f"ppl-{arm}-{corpus}.json"
    log.parent.mkdir(parents=True, exist_ok=True)
    chunk_arg = chunks if chunks is not None else ("64" if corpus == "wiki" else "-1")
    cmd = [str(PPLBIN), "-m", str(model), "-f", str(data), "-c", CTX, "-b", BATCH, "-ub", UBATCH,
           "-t", THREADS, "-ngl", NGL, "--chunks", chunk_arg, "--ppl-stride", STRIDE]
    env = os.environ.copy()
    env["PATH"] = str(PPLBIN.parent) + os.pathsep + env.get("PATH", "")
    t0 = time.perf_counter()
    with log.open("w", encoding="utf-8", errors="replace") as f:
        f.write("CMD " + " ".join(cmd) + "\n")
        f.flush()
        p = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=f,
            stderr=subprocess.STDOUT,
            creationflags=IDLE_PRIORITY_CLASS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
            close_fds=False,
        )
        if not ctypes.windll.kernel32.SetPriorityClass(int(p._handle), IDLE_PRIORITY_CLASS):
            raise SystemExit("SetPriorityClass failed")
        rc = p.wait()
    wall = time.perf_counter() - t0
    raw = log.read_text(encoding="utf-8", errors="replace")
    parsed = parse_ppl(raw)
    rec = {
        "arm": arm, "corpus": corpus, "model": str(model), "model_bytes": model.stat().st_size,
        "model_sha256": sha256(model), "file": str(data), "file_bytes": data.stat().st_size,
        "file_sha256": got_sha, "cmd": cmd, "rc": rc, "wall_s": wall, "log": str(log), **parsed,
    }
    if rc != 0 or "ppl" not in rec or "n_chunks" not in rec:
        if out_json.exists():
            out_json.unlink()
        raise SystemExit(rc or 1)
    out_json.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    print(json.dumps(rec, indent=2), flush=True)
    return rec


if __name__ == "__main__":
    ignore_console_signals()
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: run_ppl_q59.py control|iq4_nl|q4_0 wiki|it|es|fr|zh [chunks]")
    raise SystemExit(0 if run(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None) else 1)
