#!/usr/bin/env python3
"""Paired bootstrap CIs for the eval gate.

Input: two per-item JSON files as written by run_gen_eval.py (items with
{id, pass}) or per-segment bpb JSONs as written by run_bpb_eval.py (a dict
lang -> {"chunks": [bpb...]}). The two inputs must be the SAME items/
chunks in the SAME order (the gate is paired by construction: fixed
holdouts, same build, same session).

Output: per metric, the two values, the diff (a - b), and the 95% percentile
bootstrap CI of the diff (resampling units with replacement, paired — the
same resampled unit indices are applied to both models).

Usage:
  bootstrap_ci.py --a results_a.json --b results_b.json [--resamples 10000]
                  [--seed 42]          # run_gen_eval.py outputs
  bootstrap_ci.py --a bpb_a.json --b bpb_b.json --bpb [--langs en,it]
"""

import argparse
import json
import random
import sys


def paired_ci(units_a, units_b, resamples: int, rng: random.Random):
    assert len(units_a) == len(units_b) and units_a, "inputs must align"
    n = len(units_a)
    diffs = []
    for _ in range(resamples):
        sa = sb = 0.0
        for _ in range(n):
            j = rng.randrange(n)
            sa += units_a[j]
            sb += units_b[j]
        diffs.append((sa - sb) / n)
    diffs.sort()
    mean_a = sum(units_a) / n
    mean_b = sum(units_b) / n
    lo = diffs[int(0.025 * resamples)]
    hi = diffs[min(resamples - 1, int(0.975 * resamples))]
    return mean_a, mean_b, mean_a - mean_b, lo, hi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="model A JSON (per-item or bpb)")
    ap.add_argument("--b", required=True, help="model B JSON, same units")
    ap.add_argument("--bpb", action="store_true", help="inputs are per-doc bpb files")
    ap.add_argument("--langs", default="", help="comma list (bpb only; default all)")
    ap.add_argument("--resamples", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    rng = random.Random(a.seed)

    if a.bpb:
        da, db = json.load(open(a.a)), json.load(open(a.b))
        langs = a.langs.split(",") if a.langs else sorted(da)
        for lang in langs:
            ma, mb = da[lang]["chunks"], db[lang]["chunks"]
            va, vb, d, lo, hi = paired_ci(ma, mb, a.resamples, rng)
            print(f"bpb {lang}: A {va:.4f}  B {vb:.4f}  diff {d:+.4f} "
                  f"[95% CI {lo:+.4f}, {hi:+.4f}]  (n={len(ma)} chunks)")
    else:
        da, db = json.load(open(a.a)), json.load(open(a.b))
        ia = {i["id"]: i["pass"] for i in da["items"]}
        ib = {i["id"]: i["pass"] for i in db["items"]}
        assert set(ia) == set(ib), "item sets differ — gate is not paired"
        ids = sorted(ia)
        va, vb, d, lo, hi = paired_ci([ia[i] for i in ids], [ib[i] for i in ids],
                                      a.resamples, rng)
        print(f"{da['dataset']}: A {va:.4f} ({da['ok']}/{da['n']})  "
              f"B {vb:.4f} ({db['ok']}/{db['n']})  diff {d:+.4f} "
              f"[95% CI {lo:+.4f}, {hi:+.4f}]  (n={len(ids)} items)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
