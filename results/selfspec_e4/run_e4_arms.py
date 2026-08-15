#!/usr/bin/env python
"""E4 stateless-draft arms on the 35B — overnight runner.

Waits until the dropcurve job frees the PC (6 END lines in its STATUS + no
bmoe-cli.exe alive), then runs the pre-registered arms in cost order
(G=8 first: shape_fr is O(B^2/G)):

  a2_g8    draft_k=6 verify_k=6 gamma=8   (staleness depth curve)
  a1_g4    draft_k=6 verify_k=6 gamma=4   (headline science arm)
  a3_k2_g4 draft_k=2 verify_k=6 gamma=4   (product arm, E4_PRODUCT verdict)

Same model/prompt/gold/threads as the F1b E1-E3 runs (comparability).
Aborts remaining arms on E4_SANITY_FAIL / E4_BLOCKED (broken instrument).
FORCE_START=1 skips the wait gate.
"""

import hashlib
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
OUT = ROOT / "results" / "selfspec_e4"
BIN = ROOT / "BigMoeOnEdge-selfspec-f1" / "build" / "cli" / "bmoe-cli.exe"
DLLS = ROOT / "BigMoeOnEdge-selfspec-f1" / "build" / "bin"
REPO = ROOT / "BigMoeOnEdge-selfspec-f1"
MODEL = ROOT / "models" / "Qwen3.6-35B-A3B-KEXP.gguf"
PROMPT = ROOT / "results" / "selfspec_f0" / "prompts" / "p_longfact.txt"
GOLD = ROOT / "results" / "selfspec_f0" / "streams" / "longfact_target.txt"
DROP_STATUS = ROOT / "results" / "mellum2_dropcurve" / "STATUS.txt"
STATUS = OUT / "STATUS.txt"

ARMS = [
    ("a2_g8", "6", "8"),
    ("a1_g4", "6", "4"),
    ("a3_k2_g4", "2", "4"),
]


def log(msg: str) -> None:
    line = f"{datetime.now().astimezone().isoformat(timespec='seconds')}  {msg}"
    print(line, flush=True)
    with STATUS.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def bmoe_running() -> bool:
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq bmoe-cli.exe"],
        capture_output=True, text=True,
    ).stdout
    return "bmoe-cli.exe" in out


def dropcurve_done() -> bool:
    try:
        txt = DROP_STATUS.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return sum(1 for ln in txt.splitlines() if " END k6" in ln) >= 6


def wait_gate() -> None:
    if os.environ.get("FORCE_START") == "1":
        log("WAIT_GATE skipped (FORCE_START=1)")
        return
    log("WAIT_GATE start: need 6x'END k6' in dropcurve STATUS and no bmoe-cli.exe")
    announced = 0
    while True:
        done = dropcurve_done()
        busy = bmoe_running()
        if done and not busy:
            log("WAIT_GATE open: dropcurve complete, PC free")
            return
        n = sum(
            1 for ln in DROP_STATUS.read_text(encoding="utf-8", errors="replace").splitlines()
            if " END k6" in ln
        ) if DROP_STATUS.is_file() else 0
        if n != announced:
            log(f"WAIT_GATE progress: dropcurve arms done={n}/6 busy={busy}")
            announced = n
        time.sleep(300)


def run_arm(name: str, draft_k: str, gamma: str) -> tuple[int, str]:
    dest = OUT / name
    dest.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(BIN),
        "-m", str(MODEL),
        "-t", "4",
        "-c", "2048",
        "--ubatch", "512",
        "-n", "256",
        "--temp", "0",
        "--moe-stream",
        "--cache-mb", "2000",
        "--dense-weights", "anon",
        "--overlap",
        "--io-threads", "4",
        "--n-expert-used", "6",
        "--selfspec-draft-k", draft_k,
        "--selfspec-gamma", gamma,
        "--prompt-file", str(PROMPT),
        "--selfspec-gold", str(GOLD),
        "--selfspec-diag", "e4",
        "--selfspec-diag-out", str(dest),
    ]
    log(f"RUN {name}: " + " ".join(cmd))
    env = dict(os.environ)
    env["PATH"] = str(DLLS) + os.pathsep + env.get("PATH", "")
    t0 = time.time()
    with (dest / "diag.log").open("w", encoding="utf-8") as lf:
        lf.write("CMD " + " ".join(cmd) + "\n")
        lf.flush()
        proc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT,
                              cwd=str(BIN.parent), env=env)
    verdict = ""
    summary = dest / "SUMMARY.txt"
    if summary.is_file():
        first = summary.read_text(encoding="utf-8", errors="replace").splitlines()
        verdict = first[0].strip() if first else ""
    log(f"DONE {name} rc={proc.returncode} wall={time.time() - t0:.0f}s verdict={verdict or 'NO_SUMMARY'}")
    return proc.returncode, verdict


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log("=== E4 ARMS RUNNER START ===")
    for p in (BIN, MODEL, PROMPT, GOLD):
        if not p.is_file():
            log(f"FATAL missing {p}")
            return 2
    wait_gate()
    rev = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True).stdout.strip()
    log(f"PIN git_rev={rev}")
    log(f"PIN bin_sha={sha256(BIN)}")
    log(f"PIN model_sha={sha256(MODEL)}")
    aborted = False
    for name, dk, g in ARMS:
        rc, verdict = run_arm(name, dk, g)
        if verdict.startswith(("E4_SANITY_FAIL", "E4_BLOCKED")) or (rc != 0 and not verdict):
            log(f"ABORT remaining arms: {name} says instrument broken ({verdict or f'rc={rc}'})")
            aborted = True
            break
    log("E4_ARMS_ABORT" if aborted else "E4_ARMS_DONE")
    return 1 if aborted else 0


if __name__ == "__main__":
    sys.exit(main())
