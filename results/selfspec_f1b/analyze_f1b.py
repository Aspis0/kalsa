#!/usr/bin/env python3
"""Summarise F1b E1/E2/E3 CSVs. No model I/O."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def load(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def rate(rows: list[dict[str, str]], col: str) -> tuple[int, int, float | None]:
    xs = [int(r[col]) for r in rows if r.get(col, "") != ""]
    n = len(xs)
    a = sum(xs)
    return a, n, (a / n) if n else None


def analyse(d: Path) -> dict:
    out: dict = {"dir": str(d)}
    e1 = d / "e1.csv"
    e2 = d / "e2.csv"
    e3 = d / "e3.csv"
    if e1.is_file():
        rows = load(e1)
        dv = rate(rows, "draft_eq_verify")
        dg = rate(rows, "draft_eq_gold")
        vg = rate(rows, "verify_eq_gold")
        out["e1"] = {
            "n": dv[1],
            "draft_eq_verify": dv,
            "draft_eq_gold": dg,
            "verify_eq_gold": vg,
        }
    if e2.is_file():
        rows = load(e2)
        dv = rate(rows, "draft_eq_verify")
        dg = rate(rows, "draft_eq_gold")
        out["e2"] = {
            "n": dv[1],
            "draft_eq_verify": dv,
            "draft_eq_gold": dg,
            "prefill_k": rows[0].get("prefill_k") if rows else None,
            "predict_k": rows[0].get("predict_k") if rows else None,
        }
    if e3.is_file():
        rows = load(e3)
        by_g: dict[str, list] = {}
        for r in rows:
            by_g.setdefault(r["gamma"], []).append(r)
        e3s = {}
        for g, rs in sorted(by_g.items(), key=lambda kv: int(kv[0])):
            agr = rate(rs, "agree")
            deltas = [float(r["max_abs_delta_top2"]) for r in rs if r.get("max_abs_delta_top2")]
            e3s[g] = {
                "agree": agr,
                "max_abs_delta_top2": max(deltas) if deltas else None,
                "mean_abs_delta_top2": (sum(deltas) / len(deltas)) if deltas else None,
            }
        out["e3"] = e3s
    return out


def main() -> int:
    roots = [Path(p) for p in sys.argv[1:]] or [
        Path(__file__).resolve().parent / "longfact",
    ]
    all_out = []
    for d in roots:
        rec = analyse(d)
        all_out.append(rec)
        print(json.dumps(rec, indent=2))
    dest = Path(__file__).resolve().parent / "analysis.json"
    dest.write_text(json.dumps(all_out, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
