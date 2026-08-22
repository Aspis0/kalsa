#!/usr/bin/env python3
"""Analyze kernel-ship A/B runs.csv per PREREG (pair medians, Wilcoxon, HL)."""
from __future__ import annotations

import argparse
import csv
import io
import statistics
import sys
from pathlib import Path
from typing import Iterable

METRIC1 = "wall_s_tok"
SUPPORTING = {
    2: ("late_rep_s_tok", "Sustained late-rep: median decode s/token of last 4 complete pairs"),
    3: ("j_per_tok", "J/token"),
    4: ("temp_max", "Max battery temperature per run"),
    5: ("ttft_s", "TTFT proxy on each arm's first measured run"),
}


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
        return int(s)
    except ValueError:
        return None


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.DictReader(f))


def complete_pairs(rows: list[dict[str, str]]) -> list[tuple[int, dict[str, str], dict[str, str]]]:
    """Last excluded=0 A and B per pair index. Pair 0 (warmup) ignored."""
    last: dict[int, dict[str, dict[str, str]]] = {}
    for row in rows:
        pair = _i(row.get("pair"))
        if pair is None or pair < 1:
            continue
        if str(row.get("excluded", "1")).strip() != "0":
            continue
        arm = (row.get("arm") or "").strip()
        if arm not in ("A", "B"):
            continue
        last.setdefault(pair, {})[arm] = row
    out: list[tuple[int, dict[str, str], dict[str, str]]] = []
    for pair in sorted(last):
        arms = last[pair]
        if "A" in arms and "B" in arms:
            out.append((pair, arms["A"], arms["B"]))
    return out


def median(xs: list[float]) -> float:
    return float(statistics.median(xs))


def hodges_lehmann(diffs: list[float]) -> float:
    n = len(diffs)
    if n == 0:
        return float("nan")
    walsh: list[float] = []
    for i in range(n):
        for j in range(i, n):
            walsh.append(0.5 * (diffs[i] + diffs[j]))
    return median(walsh)


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


def wilcoxon_exact_two_sided(diffs: list[float]) -> tuple[float, float]:
    """Exact sign-permutation Wilcoxon signed-rank, two-sided. Returns (W, p)."""
    nz = [d for d in diffs if d != 0]
    n = len(nz)
    if n == 0:
        return 0.0, 1.0
    ranks = _rankdata([abs(d) for d in nz])
    w_obs = sum((1.0 if d > 0 else -1.0) * r for d, r in zip(nz, ranks))
    total = 1 << n
    count = 0
    for mask in range(total):
        w = 0.0
        for i, r in enumerate(ranks):
            w += r if (mask >> i) & 1 else -r
        if abs(w) + 1e-12 >= abs(w_obs):
            count += 1
    return w_obs, count / total


def wilcoxon_two_sided(diffs: list[float]) -> tuple[float, float, str]:
    try:
        from scipy.stats import wilcoxon  # type: ignore

        nz = [d for d in diffs if d != 0]
        if len(nz) == 0:
            return 0.0, 1.0, "scipy"
        res = wilcoxon(nz, alternative="two-sided", zero_method="wilcox")
        return float(res.statistic), float(res.pvalue), "scipy"
    except Exception:
        w, p = wilcoxon_exact_two_sided(diffs)
        return w, p, "exact_sign_permutation"


def pair_metric(a: dict[str, str], b: dict[str, str], key: str) -> tuple[float | None, float | None]:
    return _f(a.get(key)), _f(b.get(key))


