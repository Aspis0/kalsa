#!/usr/bin/env python3
"""Compute pre-declared marathon readouts from on-disk CSVs. No invented numbers."""
from __future__ import annotations

import csv
import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CAPACITY_MAH = 3785.0
VOLTAGE_V = 3.85
# Owner-declared proxy (note: uses 3600, not the physical 3.6 = 3600/1000).
# Relative A/B is invariant to that constant.
J_FACTOR = CAPACITY_MAH * VOLTAGE_V * 3600.0 / 100.0
# Physically-correct Joules (mAh * V * 3.6): documented, not used for the verdict.
J_PHYSICAL = CAPACITY_MAH * VOLTAGE_V * 3.6 / 100.0


def fnum(s: str):
    s = (s or "").strip()
    if s == "" or s.upper() == "NA":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def thirds(values: list[float]) -> tuple[float | None, float | None, float | None]:
    """Mean of first third, mean of final third, overall mean. None if empty."""
    n = len(values)
    if n == 0:
        return None, None, None
    k = max(1, n // 3)
    first = values[:k]
    final = values[-k:]
    return (
        sum(first) / len(first),
        sum(final) / len(final),
        sum(values) / n,
    )


def load_segments(path: pathlib.Path) -> dict[str, list[dict]]:
    arms: dict[str, list[dict]] = {}
    if not path.is_file():
        return arms
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            arm = row.get("arm") or ""
            tps = fnum(row.get("t/s") or row.get("gen_tps") or "")
            rec = {
                "segment": int(fnum(row.get("segment") or "0") or 0),
                "tps": tps,
                "batt": fnum(row.get("batt%") or row.get("batt_end") or ""),
                "temp": fnum(row.get("temp") or row.get("temp_end") or ""),
            }
            arms.setdefault(arm, []).append(rec)
    for arm in arms:
        arms[arm].sort(key=lambda r: r["segment"])
    return arms


def load_batt_series(path: pathlib.Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out.append(
                {
                    "ts": row.get("ts"),
                    "phase": row.get("phase"),
                    "batt": fnum(row.get("batt_pct") or ""),
                    "temp": fnum(row.get("temp_c") or ""),
                }
            )
    return out


def arm_energy(detail_path: pathlib.Path, arm: str) -> dict:
    """J/token proxy from first/last batt% in the arm and sum of n_eval."""
    if not detail_path.is_file():
        return {}
    rows = []
    with detail_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("arm") != arm:
                continue
            rows.append(row)
    if not rows:
        return {}
    b0 = fnum(rows[0].get("batt_start") or "")
    b1 = fnum(rows[-1].get("batt_end") or "")
    tokens = 0.0
    for r in rows:
        n = fnum(r.get("n_eval") or "")
        if n is not None:
            tokens += n
    drop = None
    if b0 is not None and b1 is not None:
        drop = b0 - b1
    j_proxy = None
    j_phys = None
    if drop is not None and tokens > 0:
        j_proxy = (drop * J_FACTOR) / tokens
        j_phys = (drop * J_PHYSICAL) / tokens
    return {
        "batt_start": b0,
        "batt_end": b1,
        "batt_drop_pp": drop,
        "tokens": tokens,
        "j_per_token_declared_proxy": j_proxy,
        "j_per_token_physical": j_phys,
    }


def peak_temp(series: list[dict]) -> float | None:
    temps = [r["temp"] for r in series if r["temp"] is not None]
    return max(temps) if temps else None


def main() -> int:
    segs = load_segments(HERE / "segments.csv")
    detail = HERE / "segments_detail.csv"
    out: dict = {"source": str(HERE / "segments.csv"), "arms": {}}
    for arm in ("ARM_CPU", "ARM_GPU"):
        recs = segs.get(arm, [])
        tps = [r["tps"] for r in recs if r["tps"] is not None]
        first, final, mean = thirds(tps)
        batt_csv = HERE / f"battery_{arm}.csv"
        series = load_batt_series(batt_csv)
        energy = arm_energy(detail, arm)
        out["arms"][arm] = {
            "n_segments": len(recs),
            "n_timed": len(tps),
            "curve": recs,
            "mean_first_third_tps": first,
            "mean_final_third_tps": final,
            "mean_all_tps": mean,
            "throttle_ratio_final_over_first": (
                (final / first) if first and first > 0 and final is not None else None
            ),
            "peak_batt_temp_c": peak_temp(series),
            "energy": energy,
        }

    cpu_f = out["arms"]["ARM_CPU"]["mean_final_third_tps"]
    gpu_f = out["arms"]["ARM_GPU"]["mean_final_third_tps"]
    if cpu_f is None or gpu_f is None:
        winner = "INCOMPLETE"
        reason = "missing final-third mean on one or both arms"
    elif gpu_f > cpu_f:
        winner = "GPU"
        reason = f"GPU final-third {gpu_f:.3f} > CPU final-third {cpu_f:.3f}"
    elif cpu_f > gpu_f:
        winner = "CPU"
        reason = f"CPU final-third {cpu_f:.3f} > GPU final-third {gpu_f:.3f}"
    else:
        winner = "TIE"
        reason = f"final-third means equal {cpu_f:.3f}"
    out["sustained_winner"] = winner
    out["sustained_reason"] = reason

    cpu_j = out["arms"]["ARM_CPU"]["energy"].get("j_per_token_declared_proxy")
    gpu_j = out["arms"]["ARM_GPU"]["energy"].get("j_per_token_declared_proxy")
    if cpu_j is None or gpu_j is None:
        energy_winner = "INCOMPLETE"
    elif gpu_j < cpu_j:
        energy_winner = "GPU"
    elif cpu_j < gpu_j:
        energy_winner = "CPU"
    else:
        energy_winner = "TIE"
    out["energy_winner"] = energy_winner

    dest = HERE / "summary.json"
    dest.write_text(json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
