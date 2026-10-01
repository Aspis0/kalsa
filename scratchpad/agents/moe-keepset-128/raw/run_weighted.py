#!/usr/bin/env python3
"""Task A: weighted keep-sets at 128 experts/layer on content-disjoint splits.

score = sum over KEEP groups of w_g * per-token-normalised calibration mass; language
weights fixed at 1, a single code/math weight w_cm swept. Retained mass evaluated on the
split's test segments for all 12 groups."""

import sys

import k128_common as k
import router_data as v3

W_CM = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
SIZE = 128


def main():
    seg_ids, groups, tokens, counts, mass, manifest = k.load_all()
    splits = k.make_splits(seg_ids, groups, manifest)
    rows = []
    for split, (calib, test) in enumerate(splits):
        mass_cal = {g: mass[calib[g]] for g in v3.KEEP_GROUPS}
        tokens_cal = {g: float(tokens[calib[g]].sum()) for g in v3.KEEP_GROUPS}
        for w in W_CM:
            weights = {g: 1.0 for g in k.LANG_GROUPS}
            weights["code"] = weights["math"] = w
            mask = k.topk_mask(k.weighted_score(mass_cal, tokens_cal, weights), SIZE)
            rows += k.eval_groups(mass, tokens, test, mask,
                                  (split, f"weighted_w{w:g}_u{SIZE}"))
        print(f"split {split}: done", flush=True)
    k.write_retained(f"{k.OUT_DIR}/weighted_sweep.csv", rows)
    print(f"wrote weighted_sweep.csv ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
