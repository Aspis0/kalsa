#!/usr/bin/env python3
"""Analyze KF REALITY (Jelly) runs: tail / energy / thermal / memory verdicts.

Per-token source: native CLI `--csv PATH` (csv_metrics_sink.cpp). Rows are
decode tokens. Columns used: wall_ms (primary tail), stall_ms, ra_issue_ms,
ra_wd_ms. Preamble records kf_prefetch=.

Hot blocks: order_idx >= 2 (drop block 1 OFF, which still pays cold page-cache
fill). So OFF-hot = block 4, ON-hot = blocks 2+3.

Verdict thresholds
==================
KF_ENERGY_WIN
  YES   : j_per_tok_ON <= j_per_tok_OFF * 1.05
  NO    : j_per_tok_ON >  j_per_tok_OFF * 1.15
  MIXED : otherwise, or joules missing on either arm

KF_THERMAL_WIN
  sag(block) = (early_half_tps - late_half_tps) / early_half_tps
               (+ = the phone slowed). Half = first/last 50% of decode tokens.
  sag_arm    = mean sag over that arm's hot blocks
  temp_max   = MAX of hot-block temp_max per arm (not mean)
  YES   : sag_ON <= sag_OFF AND temp_max_ON <= temp_max_OFF + 1.0
  NO    : sag_ON > sag_OFF + 0.05 OR temp_max_ON > temp_max_OFF + 2.0
  MIXED : otherwise

KF_MEMORY_WIN
  memavail_min_kib = min over HOT kept rows only (order_idx >= 2; block 1 excluded)
  YES   : majflt_per_tok_ON < majflt_per_tok_OFF
          AND memavail_min_kib > 2 * 307200  (never approached the 300 MiB abort)
  NO    : majflt_per_tok_ON > majflt_per_tok_OFF * 1.10
          OR memavail_min_kib < 307200
  MIXED : otherwise, or majflt missing

KF_ROBUST_WIN
  stutter token = wall_ms > 2 * arm_p50 (the token that blocks = UI stutter)
  YES   : p99_ON <= p99_OFF AND stutter_rate_ON <= stutter_rate_OFF
  NO    : p99_ON > p99_OFF * 1.10 OR stutter_rate_ON > stutter_rate_OFF + 0.01
  MIXED : otherwise, or no per-token rows

All four verdicts are YES / NO / MIXED with the numbers that decided them.
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import tempfile
from pathlib import Path
from typing import Iterable

MEMAVAIL_ABORT_KIB = 307200
MEMAVAIL_SAFE_KIB = 2 * MEMAVAIL_ABORT_KIB  # 600 MiB: "never approached"

ENERGY_YES = 1.05
ENERGY_NO = 1.15
THERMAL_TEMP_YES = 1.0
THERMAL_TEMP_NO = 2.0
THERMAL_SAG_NO = 0.05
MEMORY_MAJ_NO = 1.10
ROBUST_P99_NO = 1.10
ROBUST_STUTTER_NO = 0.01  # absolute rate, not relative

HOT_MIN_ORDER = 2
OFF_HOT_DESIGNED = 1  # block 4
ON_HOT_DESIGNED = 2   # blocks 2+3
TOKEN_HEADER = (
    "step,steps,wall_ms,io_ms,compute_ms,read_bytes,cache_hit_pct,stall_ms,mgmt_ms,"
    "majflt,cpu_ms,dense_resident_frac,turn,majflt_mib,cache_budget_mib,rss_mib,"
    "rss_anon_mib,rss_file_mib,swap_mib,mem_available_mib,mem_free_mib,swap_free_mib,"
    "loop_overhead_ms,mtp_batch,mtp_draft_ms,drain_ms,adopt_ms,ra_issue_ms,ra_wd_ms"
)


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


def percentile(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    w = k - lo
    return s[lo] * (1.0 - w) + s[hi] * w


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.DictReader(f))


def load_token_walls(path: Path) -> list[float]:
    if not path.exists():
        return []
    walls: list[float] = []
    with path.open(encoding="utf-8", errors="replace", newline="") as f:
        # Skip # preamble; DictReader uses the first non-# line as header.
        data = io.StringIO()
        for line in f:
            if line.startswith("#"):
                continue
            data.write(line)
        data.seek(0)
        for row in csv.DictReader(data):
            w = _f(row.get("wall_ms"))
            if w is not None:
                walls.append(w)
    return walls


def block_sag(walls: list[float]) -> float | None:
    """+ = late half slower than early half."""
    if len(walls) < 4:
        return None
    mid = len(walls) // 2
    early, late = walls[:mid], walls[mid:]
    se, sl = sum(early), sum(late)
    if se <= 0 or sl <= 0:
        return None
    tps_e = (len(early) * 1000.0) / se
    tps_l = (len(late) * 1000.0) / sl
    if tps_e <= 0:
        return None
    return (tps_e - tps_l) / tps_e


def resolve_token_csv(row: dict[str, str], root: Path) -> Path | None:
    raw = (row.get("csv_path") or "").strip()
    label = (row.get("label") or "").strip()
    cands: list[Path] = []
    if raw:
        p = Path(raw)
        cands.append(p)
        cands.append(root / "per_token" / p.name)
        cands.append(root / p.name)
    if label:
        cands.append(root / "per_token" / f"{label}.csv")
        cands.append(root / "logs" / label / "metrics.csv")
    for c in cands:
        if c.exists():
            return c
    return None


def mean_or_none(xs: list[float]) -> float | None:
    return None if not xs else float(sum(xs) / len(xs))


def max_or_none(xs: list[float]) -> float | None:
    return None if not xs else float(max(xs))


def verdict_energy(j_on: float | None, j_off: float | None) -> tuple[str, str]:
    if j_on is None or j_off is None or j_off == 0:
        return "MIXED", f"j_per_tok ON={j_on} OFF={j_off} (missing)"
    ratio = j_on / j_off
    nums = f"j/tok ON={j_on:.6g} OFF={j_off:.6g} ratio={ratio:.4f} (YES≤{ENERGY_YES} NO>{ENERGY_NO})"
    if j_on <= j_off * ENERGY_YES:
        return "YES", nums
    if j_on > j_off * ENERGY_NO:
        return "NO", nums
    return "MIXED", nums


def verdict_thermal(
    sag_on: float | None,
    sag_off: float | None,
    tmax_on: float | None,
    tmax_off: float | None,
) -> tuple[str, str]:
    if sag_on is None or sag_off is None or tmax_on is None or tmax_off is None:
        return "MIXED", f"sag ON={sag_on} OFF={sag_off} temp_max ON={tmax_on} OFF={tmax_off} (missing)"
    dtemp = tmax_on - tmax_off
    nums = (
        f"sag ON={sag_on:.4f} OFF={sag_off:.4f}  temp_max ON={tmax_on:.2f} OFF={tmax_off:.2f} "
        f"dT={dtemp:+.2f}C (YES: sag_ON≤sag_OFF and dT≤+{THERMAL_TEMP_YES}  "
        f"NO: sag_ON>sag_OFF+{THERMAL_SAG_NO} or dT>+{THERMAL_TEMP_NO})"
    )
    yes = sag_on <= sag_off and tmax_on <= tmax_off + THERMAL_TEMP_YES
    no = sag_on > sag_off + THERMAL_SAG_NO or tmax_on > tmax_off + THERMAL_TEMP_NO
    if yes:
        return "YES", nums
    if no:
        return "NO", nums
    return "MIXED", nums


def verdict_memory(
    maj_on: float | None,
    maj_off: float | None,
    mem_min: float | None,
) -> tuple[str, str]:
    nums = f"majflt/tok ON={maj_on} OFF={maj_off} memavail_min_kib={mem_min} (abort={MEMAVAIL_ABORT_KIB} safe>{MEMAVAIL_SAFE_KIB})"
    if mem_min is not None and mem_min < MEMAVAIL_ABORT_KIB:
        return "NO", nums
    if maj_on is None or maj_off is None:
        return "MIXED", nums + " (majflt missing)"
    yes = maj_on < maj_off and (mem_min is None or mem_min > MEMAVAIL_SAFE_KIB)
    no = maj_on > maj_off * MEMORY_MAJ_NO
    if yes:
        return "YES", nums
    if no:
        return "NO", nums
    return "MIXED", nums


def verdict_robust(
    p99_on: float | None,
    p99_off: float | None,
    st_on: float | None,
    st_off: float | None,
) -> tuple[str, str]:
    if p99_on is None or p99_off is None or st_on is None or st_off is None:
        return "MIXED", f"p99 ON={p99_on} OFF={p99_off} stutter_rate ON={st_on} OFF={st_off} (missing)"
    nums = (
        f"p99_ms ON={p99_on:.2f} OFF={p99_off:.2f}  stutter_rate ON={st_on:.4f} OFF={st_off:.4f} "
        f"(YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  "
        f"NO: p99_ON>p99_OFF×{ROBUST_P99_NO} or stutter_ON>stutter_OFF+{ROBUST_STUTTER_NO})"
    )
    yes = p99_on <= p99_off and st_on <= st_off
    no = p99_on > p99_off * ROBUST_P99_NO or st_on > st_off + ROBUST_STUTTER_NO
    if yes:
        return "YES", nums
    if no:
        return "NO", nums
    return "MIXED", nums


def analyze(rows: list[dict[str, str]], root: Path) -> str:
    lines: list[str] = []
    lines.append("# KF REALITY — Jelly analysis")
    lines.append("")
    lines.append("Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.")
    lines.append("")

    kept = [r for r in rows if str(r.get("excluded", "0")).strip() != "1"]
    lines.append(f"Rows in runs.csv: {len(rows)} (excluded=0: {len(kept)})")
    lines.append("")
    lines.append("| order | arm | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |")
    lines.append("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |")
    for r in kept:
        batt = f"{r.get('batt_start','')}→{r.get('batt_end','')}"
        lines.append(
            f"| {r.get('order_idx','')} | {r.get('arm','')} | {r.get('decode_tps','')} | "
            f"{r.get('wall_s_tok','')} | {r.get('stall_pct','')} | {r.get('j_per_tok','')} | "
            f"{r.get('majflt_delta','')} | {r.get('read_bytes_gb','')} | {r.get('temp_max','')} | "
            f"{batt} | {r.get('n_tokens','')} | {r.get('duration_s','')} |"
        )
    lines.append("")

    def arm_hot(arm: str) -> list[dict[str, str]]:
        out = []
        for r in kept:
            if (r.get("arm") or "").strip() != arm:
                continue
            oi = _i(r.get("order_idx"))
            if oi is None or oi < HOT_MIN_ORDER:
                continue
            out.append(r)
        return out

    def collect_walls(arm_rows: list[dict[str, str]]) -> list[float]:
        walls: list[float] = []
        for r in arm_rows:
            p = resolve_token_csv(r, root)
            if p is None:
                continue
            walls.extend(load_token_walls(p))
        return walls

    def sag_mean(arm_rows: list[dict[str, str]]) -> float | None:
        sags: list[float] = []
        for r in arm_rows:
            p = resolve_token_csv(r, root)
            if p is None:
                continue
            s = block_sag(load_token_walls(p))
            if s is not None:
                sags.append(s)
        return mean_or_none(sags)

    def mean_field(arm_rows: list[dict[str, str]], key: str) -> float | None:
        xs = [_f(r.get(key)) for r in arm_rows]
        xs = [x for x in xs if x is not None]
        return mean_or_none(xs)

    def max_field(arm_rows: list[dict[str, str]], key: str) -> float | None:
        xs = [_f(r.get(key)) for r in arm_rows]
        xs = [x for x in xs if x is not None]
        return max_or_none(xs)

    def maj_per_tok(arm_rows: list[dict[str, str]]) -> float | None:
        tot_m = 0.0
        tot_n = 0.0
        any_m = False
        for r in arm_rows:
            m = _f(r.get("majflt_delta"))
            n = _f(r.get("n_tokens"))
            if m is None or n is None or n <= 0:
                continue
            tot_m += m
            tot_n += n
            any_m = True
        if not any_m or tot_n <= 0:
            return None
        return tot_m / tot_n

    def mem_min_hot() -> float | None:
        xs: list[float] = []
        for r in kept:
            oi = _i(r.get("order_idx"))
            if oi is None or oi < HOT_MIN_ORDER:
                continue
            m = _f(r.get("memavail_min_kib"))
            if m is not None:
                xs.append(m)
        return min(xs) if xs else None

    def j_per_tok(arm_rows: list[dict[str, str]]) -> float | None:
        jt = 0.0
        nt = 0.0
        any_j = False
        for r in arm_rows:
            j = _f(r.get("joules"))
            n = _f(r.get("n_tokens"))
            jp = _f(r.get("j_per_tok"))
            if n is None or n <= 0:
                continue
            if j is not None:
                jt += j
                nt += n
                any_j = True
            elif jp is not None:
                jt += jp * n
                nt += n
                any_j = True
        if not any_j or nt <= 0:
            return None
        return jt / nt

    lines.append("## Per-token tail (hot blocks)")
    lines.append("")
    stats: dict[str, dict[str, float]] = {}
    for arm in ("OFF", "ON"):
        rs = arm_hot(arm)
        walls = collect_walls(rs)
        if not walls:
            lines.append(f"- **{arm}**: no per-token rows (hot blocks={len(rs)})")
            continue
        p50 = percentile(walls, 0.50)
        p90 = percentile(walls, 0.90)
        p95 = percentile(walls, 0.95)
        p99 = percentile(walls, 0.99)
        mx = max(walls)
        stutter = sum(1 for w in walls if w > 2.0 * p50)
        rate = stutter / len(walls)
        stats[arm] = {
            "p50": p50,
            "p90": p90,
            "p95": p95,
            "p99": p99,
            "max": mx,
            "n": float(len(walls)),
            "stutter": float(stutter),
            "stutter_rate": rate,
        }
        lines.append(
            f"- **{arm}** n={len(walls)}  p50=`{p50:.2f}` p90=`{p90:.2f}` "
            f"p95=`{p95:.2f}` p99=`{p99:.2f}` max=`{mx:.2f}` ms  "
            f"stutter(>2×p50)=`{stutter}` ({100.0 * rate:.2f}%)"
        )
    lines.append("")

    lines.append("## Thermal sag (late-half vs early-half tok/s, per hot block)")
    lines.append("")
    for r in kept:
        oi = _i(r.get("order_idx"))
        p = resolve_token_csv(r, root)
        walls = load_token_walls(p) if p else []
        sag = block_sag(walls)
        sag_s = "n/a" if sag is None else f"{sag:.4f}"
        hot = "hot" if oi is not None and oi >= HOT_MIN_ORDER else "cold-first"
        lines.append(f"- {r.get('label','')} ({hot}): sag=`{sag_s}` n={len(walls)}")
    lines.append("")

    off_h, on_h = arm_hot("OFF"), arm_hot("ON")
    j_off, j_on = j_per_tok(off_h), j_per_tok(on_h)
    sag_off, sag_on = sag_mean(off_h), sag_mean(on_h)
    tmax_off, tmax_on = max_field(off_h, "temp_max"), max_field(on_h, "temp_max")
    maj_off, maj_on = maj_per_tok(off_h), maj_per_tok(on_h)
    mem_min = mem_min_hot()
    rb_off, rb_on = mean_field(off_h, "read_bytes_gb"), mean_field(on_h, "read_bytes_gb")

    p99_off = stats.get("OFF", {}).get("p99")
    p99_on = stats.get("ON", {}).get("p99")
    st_off = stats.get("OFF", {}).get("stutter_rate")
    st_on = stats.get("ON", {}).get("stutter_rate")

    e_v, e_n = verdict_energy(j_on, j_off)
    t_v, t_n = verdict_thermal(sag_on, sag_off, tmax_on, tmax_off)
    m_v, m_n = verdict_memory(maj_on, maj_off, mem_min)
    r_v, r_n = verdict_robust(p99_on, p99_off, st_on, st_off)

    lines.append("## Supporting (hot-block aggregates)")
    lines.append("")
    lines.append(f"- J/token  OFF=`{j_off}`  ON=`{j_on}`")
    lines.append(f"- majflt/token  OFF=`{maj_off}`  ON=`{maj_on}`")
    lines.append(f"- read_bytes_gb (block mean)  OFF=`{rb_off}`  ON=`{rb_on}`")
    lines.append(f"- temp_max (max over hot blocks)  OFF=`{tmax_off}`  ON=`{tmax_on}`")
    lines.append(f"- memavail_min_kib (hot blocks) = `{mem_min}`")
    lines.append("")

    if len(off_h) < OFF_HOT_DESIGNED:
        lines.append("WARNING: arm OFF missing hot block(s) — verdicts from thinner data")
        lines.append("")
    if len(on_h) < ON_HOT_DESIGNED:
        lines.append("WARNING: arm ON missing hot block(s) — verdicts from thinner data")
        lines.append("")

    lines.append("## Verdicts")
    lines.append("")
    lines.append("| gate | verdict | numbers |")
    lines.append("| --- | --- | --- |")
    lines.append(f"| KF_ENERGY_WIN | **{e_v}** | {e_n} |")
    lines.append(f"| KF_THERMAL_WIN | **{t_v}** | {t_n} |")
    lines.append(f"| KF_MEMORY_WIN | **{m_v}** | {m_n} |")
    lines.append(f"| KF_ROBUST_WIN | **{r_v}** | {r_n} |")
    lines.append("")
    return "\n".join(lines) + "\n"


def write_tail(md: str, tail_path: Path) -> None:
    tail_path.write_text(md, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------------
# Self-test (synthetic ABBA, native --csv shape)
# ---------------------------------------------------------------------------

def _tok_csv(n: int, wall: float, spikes: list[tuple[int, float]], kf: int) -> str:
    lines = [
        "# bmoe_metrics v2",
        f"# moe_stream=1 kf_prefetch={kf} kf_prefetch_width=6",
        TOKEN_HEADER,
    ]
    for i in range(1, n + 1):
        w = wall
        for idx, val in spikes:
            if i == idx:
                w = val
        lines.append(
            f"{i},{n},{w:.3f},10.0,100.0,1000,60.0,20.0,5.0,0,80.0,-1,1,0,2000,400,200,200,0,5000,4000,0,1.0,0,0,0,0,0,0"
        )
    return "\n".join(lines) + "\n"


def _runs_header() -> str:
    return (
        "ts,order_idx,arm,label,decode_tps,wall_s_tok,compute,mgmt,stall,stall_pct,"
        "issued_mib,hit_mib,wasted_mib,precision_pct,hit_pct,joules,j_per_tok,j_window,"
        "ttft_s,majflt_delta,read_bytes,read_bytes_gb,temp_start,temp_max,temp_end,"
        "batt_start,batt_end,freq_p50_c0,freq_p95_c0,freq_p50_c1,freq_p95_c1,n_tokens,"
        "duration_s,memavail_start_kib,memavail_min_kib,screen,plugged,excluded,csv_path,"
        "freq_readable"
    )


def _run_row(
    order: int,
    arm: str,
    tps: float,
    wall: float,
    joules: float,
    n: int,
    maj: int,
    tmax: float,
    mem: int,
    csv_path: str,
    excluded: int = 0,
) -> str:
    jpt = joules / n
    return (
        f"t,{order},{arm},b{order}_{arm},{tps},{wall},0.2,0.01,0.05,20,"
        f"100,70,30,70,60,{joules},{jpt:.8f},decode,2.0,{maj},100000000,0.1,"
        f"{tmax-1},{tmax},{tmax},80,78,500000,800000,1100000,1600000,{n},"
        f"{int(n/tps)},6000000,{mem},Awake,UNPLUGGED,{excluded},{csv_path},1"
    )


def selftest() -> int:
    # Threshold unit checks first (no files).
    v, _ = verdict_energy(1.00, 1.00)
    assert v == "YES", v
    v, _ = verdict_energy(1.04, 1.00)
    assert v == "YES", v
    v, _ = verdict_energy(1.10, 1.00)
    assert v == "MIXED", v
    v, _ = verdict_energy(1.20, 1.00)
    assert v == "NO", v
    v, _ = verdict_energy(None, 1.00)
    assert v == "MIXED", v

    v, _ = verdict_thermal(0.02, 0.05, 33.0, 34.0)
    assert v == "YES", v
    v, _ = verdict_thermal(0.10, 0.02, 33.0, 34.0)
    assert v == "NO", v  # sag worse by >0.05
    v, _ = verdict_thermal(0.03, 0.02, 37.0, 34.0)
    assert v == "NO", v  # dT > 2
    v, _ = verdict_thermal(0.03, 0.02, 35.2, 34.0)
    assert v == "MIXED", v  # sag slightly worse, dT=1.2 in the gap

    v, _ = verdict_memory(1.0, 2.0, 800000)
    assert v == "YES", v
    v, _ = verdict_memory(2.5, 2.0, 800000)
    assert v == "NO", v
    v, _ = verdict_memory(1.0, 2.0, 100000)
    assert v == "NO", v  # floor hit
    v, _ = verdict_memory(2.05, 2.0, 800000)
    assert v == "MIXED", v

    v, _ = verdict_robust(200.0, 250.0, 0.01, 0.02)
    assert v == "YES", v
    v, _ = verdict_robust(300.0, 250.0, 0.01, 0.02)
    assert v == "NO", v
    v, _ = verdict_robust(240.0, 250.0, 0.05, 0.02)
    assert v == "NO", v
    v, _ = verdict_robust(255.0, 250.0, 0.021, 0.020)
    assert v == "MIXED", v

    # End-to-end synthetic ABBA. ON is cleaner/faster/cooler/cheaper.
    n = 40
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "per_token").mkdir()
        # OFF block1 (ignored as hot): a bit spiky
        (root / "per_token" / "b1_OFF.csv").write_text(
            _tok_csv(n, 320.0, [(10, 700.0), (30, 710.0)], 0), encoding="utf-8", newline="\n"
        )
        # ON blocks 2+3: p50=210, two mild spikes still < 2*210=420 so 0 stutter
        (root / "per_token" / "b2_ON.csv").write_text(
            _tok_csv(n, 210.0, [(20, 300.0)], 1), encoding="utf-8", newline="\n"
        )
        (root / "per_token" / "b3_ON.csv").write_text(
            _tok_csv(n, 212.0, [(8, 280.0)], 1), encoding="utf-8", newline="\n"
        )
        # OFF block4 hot: p50=320, two stutters at 700
        (root / "per_token" / "b4_OFF.csv").write_text(
            _tok_csv(n, 318.0, [(12, 700.0), (35, 680.0)], 0), encoding="utf-8", newline="\n"
        )
        # Late-half sag: make OFF late tokens slower by rewriting last half of b4
        # (already mostly flat; bump last 20 walls via a second file write)
        walls_off_late = _tok_csv(n, 318.0, [(i, 400.0) for i in range(21, 41)] + [(12, 700.0)], 0)
        (root / "per_token" / "b4_OFF.csv").write_text(walls_off_late, encoding="utf-8", newline="\n")
        # ON late half slightly slower but less than OFF
        walls_on_late = _tok_csv(n, 210.0, [(i, 230.0) for i in range(21, 41)], 1)
        (root / "per_token" / "b2_ON.csv").write_text(walls_on_late, encoding="utf-8", newline="\n")
        (root / "per_token" / "b3_ON.csv").write_text(
            _tok_csv(n, 212.0, [(i, 228.0) for i in range(21, 41)], 1),
            encoding="utf-8",
            newline="\n",
        )

        runs = [_runs_header()]
        runs.append(_run_row(1, "OFF", 3.1, 0.322, 80.0, n, 40, 31.0, 5000000, str(root / "per_token" / "b1_OFF.csv")))
        runs.append(_run_row(2, "ON", 4.7, 0.213, 70.0, n, 20, 32.0, 4900000, str(root / "per_token" / "b2_ON.csv")))
        runs.append(_run_row(3, "ON", 4.6, 0.217, 71.0, n, 18, 32.5, 4800000, str(root / "per_token" / "b3_ON.csv")))
        runs.append(_run_row(4, "OFF", 3.0, 0.333, 85.0, n, 45, 33.0, 4700000, str(root / "per_token" / "b4_OFF.csv")))
        (root / "runs.csv").write_text("\n".join(runs) + "\n", encoding="utf-8", newline="\n")

        md = analyze(load_rows(root / "runs.csv"), root)
        assert "KF_ENERGY_WIN" in md
        assert "KF_THERMAL_WIN" in md
        assert "KF_MEMORY_WIN" in md
        assert "KF_ROBUST_WIN" in md
        # ON cheaper, cooler-or-equal sag, fewer faults, better p99 / no stutter
        assert "| KF_ENERGY_WIN | **YES** |" in md, md
        assert "| KF_THERMAL_WIN | **YES** |" in md, md
        assert "| KF_MEMORY_WIN | **YES** |" in md, md
        assert "| KF_ROBUST_WIN | **YES** |" in md, md
        assert "stutter(>2×p50)" in md
        assert "p99=" in md or "p99`" in md

        tail = root / "TAIL.md"
        write_tail(md, tail)
        assert tail.exists() and "KF_ENERGY_WIN" in tail.read_text(encoding="utf-8")

    # Missing per-token → MIXED robust, still emits the table.
    rows = list(
        csv.DictReader(
            io.StringIO(
                _runs_header()
                + "\n"
                + _run_row(2, "ON", 4.7, 0.21, 70.0, 10, 1, 30.0, 5000000, "")
                + "\n"
                + _run_row(4, "OFF", 3.1, 0.32, 80.0, 10, 2, 31.0, 5000000, "")
                + "\n"
            )
        )
    )
    md2 = analyze(rows, Path("."))
    assert "| KF_ROBUST_WIN | **MIXED** |" in md2, md2

    # Thin-arm WARNING: designed OFF-hot=1, ON-hot=2. Drop OFF hot (block 4).
    rows_thin = list(
        csv.DictReader(
            io.StringIO(
                _runs_header()
                + "\n"
                + _run_row(1, "OFF", 3.1, 0.32, 80.0, 10, 2, 31.0, 5000000, "")
                + "\n"
                + _run_row(2, "ON", 4.7, 0.21, 70.0, 10, 1, 30.0, 5000000, "")
                + "\n"
                + _run_row(3, "ON", 4.6, 0.22, 71.0, 10, 1, 30.5, 5000000, "")
                + "\n"
            )
        )
    )
    md_thin = analyze(rows_thin, Path("."))
    assert "WARNING: arm OFF missing hot block(s) — verdicts from thinner data" in md_thin, md_thin
    assert "WARNING: arm ON missing hot block(s)" not in md_thin, md_thin
    assert "| KF_ENERGY_WIN | **MIXED** |" in md_thin, md_thin
    assert "| KF_THERMAL_WIN | **MIXED** |" in md_thin, md_thin
    assert "| KF_MEMORY_WIN | **MIXED** |" in md_thin, md_thin
    assert "| KF_ROBUST_WIN | **MIXED** |" in md_thin, md_thin

    print("SELFTEST_OK")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    here = Path(__file__).resolve().parent
    ap.add_argument(
        "csv",
        nargs="?",
        default=str(here / "runs.csv"),
        help="runs.csv path (default: alongside this script)",
    )
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument(
        "--write-tail",
        nargs="?",
        const="TAIL.md",
        default=None,
        help="also write the markdown to TAIL.md (or given path)",
    )
    args = ap.parse_args(list(argv) if argv is not None else None)
    if args.selftest:
        return selftest()
    path = Path(args.csv)
    if not path.exists():
        print(f"missing {path}", file=sys.stderr)
        return 2
    root = path.parent
    md = analyze(load_rows(path), root)
    sys.stdout.write(md)
    if args.write_tail is not None:
        dest = Path(args.write_tail)
        if not dest.is_absolute():
            dest = root / dest
        write_tail(md, dest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
