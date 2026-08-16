#!/usr/bin/env python3
"""Wilcoxon signed-rank on the registered 12 (OFF-ON) pairs.

Does not replace analyze_kf_reality.py. Pairing is the PREREG ABBA rule:
within each quartet (OFF ON ON OFF), pairs are (b1,b2) and (b4,b3).
"""
from __future__ import annotations

import csv
import statistics
import sys
from pathlib import Path


def _f(v: str | None) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _i(v: str | None) -> int | None:
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def kept_by_idx(rows: list[dict[str, str]]) -> dict[int, dict[str, str]]:
    """Last excluded=0 row wins per order_idx (retries append)."""
    out: dict[int, dict[str, str]] = {}
    for r in rows:
        if str(r.get("excluded", "1")).strip() != "0":
            continue
        oi = _i(r.get("order_idx"))
        if oi is None:
            continue
        out[oi] = r
    return out


def registered_pairs(kept: dict[int, dict[str, str]]) -> list[tuple[int, int, dict[str, str], dict[str, str]]]:
    pairs = []
    for q in range(6):
        base = q * 4
        for off_i, on_i in ((base + 1, base + 2), (base + 4, base + 3)):
            if off_i in kept and on_i in kept:
                pairs.append((off_i, on_i, kept[off_i], kept[on_i]))
    return pairs


def _rankdata(xs: list[float]) -> list[float]:
    n = len(xs)
    order = sorted(range(n), key=lambda i: xs[i])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = 0.5 * ((i + 1) + (j + 1))
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def wilcoxon_exact_two_sided(diffs: list[float]) -> tuple[float, float, int]:
    """Classic W = min(W+, W-); exact two-sided p via sign permutation.

    Zero diffs are dropped. Returns (W, p, n_eff).
    """
    nz = [d for d in diffs if d != 0.0]
    n = len(nz)
    if n == 0:
        return 0.0, 1.0, 0
    ranks = _rankdata([abs(d) for d in nz])
    w_pos = sum(r for d, r in zip(nz, ranks) if d > 0)
    w_neg = sum(r for d, r in zip(nz, ranks) if d < 0)
    w = min(w_pos, w_neg)
    w_signed = sum((1.0 if d > 0 else -1.0) * r for d, r in zip(nz, ranks))
    total = 1 << n
    count = 0
    for mask in range(total):
        acc = 0.0
        for i, r in enumerate(ranks):
            acc += r if (mask >> i) & 1 else -r
        if abs(acc) + 1e-12 >= abs(w_signed):
            count += 1
    return w, count / total, n


def hodges_lehmann(diffs: list[float]) -> float:
    n = len(diffs)
    if n == 0:
        return float("nan")
    walsh = [0.5 * (diffs[i] + diffs[j]) for i in range(n) for j in range(i, n)]
    return float(statistics.median(walsh))


def exact_floor(n_eff: int) -> float:
    if n_eff <= 0:
        return 1.0
    return 2.0 / float(1 << n_eff)


def analyze(csv_path: Path) -> str:
    with csv_path.open(encoding="utf-8", errors="replace", newline="") as f:
        rows = list(csv.DictReader(f))
    kept = kept_by_idx(rows)
    pairs = registered_pairs(kept)
    lines: list[str] = []
    lines.append("# KF COLD Jelly — registered Wilcoxon (OFF − ON)")
    lines.append("")
    lines.append(f"Kept blocks (excluded=0): {len(kept)} / 24")
    lines.append(f"Complete registered pairs: {len(pairs)} (need ≥ 10)")
    lines.append("")
    lines.append("| pair | OFF blk | ON blk | OFF s/tok | ON s/tok | OFF−ON |")
    lines.append("| ---: | ---: | ---: | ---: | ---: | ---: |")
    diffs: list[float] = []
    offs: list[float] = []
    ons: list[float] = []
    for off_i, on_i, ro, rn in pairs:
        vo = _f(ro.get("wall_s_tok"))
        vn = _f(rn.get("wall_s_tok"))
        if vo is None or vn is None:
            lines.append(f"| — | {off_i} | {on_i} | {vo} | {vn} | missing |")
            continue
        d = vo - vn
        diffs.append(d)
        offs.append(vo)
        ons.append(vn)
        lines.append(f"| {len(diffs)} | {off_i} | {on_i} | {vo:.4f} | {vn:.4f} | {d:+.4f} |")
    lines.append("")
    n_pairs = len(diffs)
    if n_pairs == 0:
        lines.append("No numeric pairs.")
        return "\n".join(lines) + "\n"
    w, p, n_eff = wilcoxon_exact_two_sided(diffs)
    floor = exact_floor(n_eff)
    mean_off = sum(offs) / n_pairs
    mean_on = sum(ons) / n_pairs
    pct = 100.0 * (mean_on - mean_off) / mean_off if mean_off else float("nan")
    hl = hodges_lehmann(diffs)
    n_pos = sum(1 for d in diffs if d > 0)
    n_neg = sum(1 for d in diffs if d < 0)
    n_tie = sum(1 for d in diffs if d == 0)
    lines.append("## Test")
    lines.append("")
    lines.append(f"- N pairs = {n_pairs}; ties dropped → **effective N = {n_eff}**")
    lines.append(f"- exact-test floor for that N = **{floor:.6g}** (`2/2^{n_eff}`)")
    lines.append(f"- Wilcoxon exact two-sided: **W={w:g} p={p:.6g}**")
    lines.append(f"- mean OFF={mean_off:.4f} ON={mean_on:.4f} → ON vs OFF **{pct:+.1f}%**")
    lines.append(f"- Hodges–Lehmann shift (OFF−ON) = {hl:.6f} s/tok")
    lines.append(f"- signs: ON faster {n_pos} / ON slower {n_neg} / ties {n_tie}")
    lines.append("")
    if n_pairs < 10:
        lines.append("Confirmatory claim **not licensed** (N < 10).")
    elif p < 0.05 and mean_on < mean_off:
        lines.append("Decision: **significant in the registered direction** (ON < OFF).")
    elif p < 0.05:
        lines.append("Decision: **significant in the OPPOSITE direction** (ON > OFF).")
    else:
        lines.append("Decision: **not significant** at alpha 0.05 (null).")
    lines.append("")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("runs.csv")
    sys.stdout.write(analyze(path))
