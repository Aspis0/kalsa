#!/usr/bin/env python3
"""F5.6 analysis: DeltaPPL vs k8 on part1, block bootstrap CI, position overlap.

Inputs (local mirror of phone results/f5.6/<variant>/):
  per_token.csv  pos,token_id,logprob
  result.json    optional ppl summary

Block bootstrap on contiguous windows (default 512 positions) — tokens are
correlated; token-level bootstrap would understate CI width.

Thresholds (declared BEFORE numbers):
  DeltaPPL <= 0.05           -> candidabile
  0.05 < DeltaPPL <= 0.15    -> solo con lettura umana
  DeltaPPL > 0.15            -> archiviata
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np


def load_csv(path: Path) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    pos, tid, lp = [], [], []
    with path.open(encoding="utf-8") as f:
        header = next(f).strip()
        assert header.startswith("pos"), header
        for line in f:
            line = line.strip()
            if not line:
                continue
            a, b, c = line.split(",")
            pos.append(int(a))
            tid.append(int(b))
            lp.append(float(c))
    return np.asarray(pos), np.asarray(tid), np.asarray(lp, dtype=np.float64)


def ppl_from_lp(lp: np.ndarray) -> float:
    return float(math.exp(-float(lp.mean())))


def block_means(lp: np.ndarray, block: int) -> np.ndarray:
    n = len(lp)
    n_blocks = n // block
    if n_blocks < 2:
        # fall back to whole-series mean only
        return np.asarray([lp.mean()], dtype=np.float64)
    usable = n_blocks * block
    return lp[:usable].reshape(n_blocks, block).mean(axis=1)


def bootstrap_delta_ppl(
    lp_ref: np.ndarray,
    lp_var: np.ndarray,
    block: int = 512,
    n_boot: int = 5000,
    seed: int = 42,
) -> Dict[str, float]:
    """Paired block bootstrap of DeltaPPL = ppl_var - ppl_ref.

    Resample blocks with replacement, recompute mean logprob per arm, convert
    to PPL, take difference. 95% percentile CI.
    """
    assert len(lp_ref) == len(lp_var)
    br = block_means(lp_ref, block)
    bv = block_means(lp_var, block)
    n_blocks = len(br)
    rng = random.Random(seed)
    deltas = []
    for _ in range(n_boot):
        idx = [rng.randrange(n_blocks) for _ in range(n_blocks)]
        mr = float(np.mean([br[i] for i in idx]))
        mv = float(np.mean([bv[i] for i in idx]))
        ppl_r = math.exp(-mr)
        ppl_v = math.exp(-mv)
        deltas.append(ppl_v - ppl_r)
    arr = np.asarray(deltas, dtype=np.float64)
    return {
        "n_blocks": n_blocks,
        "block": block,
        "n_boot": n_boot,
        "delta_ppl_point": float(ppl_from_lp(lp_var) - ppl_from_lp(lp_ref)),
        "delta_ppl_boot_mean": float(arr.mean()),
        "ci95_lo": float(np.percentile(arr, 2.5)),
        "ci95_hi": float(np.percentile(arr, 97.5)),
    }


def degraded_positions(
    lp_ref: np.ndarray, lp_var: np.ndarray, q: float = 0.90
) -> np.ndarray:
    """Positions where Delta logprob (var - ref) is worst (most negative = more
    surprising under var). Returns boolean mask of the lower (1-q) tail.

    q=0.90 → keep the worst 10% (delta ≤ 10th percentile).
    """
    delta = lp_var - lp_ref  # more negative = worse under var
    thr = np.quantile(delta, 1.0 - q)  # q=0.90 → 0.10 quantile = lower 10%
    return delta <= thr


def jaccard(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else float("nan")


def overlap_pct(a: np.ndarray, b: np.ndarray) -> float:
    """|A∩B| / |A|  (fraction of A's degraded positions also in B)."""
    na = int(a.sum())
    if na == 0:
        return float("nan")
    return float(np.logical_and(a, b).sum() / na)


def verdict(delta: float) -> str:
    if delta <= 0.05:
        return "candidabile"
    if delta <= 0.15:
        return "solo_con_lettura_umana"
    return "archiviata"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True, help="results/f5.6 dir")
    ap.add_argument("--block", type=int, default=512)
    ap.add_argument("--n-boot", type=int, default=5000)
    ap.add_argument("--q-worst", type=float, default=0.90, help="degraded = bottom (1-q)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    root: Path = args.root
    variants = ["k8", "k6", "k5", "k4"]
    data: Dict[str, dict] = {}
    for v in variants:
        csv = root / v / "per_token.csv"
        if not csv.exists():
            print(f"missing {csv}")
            continue
        pos, tid, lp = load_csv(csv)
        rj = root / v / "result.json"
        meta = json.loads(rj.read_text()) if rj.exists() else {}
        data[v] = {
            "pos": pos,
            "tid": tid,
            "lp": lp,
            "ppl": ppl_from_lp(lp),
            "n": len(lp),
            "sum_logprob": float(lp.sum()),
            "meta": meta,
        }
        print(f"{v}: n={len(lp)} ppl={data[v]['ppl']:.6f} sum={data[v]['sum_logprob']:.6f}")

    if "k8" not in data:
        raise SystemExit("k8 reference missing")

    # align lengths (should be identical)
    n_ref = data["k8"]["n"]
    for v, d in data.items():
        if d["n"] != n_ref:
            print(f"WARN {v} n={d['n']} != k8 n={n_ref}; truncating to min")
        # token_id identity check
        m = min(d["n"], n_ref)
        if not np.array_equal(d["tid"][:m], data["k8"]["tid"][:m]):
            raise SystemExit(f"token_id mismatch {v} vs k8 — cannot pair")

    n = min(d["n"] for d in data.values())
    lp8 = data["k8"]["lp"][:n]
    ppl8 = ppl_from_lp(lp8)

    # theoretical traffic (cache_mb=0, proportional to k)
    k_of = {"k8": 8, "k6": 6, "k5": 5, "k4": 4}
    # F5.2 decode mib_tok reference (not measured on ppl path)
    f52_mib = {"k8": 47.52, "k6": 26.14, "k5": None, "k4": 13.12, "drop05": 38.27, "drop10": 7.78}

    rows = []
    degraded = {}
    for v in variants:
        if v not in data:
            continue
        lp = data[v]["lp"][:n]
        ppl = ppl_from_lp(lp)
        delta = ppl - ppl8
        boot = bootstrap_delta_ppl(lp8, lp, block=args.block, n_boot=args.n_boot)
        k = k_of.get(v)
        traf_frac = (k / 8.0) if k else None
        saved = (1.0 - traf_frac) * 100 if traf_frac is not None else None
        # cost-per-traffic: DeltaPPL / %saved  (lower = better lever)
        cost = (delta / saved) if saved and saved > 0 else None
        # F5.2 measured traffic save for cross-check
        mib = f52_mib.get(v)
        mib8 = f52_mib["k8"]
        saved_f52 = ((mib8 - mib) / mib8 * 100) if (mib is not None and mib8) else None
        cost_f52 = (delta / saved_f52) if saved_f52 and saved_f52 > 0 else None

        mask = degraded_positions(lp8, lp, q=args.q_worst)
        degraded[v] = mask

        row = {
            "variant": v,
            "k": k,
            "n_scored": n,
            "ppl": ppl,
            "delta_ppl_vs_k8": delta,
            "boot": boot,
            "hit_pct": 0.0,  # cache_mb=0
            "mib_tok_theoretical_frac": traf_frac,
            "traffic_saved_pct_theoretical": saved,
            "cost_per_traffic_theoretical": cost,
            "mib_tok_f52_decode_ref": mib,
            "traffic_saved_pct_f52_mib": saved_f52,
            "cost_per_traffic_f52_mib": cost_f52,
            "verdict": verdict(delta) if v != "k8" else "riferimento",
            "n_degraded": int(mask.sum()) if v != "k8" else 0,
        }
        rows.append(row)
        print(
            f"{v}: PPL={ppl:.6f} dPPL={delta:.6f} CI[{boot['ci95_lo']:.6f},{boot['ci95_hi']:.6f}] "
            f"saved%={saved} cost={cost} verdict={row['verdict']}"
        )

    # position overlap among k6/k5/k4 degraded sets
    pairs = [("k6", "k5"), ("k6", "k4"), ("k5", "k4")]
    overlaps = []
    for a, b in pairs:
        if a in degraded and b in degraded and a != "k8" and b != "k8":
            overlaps.append(
                {
                    "pair": f"{a}_vs_{b}",
                    "jaccard": jaccard(degraded[a], degraded[b]),
                    "overlap_a_in_b": overlap_pct(degraded[a], degraded[b]),
                    "overlap_b_in_a": overlap_pct(degraded[b], degraded[a]),
                    "n_a": int(degraded[a].sum()),
                    "n_b": int(degraded[b].sum()),
                    "n_inter": int(np.logical_and(degraded[a], degraded[b]).sum()),
                }
            )
            print(
                f"overlap {a}&{b}: jaccard={overlaps[-1]['jaccard']:.4f} "
                f"inter={overlaps[-1]['n_inter']} / {overlaps[-1]['n_a']},{overlaps[-1]['n_b']}"
            )

    # triple intersection
    if all(v in degraded for v in ("k6", "k5", "k4")):
        triple = np.logical_and.reduce([degraded["k6"], degraded["k5"], degraded["k4"]])
        triple_n = int(triple.sum())
        # union of three
        union3 = np.logical_or.reduce([degraded["k6"], degraded["k5"], degraded["k4"]])
        union_n = int(union3.sum())
        triple_j = triple_n / union_n if union_n else float("nan")
    else:
        triple_n = union_n = None
        triple_j = None

    # Spearman correlation of per-position delta across variants
    corrs = []
    for a, b in pairs:
        if a in data and b in data:
            da = data[a]["lp"][:n] - lp8
            db = data[b]["lp"][:n] - lp8
            # spearman via rank
            ra = da.argsort().argsort().astype(np.float64)
            rb = db.argsort().argsort().astype(np.float64)
            ra = (ra - ra.mean()) / (ra.std() + 1e-12)
            rb = (rb - rb.mean()) / (rb.std() + 1e-12)
            rho = float((ra * rb).mean())
            corrs.append({"pair": f"{a}_vs_{b}", "spearman_delta_lp": rho})
            print(f"spearman delta_lp {a} vs {b}: {rho:.4f}")

    out = {
        "phase": "F5.6",
        "subset": "mixed_it.part1",
        "n_scored": n,
        "block_bootstrap": {"block": args.block, "n_boot": args.n_boot},
        "thresholds": {
            "candidabile": "DeltaPPL <= 0.05",
            "solo_con_lettura_umana": "0.05 < DeltaPPL <= 0.15",
            "archiviata": "DeltaPPL > 0.15",
        },
        "k8_ppl": ppl8,
        "rows": rows,
        "position_overlap": {
            "q_worst": args.q_worst,
            "pairs": overlaps,
            "triple_intersection_n": triple_n,
            "triple_union_n": union_n,
            "triple_jaccard": triple_j,
            "spearman_delta_lp": corrs,
            "interpretation_guide": (
                "High Jaccard / Spearman → degradation on SAME positions (true quality loss). "
                "Low / near-chance → different trajectories (noise)."
            ),
        },
        "drop_status": "BLOCKED (requires cache_mb>0; PPL path is prefill-phase, drop_prefill off)",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
