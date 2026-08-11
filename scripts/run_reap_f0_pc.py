#!/usr/bin/env python3
"""FASE 0 PC: smoke gen + bpb EN/IT on community REAP GGUF."""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "reap" / "f0"
BIN = ROOT / "build-pc" / "cli" / "bmoe-cli.exe"
MODEL = ROOT / "models" / "reap_community" / "Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
EN = ROOT / "corpus" / "multi5" / "en_slice.txt"
IT = ROOT / "corpus" / "multi5" / "it_slice.txt"
EXPECT = 10599958400
MASTER = OUT / "f0_pc.master.log"


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}] {msg}"
    MASTER.parent.mkdir(parents=True, exist_ok=True)
    with MASTER.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def run_bmoe(args: list[str], stdout_path: Path, stderr_path: Path) -> int:
    cmd = [str(BIN)] + args
    log("CMD " + " ".join(cmd[:8]) + " ...")
    with stdout_path.open("w", encoding="utf-8", errors="replace") as so, stderr_path.open(
        "w", encoding="utf-8", errors="replace"
    ) as se:
        p = subprocess.run(cmd, stdout=so, stderr=se, cwd=str(BIN.parent))
    return int(p.returncode)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    MASTER.write_text("", encoding="utf-8")
    if not BIN.is_file():
        log(f"MISSING bin {BIN}")
        return 2
    if not MODEL.is_file():
        log(f"MISSING model {MODEL}")
        return 2
    size = MODEL.stat().st_size
    log(f"model size={size} expect={EXPECT} match={size == EXPECT}")
    if size != EXPECT:
        (OUT / "STATUS_PC.txt").write_text("FAIL_SIZE\n", encoding="utf-8")
        return 2

    h = hashlib.sha256()
    with MODEL.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    sha = h.hexdigest()
    log(f"sha256={sha}")
    (OUT / "model.sha256").write_text(sha + "\n", encoding="utf-8")

    # --- smoke ---
    log("SMOKE gen n=32")
    ptext = "Reply with one short sentence about flash storage."
    smoke_out = OUT / "smoke_pc.stdout.txt"
    smoke_err = OUT / "smoke_pc.stderr.txt"
    smoke_args = [
        "-m",
        str(MODEL),
        "--moe-stream",
        "--cache-mb",
        "2000",
        "--dense-weights",
        "anon",
        "--overlap",
        "--io-threads",
        "4",
        "--ubatch",
        "512",
        "-t",
        "8",
        "-c",
        "2048",
        "--n-expert-used",
        "8",
        "--temp",
        "0",
        "--chatml",
        "--no-think",
        "-n",
        "32",
        "-p",
        ptext,
    ]
    rc = run_bmoe(smoke_args, smoke_out, smoke_err)
    log(f"smoke rc={rc}")
    extract_lines = []
    for path in (smoke_err, smoke_out):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            if re.search(
                r"n_expert|expert_count|generation:|BMOE_DONE|error|Error|load time|moe|unknown arg|print_info",
                line,
                re.I,
            ):
                extract_lines.append(line)
    (OUT / "smoke_pc_extract.txt").write_text("\n".join(extract_lines[:80]) + "\n", encoding="utf-8")
    for line in extract_lines[:40]:
        log(line)

    if rc != 0:
        log("SMOKE FAIL")
        (OUT / "STATUS_PC.txt").write_text("FAIL_SMOKE\n", encoding="utf-8")
        return 3

    # --- bpb ---
    def bpb(tag: str, corpus: Path) -> int:
        d = OUT / f"bpb_pc_{tag}"
        d.mkdir(parents=True, exist_ok=True)
        log(f"BPB {tag} corpus={corpus}")
        args = [
            "-m",
            str(MODEL),
            "--moe-stream",
            "--cache-mb",
            "2000",
            "--dense-weights",
            "anon",
            "--overlap",
            "--io-threads",
            "4",
            "--ubatch",
            "512",
            "-t",
            "8",
            "-c",
            "4096",
            "--n-expert-used",
            "8",
            "--ppl-decode",
            str(corpus),
            "--ppl-csv",
            str(d / "per_token.csv"),
        ]
        rc_b = run_bmoe(args, d / "stdout.txt", d / "stderr.txt")
        log(f"bpb {tag} rc={rc_b}")
        se = d / "stderr.txt"
        if se.is_file():
            for line in se.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]:
                log(line)
        return rc_b

    rc_en = bpb("en", EN) if EN.is_file() else 2
    rc_it = bpb("it", IT) if IT.is_file() else 2
    if rc_en == 0 and rc_it == 0:
        log("F0_PC PASS")
        (OUT / "STATUS_PC.txt").write_text("PASS\n", encoding="utf-8")
        return 0
    log(f"F0_PC FAIL en={rc_en} it={rc_it}")
    (OUT / "STATUS_PC.txt").write_text("FAIL\n", encoding="utf-8")
    return 4


if __name__ == "__main__":
    sys.exit(main())