def analyze(rows: list[dict[str, str]]) -> str:
    pairs = complete_pairs(rows)
    n = len(pairs)
    lines: list[str] = []
    lines.append("# Kernel ship A/B — analysis (PREREG)")
    lines.append("")
    lines.append(f"Complete pairs (both arms excluded=0): **{n}**")
    if n < 10:
        lines.append("")
        lines.append(
            f"Incomplete: N={n} < 10. Confirmatory claim is **not** licensed. Continue next cycle."
        )
    lines.append("")

    a1: list[float] = []
    b1: list[float] = []
    used: list[int] = []
    for pair, ra, rb in pairs:
        va, vb = pair_metric(ra, rb, METRIC1)
        if va is None or vb is None:
            continue
        a1.append(va)
        b1.append(vb)
        used.append(pair)

    lines.append("## Metric 1 — decode wall s/token (confirmatory)")
    lines.append("")
    if len(a1) == 0:
        lines.append("No paired metric-1 values.")
        return "\n".join(lines) + "\n"

    diffs = [b - a for a, b in zip(a1, b1)]
    med_a = median(a1)
    med_b = median(b1)
    hl = hodges_lehmann(diffs)
    pct = (100.0 * (med_b - med_a) / med_a) if med_a != 0 else float("nan")
    w, p, engine = wilcoxon_two_sided(diffs)

    lines.append(f"- Pairs used: {used}")
    lines.append(f"- Median A: `{med_a:.6f}` s/token")
    lines.append(f"- Median B: `{med_b:.6f}` s/token")
    lines.append(f"- Hodges–Lehmann shift (B−A): `{hl:.6f}` s/token")
    lines.append(f"- % change (median B vs median A): `{pct:.3f}%`")
    lines.append(f"- Wilcoxon signed-rank two-sided: W=`{w:.6g}` p=`{p:.6g}` ({engine})")
    lines.append(f"- alpha=0.05; lower s/token is faster; negative HL means B faster.")
    if len(a1) >= 10:
        if p < 0.05:
            lines.append("- Decision: **significant** at alpha 0.05 (two-sided).")
        else:
            lines.append("- Decision: **not significant** at alpha 0.05 (two-sided).")
    lines.append("")
    lines.append("| pair | A s/tok | B s/tok | B−A |")
    lines.append("| ---: | ---: | ---: | ---: |")
    for pair, va, vb, d in zip(used, a1, b1, diffs):
        lines.append(f"| {pair} | {va:.6f} | {vb:.6f} | {d:+.6f} |")
    lines.append("")

    lines.append("## Supporting metrics 2–5")
    lines.append("")

    # Metric 2: last 4 complete pairs, median s/token per arm + paired diffs.
    last4 = pairs[-4:] if len(pairs) >= 4 else pairs
    la, lb = [], []
    for _, ra, rb in last4:
        va, vb = pair_metric(ra, rb, METRIC1)
        if va is not None and vb is not None:
            la.append(va)
            lb.append(vb)
    lines.append("### 2. Sustained late-rep (last 4 complete pairs)")
    if la:
        d4 = [b - a for a, b in zip(la, lb)]
        lines.append(
            f"- N={len(la)}  median A=`{median(la):.6f}`  median B=`{median(lb):.6f}`  "
            f"HL(B−A)=`{hodges_lehmann(d4):.6f}`"
        )
    else:
        lines.append("- no values")
    lines.append("")

    def _pair_table(key: str, title: str) -> None:
        aa, bb, pids = [], [], []
        for pair, ra, rb in pairs:
            va, vb = pair_metric(ra, rb, key)
            if va is None or vb is None:
                continue
            aa.append(va)
            bb.append(vb)
            pids.append(pair)
        lines.append(f"### {title}")
        if not aa:
            lines.append("- no values")
            lines.append("")
            return
        dd = [b - a for a, b in zip(aa, bb)]
        lines.append(
            f"- N={len(aa)} pairs {pids}  median A=`{median(aa):.6g}`  "
            f"median B=`{median(bb):.6g}`  HL(B−A)=`{hodges_lehmann(dd):.6g}`"
        )
        lines.append("")

    _pair_table("j_per_tok", "3. J/token")
    _pair_table("temp_max", "4. Max battery temperature")

    # Metric 5: first measured (excluded=0) run of each arm, not 12-pair test.
    first_a = next((r for r in rows if r.get("arm") == "A" and str(r.get("excluded", "1")).strip() == "0"), None)
    first_b = next((r for r in rows if r.get("arm") == "B" and str(r.get("excluded", "1")).strip() == "0"), None)
    lines.append("### 5. TTFT proxy (first measured run of each arm)")
    if first_a or first_b:
        ta = _f(first_a.get("ttft_s")) if first_a else None
        tb = _f(first_b.get("ttft_s")) if first_b else None
        la_ = first_a.get("label") if first_a else ""
        lb_ = first_b.get("label") if first_b else ""
        lines.append(f"- first A `{la_}` ttft_s=`{ta if ta is not None else ''}`")
        lines.append(f"- first B `{lb_}` ttft_s=`{tb if tb is not None else ''}`")
    else:
        lines.append("- no measured runs")
    lines.append("")
    return "\n".join(lines) + "\n"


