#!/usr/bin/env python3
"""SELFSPEC F1b PC driver: E1/E2/E3 teacher-force isolation. Does not touch PPL."""

from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "results" / "selfspec_f1b"
BIN = ROOT / "BigMoeOnEdge-selfspec-f1" / "build" / "cli" / "bmoe-cli.exe"
# Fallback: worktree-local name if the orchestrator copied the binary.
BIN_ALT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli.exe")
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
F0 = ROOT / "results" / "selfspec_f0"

PROMPTS = {
    "longfact": F0 / "prompts" / "p_longfact.txt",
    "creative": F0 / "prompts" / "p_creative.txt",
    "code": F0 / "prompts" / "p_code.txt",
    "fact": ROOT / "results" / "marco_phase1" / "speed_s23" / "prompts" / "p_fact.txt",
}
GOLD = {
    pid: F0 / "streams" / f"{pid}_target.txt" for pid in PROMPTS
}

N_MAX = 256
THREADS = "4"


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def log(msg: str) -> None:
    line = f"[{ts()}] {msg}"
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "run.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def binary() -> Path:
    if BIN_ALT.is_file():
        return BIN_ALT
    if BIN.is_file():
        return BIN
    raise SystemExit(f"missing binary: {BIN_ALT} or {BIN}")


def busy_ppl() -> list[str]:
    """Refuse to start if we would collide with the PPL binary. We never kill it."""
    ps = r"""
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'bmoe-cli.exe' -and [string]$_.CommandLine -match 'build-pc-mellum-ppl'
} | ForEach-Object { '{0}|{1}' -f $_.ProcessId, ([string]$_.CommandLine).Substring(0, [Math]::Min(160, ([string]$_.CommandLine).Length)) }
"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]


def run_diag(pid: str, modes: str = "e1,e2,e3") -> int:
    prompt = PROMPTS[pid]
    gold = GOLD[pid]
    if not prompt.is_file():
        raise SystemExit(f"missing prompt {prompt}")
    if not gold.is_file():
        raise SystemExit(f"missing gold {gold}")
    dest = OUT / pid
    dest.mkdir(parents=True, exist_ok=True)
    exe = binary()
    cmd = [
        str(exe),
        "-m",
        str(MODEL),
        "-t",
        THREADS,
        "-c",
        "2048",
        "--ubatch",
        "512",
        "-n",
        str(N_MAX),
        "--temp",
        "0",
        "--moe-stream",
        "--cache-mb",
        "2000",
        "--dense-weights",
        "anon",
        "--overlap",
        "--io-threads",
        "4",
        "--n-expert-used",
        "6",
        "--selfspec-draft-k",
        "2",
        "--selfspec-draft-prefill-k",
        "6",
        "--selfspec-gamma",
        "4",
        "--prompt-file",
        str(prompt),
        "--selfspec-gold",
        str(gold),
        "--selfspec-diag",
        modes,
        "--selfspec-diag-out",
        str(dest),
    ]
    log("CMD " + " ".join(cmd))
    t0 = time.time()
    with (dest / "diag.log").open("w", encoding="utf-8") as lf:
        lf.write("CMD " + " ".join(cmd) + "\n")
        lf.flush()
        proc = subprocess.run(
            cmd,
            stdout=lf,
            stderr=subprocess.STDOUT,
            cwd=str(exe.parent),
        )
    log(f"done {pid} rc={proc.returncode} wall={time.time() - t0:.1f}s")
    return proc.returncode


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ppl = busy_ppl()
    if ppl:
        log(f"PPL live (leaving it alone): {ppl[0]}")
    else:
        log("PPL not seen (still will not search-and-destroy)")
    ids = sys.argv[1:] or ["longfact"]
    modes = "e1,e2,e3"
    if ids and ids[0] in {"e1", "e2", "e3", "e1,e2", "e1,e2,e3", "e3"}:
        modes = ids[0]
        ids = ids[1:] or ["longfact"]
    rc = 0
    for pid in ids:
        if pid not in PROMPTS:
            raise SystemExit(f"unknown prompt {pid}; want {list(PROMPTS)}")
        one = run_diag(pid, modes)
        if one != 0:
            rc = one
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
