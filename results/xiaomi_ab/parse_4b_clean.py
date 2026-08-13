#!/usr/bin/env python3
"""Parse pulled task_a_4b_clean llama-bench JSON + TTFT logs. Print markdown tables."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab")
# adb pull of a dir into an existing dest may nest once
CANDIDATES = [
    ROOT / "task_a_4b_clean",
    ROOT / "task_a_4b_clean" / "task_a_4b_clean",
]


def find_logdir() -> Path:
    for p in CANDIDATES:
        if (p / "status.txt").is_file() or list(p.glob("bench_4b_*.json")):
            return p
    raise SystemExit("no task_a_4b_clean logs found")


def load_bench(path: Path) -> dict | None:
    if not path.is_file() or path.stat().st_size == 0:
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data:
        return None
    return data[0]


def fmt_samples(row: dict) -> str:
    return ", ".join(f"{x:.3f}" for x in row["samples_ts"])


def main() -> None:
    log = find_logdir()
    print(f"LOGDIR={log}")
    print("--- BENCH ---")
    print("| pp | CPU t/s | CPU samples | GPU t/s | GPU samples | GPU/CPU | JSON |")
    print("|---:|--------:|-------------|--------:|-------------|--------:|---|")
    for pp in (512, 1024, 2048):
        cpu = load_bench(log / f"bench_4b_cpu_pp{pp}.json")
        gpu = load_bench(log / f"bench_4b_gpu_pp{pp}.json")
        if not cpu or not gpu:
            print(f"| {pp} | MISSING |  | MISSING |  |  | {log.name} |")
            continue
        ratio = gpu["avg_ts"] / cpu["avg_ts"]
        print(
            f"| {pp} | {cpu['avg_ts']:.3f} | {fmt_samples(cpu)} | "
            f"{gpu['avg_ts']:.3f} | {fmt_samples(gpu)} | **{ratio:.2f}×** | "
            f"task_a_4b_clean/bench_4b_*_pp{pp}.json |"
        )
        cpu_s = cpu["avg_ns"] / 1e9
        gpu_s = gpu["avg_ns"] / 1e9
        print(f"  wall implied pp{pp}: CPU {cpu_s:.3f}s GPU {gpu_s:.3f}s saved {cpu_s-gpu_s:.2f}s")

    print("--- TTFT ---")
    pat = re.compile(r"\[\s*Prompt:\s*([0-9.]+)\s*t/s\s*\|\s*Generation:\s*([0-9.]+)\s*t/s\s*\]")
    wall_pat = re.compile(r"END llama-cli (\S+) EXIT=(\d+) wall_s=(\d+)")
    status = (log / "status.txt").read_text(encoding="utf-8", errors="replace") if (log / "status.txt").is_file() else ""
    walls = {m.group(1): m.group(3) for m in wall_pat.finditer(status)}
    for name in (
        "ttft_4b_cpu_rep1",
        "ttft_4b_gpu_rep2",
        "ttft_4b_gpu_rep3",
        "ttft_4b_cpu_rep4",
    ):
        out = log / f"{name}.out"
        text = out.read_text(encoding="utf-8", errors="replace") if out.is_file() else ""
        m = pat.search(text)
        cell = "CPU" if "_cpu_" in name else "GPU"
        if not m:
            print(f"{name} cell={cell} MISSING Prompt line wall={walls.get(name, '?')}")
            continue
        print(
            f"{name} cell={cell} Prompt={m.group(1)} Gen={m.group(2)} "
            f"wall_s={walls.get(name, '?')}"
        )

    print("--- STATUS TAIL ---")
    print("\n".join(status.strip().splitlines()[-8:]))


if __name__ == "__main__":
    main()