SELFTEST_CSV = """ts,pair,arm,label,excluded,decode_tps,wall_s_tok,compute,mgmt,stall,tokens_generated,joules,j_per_tok,ttft_s,batt_start,batt_end,temp_start,temp_max,screen,plugged,memavail_start_kib,power_source,j_window
t,0,B,warmup,1,3.0,0.333,0.2,0.01,0.05,200,80,0.4,10,80,79,30,31,Awake,UNPLUGGED,800000,termux,decode
t,0,B,warmup_nottft,1,3.0,0.333,0.2,0.01,0.05,200,80,0.4,,80,79,30,31,Awake,UNPLUGGED,800000,termux,full_run_fallback
t,1,A,p01_A,0,4.0,0.250,0.18,0.01,0.04,200,70,0.35,8.0,79,78,30,32,Awake,UNPLUGGED,790000,termux,decode
t,1,B,p01_B,0,5.0,0.200,0.14,0.01,0.03,200,60,0.30,7.0,78,77,31,33,Awake,UNPLUGGED,780000,termux,decode
t,2,B,p02_B,0,5.1,0.196,0.14,0.01,0.03,200,59,0.295,7.1,77,76,31,33,Awake,UNPLUGGED,770000,termux,decode
t,2,A,p02_A,0,3.9,0.256,0.18,0.01,0.04,200,71,0.355,8.2,76,75,30,32,Awake,UNPLUGGED,760000,termux,decode
t,3,A,p03_A,1,4.0,0.250,0.18,0.01,0.04,200,70,0.35,8.0,75,50,42,44,Awake,UNPLUGGED,750000,termux,decode
t,3,B,p03_B,0,5.0,0.200,0.14,0.01,0.03,200,60,0.30,7.0,50,49,33,34,Awake,UNPLUGGED,740000,termux,decode
t,3,A,p03_A,0,4.1,0.244,0.17,0.01,0.04,200,69,0.345,8.0,70,69,30,32,Awake,UNPLUGGED,730000,termux,decode
t,3,B,p03_B,0,5.2,0.192,0.13,0.01,0.03,200,58,0.29,6.9,69,68,31,33,Awake,UNPLUGGED,720000,termux,decode
t,4,B,p04_B,0,5.0,0.200,0.14,0.01,0.03,200,60,0.30,7.0,68,67,31,33,Awake,UNPLUGGED,710000,termux,decode
t,4,A,p04_A,0,3.8,0.263,0.19,0.01,0.04,200,72,0.36,8.3,67,66,30,32,Awake,UNPLUGGED,700000,termux,decode
t,5,A,p05_A,0,4.0,0.250,0.18,0.01,0.04,200,70,0.35,8.1,66,65,30,32,Awake,UNPLUGGED,690000,termux,decode
t,5,B,p05_B,0,5.3,0.189,0.13,0.01,0.03,200,57,0.285,6.8,65,64,31,33,Awake,UNPLUGGED,680000,termux,decode
t,6,B,p06_B,0,4.9,0.204,0.14,0.01,0.03,200,61,0.305,7.2,64,63,31,33,Awake,UNPLUGGED,670000,termux,decode
t,6,A,p06_A,0,3.85,0.260,0.19,0.01,0.04,200,71,0.355,8.2,63,62,30,32,Awake,UNPLUGGED,660000,termux,decode
"""


def selftest() -> int:
    rows = list(csv.DictReader(io.StringIO(SELFTEST_CSV)))
    assert all("j_window" in r for r in rows)
    assert any(r.get("j_window") == "full_run_fallback" for r in rows)
    assert any(r.get("j_window") == "decode" for r in rows)
    pairs = complete_pairs(rows)
    assert [p for p, _, _ in pairs] == [1, 2, 3, 4, 5, 6], pairs
    # pair 3 must be the retried (last) excluded=0 rows, not the voided A
    assert _f(pairs[2][1]["wall_s_tok"]) == 0.244
    a = [_f(ra[METRIC1]) for _, ra, _ in pairs]
    b = [_f(rb[METRIC1]) for _, _, rb in pairs]
    assert all(x is not None for x in a + b)
    diffs = [bb - aa for aa, bb in zip(a, b)]  # type: ignore[operator]
    assert all(d < 0 for d in diffs), diffs
    w_ex, p_ex = wilcoxon_exact_two_sided(diffs)
    assert 0.0 < p_ex <= 1.0, p_ex
    # All 6 diffs negative → two-sided exact p = 2/64 = 0.03125
    assert abs(p_ex - (2.0 / 64.0)) < 1e-12, p_ex
    w, p, engine = wilcoxon_two_sided(diffs)
    assert 0.0 < p <= 1.0, (w, p, engine)
    hl = hodges_lehmann(diffs)
    assert hl < 0, hl
    md = analyze(rows)
    assert "Wilcoxon" in md
    assert "p=`" in md
    # zeros-only should not crash
    wz, pz = wilcoxon_exact_two_sided([0.0, 0.0])
    assert pz == 1.0 and wz == 0.0
    print("SELFTEST_OK")
    print(f"exact_p={p_ex} engine={engine} p={p} HL={hl:.6f} W={w}")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "csv",
        nargs="?",
        default=str(Path(__file__).resolve().parent / "runs.csv"),
        help="runs.csv path (default: alongside this script)",
    )
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(list(argv) if argv is not None else None)
    if args.selftest:
        return selftest()
    path = Path(args.csv)
    if not path.exists():
        print(f"missing {path}", file=sys.stderr)
        return 2
    sys.stdout.write(analyze(load_rows(path)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
