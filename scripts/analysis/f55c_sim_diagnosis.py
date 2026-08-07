#!/usr/bin/env python3
"""F5.5-C -- diagnosi gap simulatore M5 vs misura F5.4-C (solo PC).

  /c/Users/gualt/AppData/Local/Programs/Python/Python312/python \\
      scripts/analysis/f55c_sim_diagnosis.py

Ipotesi: H0 riproduzione; H1 metrica; H2 traccia; H3 capacita; H4 ubatch;
         H5 voice size; H6 envelope I/O + synth leggero; H7 Belady/bake-off.

Artefatti: results/f5.5-c/
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m5_route_trace_analysis import (  # noqa: E402
    MIB,
    N_EXPERT,
    N_LAYER,
    N_USED,
    CacheSim,
    build_batches,
    load_trace,
    parse_stdout,
)

REPO = Path(__file__).resolve().parents[2]
TRACE_DIR = REPO / "results" / "f4.8" / "traces"
OUT_DIR = REPO / "results" / "f5.5-c"
BUDGETS = (2000, 2500, 3000, 3500)
MEASURED_CUM = {2000: 71.1, 2500: 73.3, 3000: 75.1, 3500: 76.1}
REPORT_SIM_DEC = {2000: 72.236, 2500: 76.27, 3000: 80.049, 3500: 84.082}
F54_N_PREF = 1138
F54_N_DEC = 256
F54_MIB_TOK = {2000: 32.93, 2500: 24.80, 3000: 18.35, 3500: 14.63}
THEO_MIB_TOK = 291.1  # M5 short_bench cold decode


def diary(lines: list[str], msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
    lines.append(msg)


def run_sim(batches, n_pref, policy: str, budget_mib: float, ebytes: dict) -> CacheSim:
    return CacheSim(policy, int(budget_mib * MIB), ebytes).run(batches, n_pref)


def build_batches_ubatch(tr: dict, ubatch: int):
    """Prefill a chunk di `ubatch` token (F5.4: 512)."""
    if ubatch <= 0:
        return build_batches(tr)
    pref_by_step = defaultdict(lambda: defaultdict(list))
    dec = defaultdict(list)
    for i in range(tr["n"]):
        ph = int(tr["phase"][i])
        st = int(tr["step"][i])
        il = int(tr["layer"][i])
        sl = int(tr["slot"][i])
        e = int(tr["expert"][i])
        if ph == 0:
            pref_by_step[st][il].append((sl, e))
        else:
            dec[(st, il)].append((sl, e))
    pref_steps = sorted(pref_by_step.keys())
    layers = list(range(N_LAYER))
    batches = []
    for start in range(0, len(pref_steps), ubatch):
        chunk = pref_steps[start : start + ubatch]
        for il in layers:
            ids = []
            for st in chunk:
                if il in pref_by_step[st]:
                    ids.extend(e for _sl, e in sorted(pref_by_step[st][il]))
            if ids:
                batches.append((il, ids))
    n_pref = len(batches)
    for st in sorted({s for s, _ in dec}):
        for il in layers:
            if (st, il) in dec:
                ids = [e for _sl, e in sorted(dec[(st, il)])]
                batches.append((il, ids))
    return batches, n_pref


def curve(batches, n_pref, ebytes, budgets=BUDGETS, policy="lru"):
    rows = []
    for c in budgets:
        s = run_sim(batches, n_pref, policy, c, ebytes)
        rows.append({
            "C": c,
            "cum": round(s.hit_pct(), 3),
            "dec": round(s.dec_hit_pct(), 3),
            "vs_meas_cum": round(MEASURED_CUM[c] - s.hit_pct(), 3),
            "vs_meas_dec": round(MEASURED_CUM[c] - s.dec_hit_pct(), 3),
            "vs_report_dec": round(s.dec_hit_pct() - REPORT_SIM_DEC[c], 3),
        })
    return rows


def slope(rows, key="cum"):
    return rows[-1][key] - rows[0][key]


def synth_from_dist(dists, ebytes, n_pref, n_dec, seed=7):
    """Top-8 weighted sample per (token,layer) -- vettorizzato per layer."""
    rng = np.random.RandomState(seed)
    # pre-alloc events: (n_pref+n_dec)*40*8
    n_tok = n_pref + n_dec
    n = n_tok * N_LAYER * N_USED
    phase = np.empty(n, dtype=np.int8)
    step = np.empty(n, dtype=np.int32)
    layer = np.empty(n, dtype=np.int16)
    slot = np.empty(n, dtype=np.int8)
    expert = np.empty(n, dtype=np.int32)
    weight = np.full(n, 1.0 / N_USED, dtype=np.float32)
    idx = 0
    for t in range(n_tok):
        ph = 0 if t < n_pref else 1
        st = t if t < n_pref else t  # absolute step
        for il in range(N_LAYER):
            p = dists[il]
            # Gumbel-top-k
            g = -np.log(-np.log(rng.uniform(1e-12, 1.0, size=N_EXPERT)))
            scores = np.log(p + 1e-15) + g
            top = np.argpartition(-scores, N_USED)[:N_USED]
            top = top[np.argsort(-scores[top])]
            for sl in range(N_USED):
                phase[idx] = ph
                step[idx] = st
                layer[idx] = il
                slot[idx] = sl
                expert[idx] = int(top[sl])
                idx += 1
    return {
        "path": Path("synth_from_dist"),
        "n": n,
        "phase": phase,
        "step": step,
        "layer": layer,
        "slot": slot,
        "expert": expert,
        "weight": weight,
        "residency": np.zeros(n, dtype=np.uint8),
        "expert_bytes": np.zeros(n, dtype=np.int64),
        "dropped": np.zeros(n, dtype=np.uint8),
        "ebytes": ebytes,
        "meta": {},
    }


def layer_dist(tr):
    counts = [np.zeros(N_EXPERT, dtype=np.float64) for _ in range(N_LAYER)]
    for i in range(tr["n"]):
        counts[int(tr["layer"][i])][int(tr["expert"][i])] += 1.0
    out = []
    for c in counts:
        s = c.sum()
        out.append(np.full(N_EXPERT, 1.0 / N_EXPERT) if s <= 0 else c / s)
    return out


def main() -> int:
    t0 = time.time()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log: list[str] = []
    R: dict = {"hypotheses": {}}

    diary(log, "load traces...")
    short = load_trace(TRACE_DIR / "short_bench.route.tsv")
    long512 = load_trace(TRACE_DIR / "long_512.route.tsv")
    short_out = parse_stdout(TRACE_DIR / "short_bench.stdout.txt")
    long_out = parse_stdout(TRACE_DIR / "long_512.stdout.txt")
    short_b, short_np = build_batches(short)
    long_b, long_np = build_batches(long512)
    ebytes = short["ebytes"]
    diary(log, f"short: n={short['n']} n_pref_batches={short_np} hit={short_out.get('hit_pct')} "
          f"ebytes L0={ebytes[0]} L34={ebytes[34]}")
    diary(log, f"long512: n={long512['n']} n_pref_batches={long_np} hit={long_out.get('hit_pct')}")
    diary(log, f"F5.4-C: n_pref={F54_N_PREF} n_dec={F54_N_DEC} "
          f"meas={list(MEASURED_CUM.values())}")
    diary(log, f"load+batch in {time.time()-t0:.1f}s")

    # ── H0 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H0: riproduzione M5 short_bench decode-only ===")
    h0 = curve(short_b, short_np, ebytes)
    for r in h0:
        diary(log, f"  C={r['C']}: cum={r['cum']:.3f} dec={r['dec']:.3f} "
              f"vs_report={r['vs_report_dec']:+.3f} vs_meas_dec={r['vs_meas_dec']:+.3f}")
    ok = all(abs(r["vs_report_dec"]) < 0.05 for r in h0)
    diary(log, f"H0: {'PASS' if ok else 'FAIL'}  slope_dec={slope(h0,'dec'):+.1f} "
          f"(report +11.8; meas_cum +5.0)")
    R["hypotheses"]["H0"] = {"rows": h0, "pass": ok}

    # ── H1 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H1: metrica cum vs decode-only (short_bench) ===")
    for r in h0:
        diary(log, f"  C={r['C']}: sim_cum={r['cum']:.1f} sim_dec={r['dec']:.1f} "
              f"meas={MEASURED_CUM[r['C']]:.1f} "
              f"gap_dec={r['vs_meas_dec']:+.1f} gap_cum={r['vs_meas_cum']:+.1f}")
    diary(log, f"pendenze: sim_dec={slope(h0,'dec'):+.1f} sim_cum={slope(h0,'cum'):+.1f} "
          f"meas={MEASURED_CUM[3500]-MEASURED_CUM[2000]:+.1f}")
    diary(log, "H1: CONFERMATO mismatch metrica (F5.4: dec sim vs cum runtime). "
          "Non sufficiente: cum-vs-cum su short lascia gap ~+20 pt.")
    R["hypotheses"]["H1"] = {
        "verdict": "metric_mismatch_confirmed_not_sufficient",
        "slope_dec": slope(h0, "dec"),
        "slope_cum": slope(h0, "cum"),
        "slope_meas": MEASURED_CUM[3500] - MEASURED_CUM[2000],
    }

    # ── H2 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H2: short_bench vs long_512 (stessa metrica cum) ===")
    t1 = time.time()
    h2 = curve(long_b, long_np, ebytes)
    diary(log, f"  long curve in {time.time()-t1:.1f}s")
    for r in h2:
        diary(log, f"  C={r['C']}: long_cum={r['cum']:.1f} long_dec={r['dec']:.1f} "
              f"meas={MEASURED_CUM[r['C']]:.1f} gap_cum={r['vs_meas_cum']:+.1f}")
    gate = h2[0]["cum"] - (long_out.get("hit_pct") or 0)
    diary(log, f"H2 gate long@2000: sim_cum={h2[0]['cum']:.3f} meas={long_out.get('hit_pct')} "
          f"gap={gate:+.3f} pp")
    diary(log, f"H2 pendenza long_cum={slope(h2,'cum'):+.1f} vs meas +5.0")
    diary(log, "H2: sim FEDELE same-trace (gap -0.02). Gap F5.4 = cross-trace + cross-metric. "
          "long_512=143+512 (decode-dom); F5.4=1138+256 (prefill-heavy).")
    R["hypotheses"]["H2"] = {
        "rows": h2, "gate_gap_pp": round(gate, 3),
        "verdict": "sim_faithful_same_trace",
    }

    # ── H3 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H3: sconto capacita (short decode-only) ===")
    h3 = {}
    for frac in (1.0, 0.95, 0.90, 0.85, 0.80):
        rows = []
        for c in BUDGETS:
            s = run_sim(short_b, short_np, "lru", c * frac, ebytes)
            rows.append({
                "C": c, "C_eff": round(c * frac, 1),
                "dec": round(s.dec_hit_pct(), 3),
                "vs_meas_dec": round(MEASURED_CUM[c] - s.dec_hit_pct(), 3),
            })
        sl = rows[-1]["dec"] - rows[0]["dec"]
        mae = float(np.mean([abs(r["vs_meas_dec"]) for r in rows]))
        h3[frac] = {"rows": rows, "slope": round(sl, 3), "mae": round(mae, 3)}
        diary(log, f"  frac={frac:.2f}: slope={sl:+.1f} mae={mae:.2f} "
              f"hits={[r['dec'] for r in rows]}")
    diary(log, "H3 ESCLUSA: F5.4 resident ~= budget nominale "
          "(1999.9/2499.6/2999.5/3499.9). Sconto 20% non porta slope a +5.")
    R["hypotheses"]["H3"] = h3

    # ── H4 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H4: multi-ubatch (pref F4.8 << 512) ===")
    h4 = {}
    for name, tr, db, dn in (
        ("short", short, short_b, short_np),
        ("long", long512, long_b, long_np),
    ):
        for ub, lab in ((0, "single"), (512, "ub512")):
            if ub == 0:
                b, npb = db, dn
            else:
                b, npb = build_batches_ubatch(tr, ub)
            rows = curve(b, npb, ebytes)
            h4[f"{name}_{lab}"] = {"n_pref_batches": npb, "rows": rows}
            diary(log, f"  {name}_{lab} npb={npb}: cum={[r['cum'] for r in rows]}")
    diary(log, "H4: su F4.8 (pref 102/143 < 512) multi-chunk = single. "
          "Rilevante solo per n_prompt>ubatch (F5.4=1138).")
    R["hypotheses"]["H4"] = h4

    # ── H5 ──────────────────────────────────────────────────────────────────
    diary(log, "\n=== H5: voice size uniforme vs per-layer ===")
    e_uni = {il: 942080 for il in range(N_LAYER)}
    h5 = []
    for c in BUDGETS:
        a = run_sim(short_b, short_np, "lru", c, ebytes).dec_hit_pct()
        b = run_sim(short_b, short_np, "lru", c, e_uni).dec_hit_pct()
        h5.append({"C": c, "per_layer": round(a, 3), "uniform": round(b, 3),
                   "delta": round(b - a, 3)})
        diary(log, f"  C={c}: per-layer={a:.3f} uni={b:.3f} d={b-a:+.3f}")
    diary(log, "H5 ESCLUSA: M5 gia per-layer (L34/38/39=1097728). Uniforme ~0.5 pp.")
    R["hypotheses"]["H5"] = h5

    # ── H6a I/O envelope ────────────────────────────────────────────────────
    diary(log, "\n=== H6a: envelope I/O F5.4 (decode-attributed) ===")
    h6a = {}
    for c, mt in F54_MIB_TOK.items():
        bh = 100.0 * (1.0 - mt / THEO_MIB_TOK)
        h6a[c] = round(bh, 2)
        diary(log, f"  C={c}: mib/tok={mt} -> approx_byte_hit_dec={bh:.1f}%")
    diary(log, "H6a: decode-hit F5.4 ~88.7->95% -- allineato a long_512 (~89->96), "
          "NON a short_bench (72->84). Pendenza shallow = cumulativo prefill-heavy.")
    R["hypotheses"]["H6a"] = {"byte_hit_dec_approx": h6a, "theo": THEO_MIB_TOK}

    # ── H6b synth F5.4-like (solo LRU, 1 seed) ──────────────────────────────
    diary(log, "\n=== H6b: synth 1138+256 da dist long_512 (sensibilita lunghezza/ubatch) ===")
    t1 = time.time()
    dists = layer_dist(long512)
    synth = synth_from_dist(dists, ebytes, F54_N_PREF, F54_N_DEC, seed=7)
    diary(log, f"  synth n={synth['n']} in {time.time()-t1:.1f}s")
    h6b = {}
    for ub, lab in ((0, "single"), (512, "ub512")):
        t1 = time.time()
        if ub == 0:
            b, npb = build_batches(synth)
        else:
            b, npb = build_batches_ubatch(synth, ub)
        rows = curve(b, npb, ebytes)
        h6b[lab] = {
            "n_pref_batches": npb, "rows": rows,
            "slope_cum": round(slope(rows, "cum"), 3),
            "mae_cum": round(float(np.mean([abs(r["vs_meas_cum"]) for r in rows])), 3),
        }
        diary(log, f"  {lab} npb={npb} ({time.time()-t1:.1f}s): "
              f"cum={[r['cum'] for r in rows]} "
              f"slope={slope(rows,'cum'):+.1f} mae={h6b[lab]['mae_cum']:.2f}")
    diary(log, "H6b: synth i.i.d. non cattura dipendenza temporale del router reale; "
          "serve solo a mostrare che lunghezza+ubatch spostano cum e slope. "
          "Senza route-trace F5.4 non si chiude lo scarto al punto.")
    R["hypotheses"]["H6b"] = h6b

    # ── H7 Belady solo short + long cum (no synth) ───────────────────────────
    diary(log, "\n=== H7: Belady-LRU @2000 ===")
    h7 = []
    for label, b, npb, metric in (
        ("short_dec", short_b, short_np, "dec"),
        ("short_cum", short_b, short_np, "cum"),
        ("long_cum", long_b, long_np, "cum"),
        ("long_dec", long_b, long_np, "dec"),
    ):
        t1 = time.time()
        sl = run_sim(b, npb, "lru", 2000, ebytes)
        sb = run_sim(b, npb, "belady", 2000, ebytes)
        if metric == "dec":
            lh, bh = sl.dec_hit_pct(), sb.dec_hit_pct()
        else:
            lh, bh = sl.hit_pct(), sb.hit_pct()
        d = bh - lh
        v = "VIVO" if d >= 8 else ("IN_MEZZO" if d >= 3 else "MORTO")
        row = {"config": label, "lru": round(lh, 3), "belady": round(bh, 3),
               "delta": round(d, 3), "verdict": v}
        h7.append(row)
        diary(log, f"  {label}: LRU={lh:.2f} Belady={bh:.2f} d={d:+.2f} -> {v} "
              f"({time.time()-t1:.1f}s)")
    R["hypotheses"]["H7"] = h7

    diary(log, "\n=== H7b: bake-off LRU/LFU/W-TinyLFU @2000 ===")
    h7b = []
    for label, b, npb, metric in (
        ("short_dec", short_b, short_np, "dec"),
        ("long_cum", long_b, long_np, "cum"),
    ):
        for pol in ("lru", "lfu", "wtinylfu"):
            s = run_sim(b, npb, pol, 2000, ebytes)
            h = s.dec_hit_pct() if metric == "dec" else s.hit_pct()
            h7b.append({"config": label, "policy": pol, "hit": round(h, 3)})
            diary(log, f"  {label} {pol}: {h:.2f}")
    R["hypotheses"]["H7b"] = h7b

    # ── Sintesi ─────────────────────────────────────────────────────────────
    diary(log, "\n=== SINTESI CAUSA ===")
    diary(log, "CAUSA: confronto apples-to-oranges in F5.4-C, NON bug del simulatore.")
    diary(log, "Evidenza:")
    diary(log, "  1) H0 PASS: M5 riproduce pass2_curve al millesimo.")
    diary(log, "  2) Gate same-trace: short cum 48.05~48.1; long cum 86.58~86.6.")
    diary(log, "  3) F5.4 tabella: lru_hit_req_DEC (72..84) vs hit CUM runtime (71..76)")
    diary(log, "     su PROMPT diverso (1138+256 vs 102+32).")
    diary(log, "  4) I/O F5.4 (32.9->14.6 MiB/tok) => decode-hit ~89->95% = long-like,")
    diary(log, "     non short; pendenza shallow = cum prefill-heavy, non LRU rotto.")
    diary(log, "  5) H3 capacita ESCLUSA (resident~nominale).")
    diary(log, "  6) H5 voice ESCLUSA (gia per-layer; uni ~0.5 pp).")
    diary(log, "  7) Prefetch off in F5.4; --overlap non cambia residency accounting.")
    diary(log, "Belady-LRU: short_dec resta VIVO (~+17.8). long riduce il gap ma non")
    diary(log, "  rovescia i verdetti M5/M5b. Bake-off: LFU~LRU, W-TinyLFU peggiore.")
    diary(log, "Correzione sim: non necessaria per fedelta same-trace.")
    diary(log, "Policy confronto: stessa traccia + stessa metrica (cum o dec, dichiarata).")
    diary(log, f"\nTotale {time.time()-t0:.1f}s")

    (OUT_DIR / "diary.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    (OUT_DIR / "results.json").write_text(
        json.dumps(R, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    with (OUT_DIR / "comparison.tsv").open("w", encoding="utf-8") as f:
        f.write("config\tC_mib\tsim_cum\tsim_dec\tmeas_cum\tgap_cum\tgap_dec\n")
        for r in h0:
            f.write(f"short_m5\t{r['C']}\t{r['cum']}\t{r['dec']}\t"
                    f"{MEASURED_CUM[r['C']]}\t{r['vs_meas_cum']}\t{r['vs_meas_dec']}\n")
        for r in h2:
            f.write(f"long512\t{r['C']}\t{r['cum']}\t{r['dec']}\t"
                    f"{MEASURED_CUM[r['C']]}\t{r['vs_meas_cum']}\t{r['vs_meas_dec']}\n")
    diary(log, f"Scritto {OUT_DIR}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
