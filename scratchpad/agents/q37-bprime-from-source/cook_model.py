#!/usr/bin/env python3
"""Cook KEXP control + trunk variants FROM SOURCE. One model at a time.

Does not write into models/. Outputs under this cell's gguf/<model>/.
Refuses to start if C: free would drop under 40 GiB after the next write.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
QBIN = ROOT / "build-pc-quantize" / "bin" / "llama-quantize.exe"
MIN_FREE = 40 * (1024**3)
NTHREADS = "16"

# ftype: control matches original Marco cook (Q4_K_M + full overrides).
# variants match q36 (ftype = trunk type + expert pins in the recipe).
ARMS = [
    ("control", "Q4_K_M"),
    ("q8_0", "Q8_0"),
    ("iq4_nl", "IQ4_NL"),
    ("q4_0", "Q4_0"),
]


def say(log: Path, msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] {msg}"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def free_bytes() -> int:
    return shutil.disk_usage("C:\\").free


def disk_line(here: Path, phase: str) -> int:
    n = free_bytes()
    disk = here / "DISK_LOG.md"
    if not disk.exists():
        disk.write_text(
            "# q37 disk log\n\n| when | phase | free_bytes | free_GB |\n|---|---|---:|---:|\n",
            encoding="utf-8",
        )
    gb = n / (1024**3)
    with disk.open("a", encoding="utf-8") as f:
        f.write(f"| {time.strftime('%Y-%m-%dT%H:%M:%S')} | {phase} | {n} | {gb:.2f} |\n")
    return n


def require_free(log: Path, here: Path, phase: str, extra_needed: int = 0) -> None:
    n = disk_line(here, phase)
    say(log, f"DISK free_bytes={n} free_GB={n/(1024**3):.2f} phase={phase}")
    if n - extra_needed < MIN_FREE:
        say(log, f"ABORT disk: free {n} extra_needed {extra_needed} min {MIN_FREE}")
        raise SystemExit(9)


MODELS = {
    "marco": {
        "src": HERE / "src" / "Marco-Mini-Instruct.Q8_0.gguf",
        "imatrix": HERE / "src" / "Marco-Mini-Instruct.imatrix.gguf",
        "allow_requant": True,
        "recipe_dir": HERE / "recipes" / "marco",
        "out_prefix": "Marco-Mini-Instruct-KEXP-fromsrc",
        "expect_src": 18356453952,
    },
    "olmoe": {
        "src": HERE / "src" / "olmoe-1b-7b-0924-instruct-q8_0.gguf",
        "imatrix": None,
        "allow_requant": True,
        "recipe_dir": HERE / "recipes" / "olmoe",
        "out_prefix": "OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc",
        "expect_src": 7359943136,
    },
    "lfm": {
        "src": HERE / "src" / "LFM2.5-8B-A1B-Q8_0.gguf",
        "imatrix": ROOT / "models" / "imatrix_lfm25_unsloth.gguf_file",
        "allow_requant": True,
        "recipe_dir": HERE / "recipes" / "lfm",
        "out_prefix": "LFM2.5-8B-A1B-KEXP-fromsrc",
        "expect_src": 9010195680,
    },
}


def run_quantize(cfg: dict, arm: str, ftype: str, dry: bool, log: Path) -> Path:
    recipe = cfg["recipe_dir"] / f"{arm}.txt"
    out_dir = HERE / "gguf" / cfg["key"]
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cfg['out_prefix']}-trunk-{arm}.gguf"
    qlog = HERE / "logs" / f"quantize-{cfg['key']}-{arm}{'-dry' if dry else ''}.log"
    cmd = [str(QBIN)]
    if cfg["allow_requant"]:
        cmd.append("--allow-requantize")
    if dry:
        cmd.append("--dry-run")
    im = cfg["imatrix"]
    if im is not None:
        cmd += ["--imatrix", str(im)]
    cmd += ["--tensor-type-file", str(recipe), str(cfg["src"]), str(out), ftype, NTHREADS]
    say(log, "CMD " + " ".join(cmd))
    env = os.environ.copy()
    bindir = str(QBIN.parent)
    env["PATH"] = bindir + os.pathsep + env.get("PATH", "")
    t0 = time.time()
    with qlog.open("w", encoding="utf-8", errors="replace") as f:
        p = subprocess.run(cmd, cwd=str(ROOT), env=env, stdout=f, stderr=subprocess.STDOUT)
    dt = time.time() - t0
    say(log, f"quantize {cfg['key']}/{arm} dry={dry} rc={p.returncode} wall_s={dt:.1f} log={qlog}")
    if p.returncode != 0:
        raise SystemExit(f"quantize failed rc={p.returncode} see {qlog}")
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cook_model.py marco|olmoe|lfm [control|q8_0|iq4_nl|q4_0 ...]", file=sys.stderr)
        return 2
    key = sys.argv[1]
    arms = sys.argv[2:] or [a for a, _ in ARMS]
    if key not in MODELS:
        print("unknown model", key, file=sys.stderr)
        return 2
    cfg = dict(MODELS[key])
    cfg["key"] = key
    log = HERE / "logs" / f"cook-{key}.log"
    status = HERE / f"COOK_{key.upper()}_STATUS.txt"
    status.write_text("RUNNING\n", encoding="utf-8")
    say(log, f"START cook model={key} arms={arms}")
    if not QBIN.exists():
        say(log, f"FAIL missing {QBIN}")
        return 2
    src = cfg["src"]
    if not src.exists():
        say(log, f"FAIL missing source {src}")
        return 2
    got = src.stat().st_size
    if got != cfg["expect_src"]:
        say(log, f"FAIL source size {got} expected {cfg['expect_src']}")
        return 3
    im = cfg["imatrix"]
    if im is not None and not Path(im).exists():
        say(log, f"FAIL missing imatrix {im}")
        return 2
    require_free(log, HERE, f"pre-cook-{key}")

    ftype_of = dict(ARMS)
    results = []
    for arm in arms:
        if arm not in ftype_of:
            say(log, f"FAIL unknown arm {arm}")
            return 2
        recipe = cfg["recipe_dir"] / f"{arm}.txt"
        if not recipe.exists():
            say(log, f"FAIL missing recipe {recipe}")
            return 2
        require_free(log, HERE, f"pre-{key}-{arm}", extra_needed=0)
        run_quantize(cfg, arm, ftype_of[arm], dry=True, log=log)
        out = run_quantize(cfg, arm, ftype_of[arm], dry=False, log=log)
        if not out.exists():
            say(log, f"FAIL no output {out}")
            return 4
        rec = {"arm": arm, "path": str(out), "bytes": out.stat().st_size}
        results.append(rec)
        say(log, f"OK {key}/{arm} bytes={rec['bytes']}")
        require_free(log, HERE, f"post-{key}-{arm}")
    (HERE / f"COOK_{key.upper()}_RESULT.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    status.write_text("OK\n", encoding="utf-8")
    say(log, f"DONE cook model={key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
