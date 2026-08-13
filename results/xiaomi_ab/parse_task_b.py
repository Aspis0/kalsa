#!/usr/bin/env python3
"""Parse pulled task_b/runs.csv + per-run logs. Print tables + medians."""
from __future__ import annotations

import csv
import statistics
from pathlib import Path

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab")
CANDIDATES = [ROOT / "task_b", ROOT / "task_b" / "task_b"]


def find_logdir() -> Path:
    for p in CANDIDATES:
        if (p / "runs.csv").is_file():
            return p
    raise SystemExit("no task_b/runs.csv")


def fnum(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def med(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def main() -> None:
    log = find_logdir()
    print(f"LOGDIR={log}")
    rows = list(csv.DictReader((log / "runs.csv").open(encoding="utf-8")))
    print("--- RUNS ---")
    print("| tag | prompt | -t | decode t/s | MiB/tok | hit% | TTFT s | load s | n_gen | batt | temp °C | wall s | rc |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|")
    for r in rows:
        batt = f"{r.get('batt_start','?')}→{r.get('batt_end','?')}"
        temp = f"{r.get('temp_start','?')}→{r.get('temp_end','?')}"
        print(
            f"| {r.get('tag','')} | {r.get('prompt_id','')} | {r.get('threads','')} | "
            f"{r.get('decode_tps','')} | {r.get('mib_per_tok','')} | {r.get('hit_pct','')} | "
            f"{r.get('ttft_s','')} | {r.get('load_s','')} | {r.get('n_gen','')} | "
            f"{batt} | {temp} | {r.get('wall_s','')} | {r.get('rc','')} |"
        )

    t6 = [r for r in rows if r.get("threads") == "6"]
    t4 = [r for r in rows if r.get("threads") == "4"]
    print("--- MEDIANS ---")
    for label, group in (("t6", t6), ("t4", t4)):
        tps = [fnum(r["decode_tps"]) for r in group]
        tps = [x for x in tps if x is not None]
        mib = [fnum(r["mib_per_tok"]) for r in group]
        mib = [x for x in mib if x is not None]
        hit = [fnum(r["hit_pct"]) for r in group]
        hit = [x for x in hit if x is not None]
        ttft = [fnum(r["ttft_s"]) for r in group]
        ttft = [x for x in ttft if x is not None]
        print(
            f"{label} n={len(group)} tps_med={med(tps)} mib_mean="
            f"{(sum(mib)/len(mib) if mib else None)} hit_mean="
            f"{(sum(hit)/len(hit) if hit else None)} ttft_med={med(ttft)}"
        )


if __name__ == "__main__":
    main()
