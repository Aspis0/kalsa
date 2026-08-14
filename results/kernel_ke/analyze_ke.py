#!/usr/bin/env python3
"""Summarize KERNEL K-E runs.csv into A/B deltas and a verdict."""
from __future__ import annotations

import csv
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV = ROOT / "runs.csv"


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def med(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return statistics.median(xs)


def pct(new, old):
    if new is None or old is None or old == 0:
        return None
    return 100.0 * (new - old) / old


def fmt(x, nd=3):
    return "n/a" if x is None else f"{x:.{nd}f}"


def main():
    if not CSV.exists():
        print("NO_CSV")
        return
    rows = list(csv.DictReader(CSV.open(encoding="utf-8", newline="")))

    def grab(prefix, arch, field):
        return [f(r.get(field)) for r in rows if r.get("cell", "").startswith(prefix) and r.get("arch") == arch]

    # Class 1 cold mellum
    a_wall = med(grab("c1_A", "dotprod", "decode_toks"))
    b_wall = med(grab("c1_B", "i8mm", "decode_toks"))
    a_cpu = med(grab("c1_A", "dotprod", "cpu_s_tok"))
    b_cpu = med(grab("c1_B", "i8mm", "cpu_s_tok"))
    a_j = med(grab("c1_A", "dotprod", "joule_tok"))
    b_j = med(grab("c1_B", "i8mm", "joule_tok"))
    a_comp = med(grab("c1_A", "dotprod", "compute_s_tok"))
    b_comp = med(grab("c1_B", "i8mm", "compute_s_tok"))

    d_cpu = pct(b_cpu, a_cpu)
    d_j = pct(b_j, a_j)
    d_wall = pct(b_wall, a_wall)

    # Sustained late reps = last 2 of each block
    def last2(prefix, arch, field):
        vals = [(r.get("cell"), f(r.get(field))) for r in rows if r.get("cell", "").startswith(prefix) and r.get("arch") == arch]
        vals.sort(key=lambda x: x[0])
        return [v for _, v in vals[-2:]]

    a_late = med(last2("c2_A", "dotprod", "decode_toks"))
    b_late = med(last2("c2_B", "i8mm", "decode_toks"))
    a_t0 = med(grab("c2_A", "dotprod", "batt_temp_start"))
    a_t1 = med(grab("c2_A", "dotprod", "batt_temp_end"))
    b_t0 = med(grab("c2_B", "i8mm", "batt_temp_start"))
    b_t1 = med(grab("c2_B", "i8mm", "batt_temp_end"))
    a_dT = None if a_t0 is None or a_t1 is None else a_t1 - a_t0
    b_dT = None if b_t0 is None or b_t1 is None else b_t1 - b_t0
    d_late = pct(b_late, a_late)
    d_temp = None if a_dT is None or b_dT is None else b_dT - a_dT  # negative = i8mm cooler rise

    print(f"c1_wall A={fmt(a_wall)} B={fmt(b_wall)} d%={fmt(d_wall,1)}")
    print(f"c1_compute A={fmt(a_comp,4)} B={fmt(b_comp,4)}")
    print(f"c1_cpu/tok A={fmt(a_cpu,5)} B={fmt(b_cpu,5)} d%={fmt(d_cpu,1)}")
    print(f"c1_J/tok A={fmt(a_j,5)} B={fmt(b_j,5)} d%={fmt(d_j,1)}")
    print(f"c2_late_wall A={fmt(a_late)} B={fmt(b_late)} d%={fmt(d_late,1)}")
    print(f"c2_dT A={fmt(a_dT,2)} B={fmt(b_dT,2)} B-A={fmt(d_temp,2)}")

    # Verdict
    cpu_win = d_cpu is not None and d_cpu <= -15.0
    wall_ok = d_wall is None or d_wall >= -3.0
    late_better = d_late is not None and d_late > 0
    cooler = d_temp is not None and d_temp <= -2.0
    any_eff = (d_cpu is not None and d_cpu <= -5.0) or (d_j is not None and d_j <= -5.0)
    null = (d_cpu is None or abs(d_cpu) < 3.0) and (d_j is None or abs(d_j) < 3.0)

    if cpu_win and wall_ok and (late_better or cooler):
        verd = "KE_WINS(thermal)"
    elif null:
        verd = "KE_NULL"
    elif any_eff:
        verd = "KE_NEUTRAL"
    else:
        verd = "KE_NULL"

    first = (
        f"{verd} · CPU-time/token {fmt(d_cpu,1)}% · J/token {fmt(d_j,1)}% · "
        f"sustained late-rep wall {fmt(d_late,1)}%"
    )
    print("VERDICT_LINE=" + first)
    out = ROOT / "verdict.txt"
    out.write_text(first + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
