#!/usr/bin/env python3
"""Decode-only MoE peakiness from a bmoe-cli --route-trace CSV.

Columns (name-based; extra columns such as dropped are ignored):
  turn,phase,step,layer,slot,expert,weight,residency,expert_bytes

phase 1 = decode. Per (step, layer) cell:
  top1 = max finite weight, share = top1 / sum(finite weights)
Hist: P(share >= 0.50 / 0.70 / 0.85).
experts_equivalent at thr: 1 if share >= thr else n_slots (skip extras when peaky).

Stdlib only. Does not invent a route CSV — refuse if the input is missing.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

THRESHOLDS: tuple[float, ...] = (0.50, 0.70, 0.85)
PHASE_DECODE = 1
REQUIRED = (
    "turn",
    "phase",
    "step",
    "layer",
    "slot",
    "expert",
    "weight",
    "residency",
    "expert_bytes",
)


def _finite(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() == "nan":
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = (len(sorted_vals) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


def read_route_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    """Return data rows (dicts by column name) and preamble comment lines."""
    preamble: list[str] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("#"):
            preamble.append(line.rstrip("\n"))
            continue
        if line.strip() == "":
            continue
        data_lines.append(line)
    if not data_lines:
        return [], preamble
    reader = csv.DictReader(io.StringIO("\n".join(data_lines)))
    if reader.fieldnames is None:
        return [], preamble
    names = [n.strip() for n in reader.fieldnames]
    missing = [c for c in REQUIRED if c not in names]
    if missing:
        # Positional fallback for a headerless dump of the nine documented columns.
        first = data_lines[0].split(",")
        if len(first) >= 9 and data_lines[0].split(",")[0].strip() != "turn":
            rows: list[dict[str, str]] = []
            for line in data_lines:
                parts = line.split(",")
                if len(parts) < 9:
                    continue
                rows.append({REQUIRED[i]: parts[i].strip() for i in range(9)})
            return rows, preamble
        raise ValueError(f"route CSV missing columns {missing}; have {names}")
    rows = []
    for raw in reader:
        rows.append({k.strip(): (v.strip() if isinstance(v, str) else "") for k, v in raw.items() if k})
    return rows, preamble


def decode_cells(rows: list[dict[str, str]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Group DECODE rows by (step, layer). Skip cells with no finite weights."""
    grouped: dict[tuple[int, int], list[float]] = defaultdict(list)
    stats = {
        "n_rows_total": len(rows),
        "n_decode_rows": 0,
        "n_prefill_rows": 0,
        "n_other_phase_rows": 0,
        "n_bad_rows": 0,
        "n_cells_skipped_no_weight": 0,
    }
    for row in rows:
        phase = _as_int(row.get("phase"))
        if phase is None:
            stats["n_bad_rows"] += 1
            continue
        if phase == 0:
            stats["n_prefill_rows"] += 1
            continue
        if phase != PHASE_DECODE:
            stats["n_other_phase_rows"] += 1
            continue
        step = _as_int(row.get("step"))
        layer = _as_int(row.get("layer"))
        if step is None or layer is None:
            stats["n_bad_rows"] += 1
            continue
        stats["n_decode_rows"] += 1
        weight = _finite(row.get("weight"))
        if weight is None:
            continue
        grouped[(step, layer)].append(weight)

    cells: list[dict[str, Any]] = []
    for (step, layer), weights in sorted(grouped.items()):
        if not weights:
            stats["n_cells_skipped_no_weight"] += 1
            continue
        total = float(sum(weights))
        top1 = float(max(weights))
        share = (top1 / total) if total > 0.0 else None
        if share is None:
            stats["n_cells_skipped_no_weight"] += 1
            continue
        cells.append(
            {
                "step": step,
                "layer": layer,
                "n_slots": len(weights),
                "top1": top1,
                "sum": total,
                "share": share,
            }
        )
    return cells, stats


def experts_equivalent(share: float, n_slots: int, thr: float) -> int:
    """Skip extras when top-1 share is at least thr; otherwise keep every slot."""
    if share >= thr:
        return 1
    return n_slots


