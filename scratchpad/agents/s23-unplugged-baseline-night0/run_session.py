#!/usr/bin/env python3
"""Correctness gate + ABBA speed matrix for s23-unplugged-baseline-night0."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import launch_one as L

CELL = Path(__file__).resolve().parent
RAW = CELL / "raw"
WALL_S = 2 * 3600
S3 = "/data/local/tmp/s3oracle"
KEXP = "/data/local/tmp/Marco-Mini-Instruct-KEXP.gguf"
OLMOE = "/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf"

PINNED = {
    "test-backend-ops": "9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc",
    "llama-bench": "b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c",
    "libllama-bench-impl.so": "8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807",
    "libggml-opencl.so": "f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d",
    "libggml.so": "3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27",
    "libggml-base.so": "ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c",
    "libggml-cpu.so": "fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da",
    "libllama.so": "f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d",
    "libllama-common.so": "e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200",
    "libc++_shared.so": "e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6",
    "libomp.so": "ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0",
    "OLMoE": "3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe",
    "KEXP": "2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777",
}

SETUP = f"cd {S3}\nexport LD_LIBRARY_PATH={S3}\n"
ABBA = ("A", "C", "C", "A")
PAIRINGS = [
    ("kexp", KEXP, "tg128", 0, 128),
    ("kexp", KEXP, "pp512", 512, 0),
    ("olmoe", OLMOE, "tg128", 0, 128),
    ("olmoe", OLMOE, "pp512", 512, 0),
]
NGL = {"A": 99, "C": 0}


def log(msg: str) -> None:
    line = time.strftime("%Y-%m-%dT%H:%M:%S") + " " + msg
    print(line, flush=True)
    with (CELL / "RUN_LOG.md").open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(line + "\n")


def parse_jsonl(text: str) -> dict | None:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("{") and "avg_ts" in line:
            return json.loads(line)
    return None


def load_time_s(stderr: str, wall_s: float, avg_ns: float | None) -> float | None:
    m = re.search(r"load time\s*=\s*([\d.]+)\s*ms", stderr, re.I)
    if m:
        return round(float(m.group(1)) / 1000.0, 3)
    m = re.search(r"loaded in\s+([\d.]+)\s*(ms|s)", stderr, re.I)
    if m:
        v = float(m.group(1))
        return round(v / 1000.0 if m.group(2).lower() == "ms" else v, 3)
    if avg_ns is not None:
        return round(max(0.0, wall_s - avg_ns / 1e9), 3)
    return None


def write_manifest(rows: list) -> None:
    (CELL / "manifest.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def load_manifest() -> list:
    path = CELL / "manifest.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def cool_start(wall_end: float, label: str) -> dict:
    log(f"cool-start wait for {label} (gate <=32C)")
    while True:
        if time.time() >= wall_end:
            raise SystemExit("WALL: 2h cap during cool-start")
        L.ensure_transport(time.monotonic() + 600)
        snap = L.battery()
        if L.plugged(snap):
            raise SystemExit("PLUG_FAILURE during cool-start")
        if snap.get("level") is not None and int(snap["level"]) < 45:
            raise SystemExit(f"BATTERY_FLOOR during cool-start: {snap['level']}%")
        t = snap.get("temperature_tenths")
        log(f"  poll level={snap.get('level')} temp={None if t is None else t / 10:.1f}C")
        if t is not None and int(t) <= 320:
            return snap
        time.sleep(15)


def cmd_ops(op: str) -> str:
    return SETUP + f"exec taskset ff ./test-backend-ops -o {op}\n"


# b11304 renamed llama-bench's -nr to --repack <0|1>; the emitted cell script picks the spelling from --help.
def cmd_bench(model: str, ngl: int, p: int, n: int) -> str:
    return (
        SETUP
        + "if ./llama-bench --help 2>&1 | grep -q -e '--repack'; then NR='--repack 0'; else NR='-nr'; fi\n"
        + "exec taskset ff ./llama-bench"
        + f" -m {model} -p {p} -n {n} -r 1 --no-warmup -t 8 -o jsonl"
        + f" -ngl {ngl} $NR -fa off\n"
    )


def stamp(row: dict, extra: dict) -> dict:
    out = {
        **row,
        **extra,
        "unplugged_declared": True,
        "ac": False,
        "pinned_sha": PINNED,
        "cool_start_class": "cool",
        "guard": {"warn_c": 40, "kill_c": 43, "poll_s": 10},
    }
    return out


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    wall_end = time.time() + WALL_S
    rows: list = load_manifest()
    try:
        return _run(wall_end, rows)
    except SystemExit as exc:
        log(f"STOP SystemExit: {exc}")
        write_manifest(rows)
        s = str(exc)
        if "BATTERY_FLOOR" in s or "WALL" in s:
            return 0
        return 1


def _run(wall_end: float, rows: list) -> int:
    log(f"RESUME serial={L.SERIAL} loaded_manifest_rows={len(rows)}; skip correctness (already PASS)")
    L.ensure_transport()
    L.shell(f"mkdir -p {L.REMOTE_DIR}", timeout=15)
    L.adb(["push", str(CELL / "run_guarded.sh"), L.REMOTE_SCRIPT], timeout=30)
    L.shell(f"chmod 755 {L.REMOTE_SCRIPT}", timeout=10)

    completed_blocks: list[str] = []
    for model_id, model, wl, p, n in PAIRINGS:
        for blk in (1, 2, 3):
            block_id = f"{model_id}_{wl}_b{blk}"
            good = [
                r
                for r in rows
                if r.get("kind") == "speed"
                and r.get("model") == model_id
                and r.get("workload") == wl
                and r.get("block") == blk
                and r.get("avg_ts") is not None
                and r.get("launcher_exit") == 0
            ]
            if len(good) == 4:
                completed_blocks.append(block_id)
                log(f"SKIP {block_id} already complete")
                continue
            if time.time() >= wall_end:
                log(f"WALL before {block_id}; completed_blocks={completed_blocks}")
                write_manifest(rows)
                return 0
            try:
                cool_start(wall_end, block_id)
            except SystemExit as exc:
                log(str(exc))
                write_manifest(rows)
                return 0 if "BATTERY_FLOOR" in str(exc) or "WALL" in str(exc) else 1
            block_rows = []
            invalid = False
            for i, arm in enumerate(ABBA, start=1):
                tag = f"{block_id}_{i}_{arm}"
                if time.time() >= wall_end:
                    log(f"WALL mid-block {block_id}; block invalid")
                    invalid = True
                    break
                log(f"START {tag} ngl={NGL[arm]} {wl}")
                row = L.launch(tag, cmd_bench(model, NGL[arm], p, n), 600)
                stdout = (RAW / f"{tag}.out").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.out").exists() else ""
                stderr = (RAW / f"{tag}.err").read_text(encoding="utf-8", errors="replace") if (RAW / f"{tag}.err").exists() else ""
                bench = parse_jsonl(stdout)
                avg_ts = None if bench is None else bench.get("avg_ts")
                avg_ns = None if bench is None else bench.get("avg_ns")
                rec = stamp(
                    row,
                    {
                        "kind": "speed",
                        "model": model_id,
                        "model_path": model,
                        "workload": wl,
                        "arm": arm,
                        "block": blk,
                        "n_prompt": p,
                        "n_gen": n,
                        "ngl": NGL[arm],
                        "avg_ts": avg_ts,
                        "avg_ns": avg_ns,
                        "load_time_s": load_time_s(stderr, float(row.get("wall_s") or 0), avg_ns),
                        "bench": bench,
                    },
                )
                rows.append(rec)
                block_rows.append(rec)
                write_manifest(rows)
                log(
                    f"END {tag} ts={avg_ts} load={rec['load_time_s']} rc={row.get('workload_rc')} "
                    f"abort={row.get('abort')} cpuset_fail={row.get('cpuset_fail')}"
                )
                if row.get("abort") == "PLUG_FAILURE":
                    log("PLUG_FAILURE: running block invalid; stop")
                    write_manifest(rows)
                    return 1
                if row.get("abort") == "BATTERY_FLOOR":
                    log("BATTERY_FLOOR: running block invalid; completed blocks kept")
                    write_manifest(rows)
                    return 0
                if row.get("cpuset_fail") or row.get("failure_signature") or row.get("launcher_exit") not in (0,) or avg_ts is None:
                    log(f"STOP on {tag}: exit={row.get('launcher_exit')} sig={row.get('failure_signature')} ts={avg_ts}")
                    invalid = True
                    write_manifest(rows)
                    return 1
            if not invalid and len(block_rows) == 4:
                completed_blocks.append(block_id)
                log(f"BLOCK_OK {block_id}")
    log(f"MATRIX_DONE blocks={completed_blocks}")
    write_manifest(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
