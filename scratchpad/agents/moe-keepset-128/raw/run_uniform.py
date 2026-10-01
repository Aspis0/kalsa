#!/usr/bin/env python3
"""Content-disjoint recompute of the v3 uniform comparators: balanced 128/160/192/224,
EN-only 128, RAZOR 128, random 128 (Monte Carlo null, fixed seed)."""

import random
import sys

import numpy as np

import k128_common as k
import router_data as v3

N_RANDOM_DRAWS = 500
SEED = 20261001
BALANCED_SIZES = [128, 160, 192, 224]


def main():
    seg_ids, groups, tokens, counts, mass, manifest = k.load_all()
    splits = k.make_splits(seg_ids, groups, manifest)
    razor_mask = v3.razor_keep_masks(f"{k.V3_RAW}/kept_expert_indices.json")
    master = random.Random(SEED)
    rows = []
    null_rows = []
    for split, (calib, test) in enumerate(splits):
        mass_cal = {g: mass[calib[g]] for g in v3.KEEP_GROUPS}
        tokens_cal = {g: float(tokens[calib[g]].sum()) for g in v3.KEEP_GROUPS}
        one = {g: 1.0 for g in v3.KEEP_GROUPS}
        masks = {}
        for size in BALANCED_SIZES:
            masks[f"balanced_u{size}"] = k.topk_mask(k.weighted_score(mass_cal, tokens_cal, one), size)
        masks["en_only_u128"] = k.topk_mask(
            k.weighted_score(mass_cal, tokens_cal, {"en": 1.0}), 128)
        masks["razor_u128"] = razor_mask
        for name, mask in masks.items():
            rows += k.eval_groups(mass, tokens, test, mask, (split, name))
        # random 128-of-256 null, same per-layer draws for every group (as in v3)
        rng = np.random.default_rng(master.randrange(1 << 62))
        totals = {g: float(mass[test[g]].sum()) for g in k.GROUPS}
        kept_acc = {g: np.zeros(N_RANDOM_DRAWS) for g in k.GROUPS}
        for l in range(v3.N_LAYER):
            draw = np.argsort(rng.random((N_RANDOM_DRAWS, v3.N_EXPERT)), axis=1)[:, :128]
            for g in k.GROUPS:
                mt = mass[test[g]][:, l, :]
                kept_acc[g] += mt[:, draw].sum(axis=(0, 2))
        for g in k.GROUPS:
            shares = kept_acc[g] / totals[g]
            toks = int(tokens[test[g]].sum())
            null_rows.append((split, "random_u128", g, toks,
                              float(shares.mean()), float(shares.std())))
            rows.append((split, "random_u128", g, toks, float(shares.mean())))
        print(f"split {split}: done", flush=True)

    k.write_retained(f"{k.OUT_DIR}/uniform_rows.csv", rows)
    with open(f"{k.OUT_DIR}/uniform_null.csv", "w") as f:
        f.write("split,strategy,group,tokens_test,null_mean,null_sd\n")
        for split, name, g, toks, mean, sd in null_rows:
            f.write(f"{split},{name},{g},{toks},{mean:.6f},{sd:.6f}\n")

    # sanity anchor: audit F1.2 content-disjoint balanced 128 (different split RNG)
    agg = {}
    for split, name, g, _, share in rows:
        if name == "balanced_u128":
            agg.setdefault(g, []).append(share)
    audit = {"it": 89.26, "fr": 89.08, "es": 89.83, "en": 86.40, "zh": 84.72,
             "code": 69.59, "math": 75.37}
    print("balanced_u128 vs audit F1.2 (pp):")
    for g, v in audit.items():
        mine = 100 * sum(agg[g]) / len(agg[g])
        print(f"  {g:4s} mine={mine:5.2f} audit={v:5.2f} diff={mine - v:+.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