def compute_peakiness(cells: list[dict[str, Any]], stats: dict[str, int], source: str) -> dict[str, Any]:
    n = len(cells)
    shares = [float(c["share"]) for c in cells]
    shares_sorted = sorted(shares)
    hist: dict[str, float | None] = {}
    eq: dict[str, Any] = {}
    for thr in THRESHOLDS:
        key = f"{thr:.2f}"
        if n == 0:
            hist[f"p_share_ge_{key}"] = None
            eq[key] = {
                "threshold": thr,
                "mean": None,
                "n_skip_extras": 0,
                "rule": "1 if share>=thr else n_slots",
            }
            continue
        n_ge = sum(1 for s in shares if s >= thr)
        hist[f"p_share_ge_{key}"] = n_ge / n
        vals = [experts_equivalent(float(c["share"]), int(c["n_slots"]), thr) for c in cells]
        eq[key] = {
            "threshold": thr,
            "mean": sum(vals) / n,
            "n_skip_extras": n_ge,
            "rule": "1 if share>=thr else n_slots",
        }
    mean_share = (sum(shares) / n) if n else None
    slot_set = sorted({int(c["n_slots"]) for c in cells})
    return {
        "source": source,
        "phase": "decode",
        "phase_code": PHASE_DECODE,
        "thresholds": list(THRESHOLDS),
        "n_decode_cells": n,
        "n_slots_observed": slot_set,
        "share": {
            "mean": mean_share,
            "median": _percentile(shares_sorted, 0.50),
            "p10": _percentile(shares_sorted, 0.10),
            "p90": _percentile(shares_sorted, 0.90),
            "min": shares_sorted[0] if shares_sorted else None,
            "max": shares_sorted[-1] if shares_sorted else None,
        },
        "hist": hist,
        "experts_equivalent": eq,
        "row_stats": stats,
    }


def analyze_file(path: Path) -> dict[str, Any]:
    rows, preamble = read_route_rows(path)
    cells, stats = decode_cells(rows)
    out = compute_peakiness(cells, stats, source=str(path))
    out["preamble_lines"] = len(preamble)
    return out


def _self_test() -> None:
    import tempfile

    sample = (
        "# route_trace v1\n"
        "turn,phase,step,layer,slot,expert,weight,residency,expert_bytes\n"
        "0,1,10,2,0,3,0.90,1,0\n"
        "0,1,10,2,1,4,0.05,1,0\n"
        "0,1,10,2,2,5,0.05,1,0\n"
        "0,1,11,2,0,3,0.40,1,0\n"
        "0,1,11,2,1,4,0.30,1,0\n"
        "0,1,11,2,2,5,0.30,1,0\n"
        "0,0,1,2,0,3,0.99,1,0\n"
        "0,1,12,2,0,3,nan,1,0\n"
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "route.csv"
        path.write_text(sample, encoding="utf-8")
        rows, preamble = read_route_rows(path)
    assert len(preamble) == 1, preamble
    cells, stats = decode_cells(rows)
    assert stats["n_decode_rows"] == 7, stats
    assert stats["n_prefill_rows"] == 1, stats
    assert len(cells) == 2, cells
    by_step = {c["step"]: c for c in cells}
    assert abs(float(by_step[10]["share"]) - 0.90) < 1e-12
    assert abs(float(by_step[11]["share"]) - 0.40) < 1e-12
    result = compute_peakiness(cells, stats, source="self-test")
    hist = result["hist"]
    assert hist["p_share_ge_0.50"] == 0.5
    assert hist["p_share_ge_0.70"] == 0.5
    assert hist["p_share_ge_0.85"] == 0.5
    eq = result["experts_equivalent"]
    assert abs(float(eq["0.50"]["mean"]) - 2.0) < 1e-12
    assert abs(float(eq["0.70"]["mean"]) - 2.0) < 1e-12
    assert abs(float(eq["0.85"]["mean"]) - 2.0) < 1e-12
    assert eq["0.85"]["n_skip_extras"] == 1
    assert experts_equivalent(0.85, 6, 0.85) == 1
    assert experts_equivalent(0.849, 6, 0.85) == 6


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Decode-only route-trace peakiness")
    parser.add_argument(
        "route_csv",
        nargs="?",
        default="",
        help="route_k6.csv from cell A (default: ./A/route_k6.csv next to this script)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="",
        help="peakiness.json (default: ./peakiness.json next to this script)",
    )
    parser.add_argument("--self-test", action="store_true", help="run synthetic assertions and exit")
    args = parser.parse_args(argv)

    if args.self_test:
        _self_test()
        print("SELF_TEST_OK")
        return 0

    here = Path(__file__).resolve().parent
    src = Path(args.route_csv) if args.route_csv else here / "A" / "route_k6.csv"
    dest = Path(args.output) if args.output else here / "peakiness.json"
    if not src.is_file():
        print(f"error: route CSV not found: {src} (no invented peakiness.json)", file=sys.stderr)
        return 2
    result = analyze_file(src)
    dest.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {dest} n_decode_cells={result['n_decode_cells']}")
    return 0 if int(result["n_decode_cells"]) > 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())
