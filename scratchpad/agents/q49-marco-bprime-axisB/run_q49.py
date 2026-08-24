#!/usr/bin/env python3
"""Generate both arms AFTER PREREG freeze. One llama-cli at a time. Resumable."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q49-marco-bprime-axisB"
CLI = ROOT / "build-llama-pc" / "bin" / "llama-cli.exe"
BIN = CLI.parent
MARCO = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source" / "gguf" / "marco"
PROMPT_SHA = "56574436b342d71464b58fd66982a2dbf8b9fb3f5fb14ddf12bf01cca2aacfb9"
ARMS = {
    "control": MARCO / "Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf",
    "q8_0": MARCO / "Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf",
}
ARM_SHA = {
    "control": "f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea",
    "q8_0": "bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419",
}


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def slog(msg: str) -> None:
    line = f"{utc()} {msg}"
    print(line, flush=True)
    with (HERE / "run.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def strip_chat(raw: str) -> str:
    for marker in ("Assistant:", "assistant\n", "<|im_start|>assistant"):
        if marker in raw:
            raw = raw.split(marker, 1)[1]
            break
    # drop trailing chat end tokens if present
    for end in ("<|im_end|>", "</s>", "<|eot_id|>"):
        if end in raw:
            raw = raw.split(end, 1)[0]
    return raw.strip()


def generate(arm: str, pid: str, prompt: str, n: int, gen_dir: Path) -> dict:
    out_txt = gen_dir / f"{pid}__{arm}.txt"
    raw_txt = gen_dir / f"{pid}__{arm}.raw.txt"
    pf = gen_dir / f"_prompt_{pid}.txt"
    pf.write_text(prompt, encoding="utf-8")
    if raw_txt.exists():
        raw_txt.unlink()
    env = os.environ.copy()
    env["PATH"] = f"{BIN}{os.pathsep}" + env.get("PATH", "")
    cmd = [
        str(CLI), "-m", str(ARMS[arm]),
        "-f", str(pf),
        "-o", str(raw_txt),
        "-n", str(n),
        "--temp", "0",
        "--seed", "42",
        "-c", "4096",
        "-t", "8",
        "-ngl", "0",
        "-cnv", "--single-turn",
        "--no-display-prompt",
        "--log-disable",
        "--no-warmup",
        "--reasoning", "off",
    ]
    errp = gen_dir / f"_stderr_{arm}.log"
    slog(f"START {pid} {arm} n={n} threads=8 prio=Idle")
    t0 = time.time()
    # Windows: IDLE_PRIORITY_CLASS so the owner's interactive session stays usable.
    idle = getattr(subprocess, "IDLE_PRIORITY_CLASS", 0x00000040)
    with errp.open("a", encoding="utf-8", errors="replace") as errf:
        errf.write(f"\n===== {utc()} {pid} threads=8 prio=Idle =====\n")
        proc = subprocess.Popen(
            cmd, cwd=str(ROOT), env=env,
            stdout=subprocess.DEVNULL, stderr=errf,
            creationflags=idle,
        )
        rc = proc.wait()
    dt = time.time() - t0
    raw = raw_txt.read_text(encoding="utf-8", errors="replace") if raw_txt.exists() else ""
    text = strip_chat(raw)
    out_txt.write_text(text, encoding="utf-8")
    rec = {
        "id": pid,
        "arm": arm,
        "rc": rc,
        "n_predict": n,
        "threads": 8,
        "prio": "Idle",
        "wall_s": round(dt, 2),
        "chars": len(text),
        "sha256": sha256_bytes(text.encode("utf-8")),
        "raw_sha256": sha256_bytes(raw.encode("utf-8")),
        "ts": utc(),
    }
    slog(f"DONE {pid} {arm} rc={rc} chars={len(text)} wall={dt:.1f}s threads=8 prio=Idle")
    return rec


def main() -> None:
    prompts_path = HERE / "prompts.json"
    blob = prompts_path.read_bytes()
    got = sha256_bytes(blob)
    if got != PROMPT_SHA:
        raise SystemExit(f"prompts.json sha mismatch {got} != {PROMPT_SHA}")
    data = json.loads(blob.decode("utf-8"))
    prompts = data["prompts"]
    gen_dir = HERE / "gen"
    gen_dir.mkdir(exist_ok=True)

    for arm, path in ARMS.items():
        gotm = sha256_file(path)
        if gotm != ARM_SHA[arm]:
            raise SystemExit(f"STOP GGUF sha mismatch {arm} {gotm}")
        slog(f"PIN {arm} sha={gotm} size={path.stat().st_size}")

    cli_sha = sha256_file(CLI)
    slog(f"PIN llama-cli.exe sha={cli_sha} size={CLI.stat().st_size}")

    man_path = HERE / "run_manifest.json"
    rows = []
    if man_path.exists():
        rows = json.loads(man_path.read_text(encoding="utf-8")).get("runs", [])
    done = {(r["id"], r["arm"]) for r in rows if r.get("rc") == 0 and r.get("chars", 0) > 0}

    # control then q8_0 per prompt (same prompt consecutive, easier to spot crashes)
    jobs = []
    for pr in prompts:
        for arm in ("control", "q8_0"):
            jobs.append((arm, pr))

    for arm, pr in jobs:
        key = (pr["id"], arm)
        out_txt = gen_dir / f"{pr['id']}__{arm}.txt"
        if key in done and out_txt.exists() and out_txt.stat().st_size > 0:
            continue
        rec = generate(arm, pr["id"], pr["text"], int(pr["n_predict"]), gen_dir)
        rec["cat"] = pr["cat"]
        rec["lang"] = pr["lang"]
        rows.append(rec)
        man_path.write_text(
            json.dumps(
                {
                    "prompt_sha": PROMPT_SHA,
                    "cli": str(CLI),
                    "cli_sha": cli_sha,
                    "seed": 42,
                    "temp": 0,
                    "threads": 8,
                    "threads_note": "first batch used -t 16; remaining use -t 8 Idle + 10s pause (temp-0 outputs unchanged)",
                    "ngl": 0,
                    "prio": "Idle",
                    "arms": ARM_SHA,
                    "runs": rows,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        if rec["rc"] != 0 and rec["chars"] == 0:
            slog(f"HARDFAIL {pr['id']} {arm} rc={rec['rc']}")
            raise SystemExit(2)
        slog("PAUSE 10s between generations")
        time.sleep(10)

    slog(f"ALL_GEN_DONE n={len(rows)}")


if __name__ == "__main__":
    main()
