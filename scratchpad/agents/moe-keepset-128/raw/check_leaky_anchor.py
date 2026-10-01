#!/usr/bin/env python3
"""Anchor check: reproduce v3's original per-group (leaky) split with its exact RNG stream
and compare balanced-128 retained mass to v3's published means. If this matches, the
selection/evaluation code is identical to v3 and the offset vs the audit's content-disjoint
run is split-set RNG, not a code defect."""

import random
import sys

import numpy as np

import k128_common as k
import router_data as v3

PUBLISHED = {"it": 89.4, "fr": 89.3, "es": 89.9, "en": 86.6, "zh": 85.3,
             "code": 70.0, "math": 74.7}


def main():
    seg_ids, groups, tokens, counts, mass, manifest = k.load_all()
    idx_by_group = v3.group_indices(groups)  # dict order == v3's run-order insertion
    master = random.Random(20261001)         # v3's seed and stream order
    agg = {g: [] for g in PUBLISHED}
    for _ in range(5):
        rng = np.random.default_rng(master.randrange(1 << 62))
        calib, test = {}, {}
        for g, idx in idx_by_group.items():
            perm = rng.permutation(idx)
            calib[g], test[g] = perm[:len(perm) // 2], perm[len(perm) // 2:]
        mass_cal = {g: mass[calib[g]] for g in v3.KEEP_GROUPS}
        tokens_cal = {g: float(tokens[calib[g]].sum()) for g in v3.KEEP_GROUPS}
        one = {g: 1.0 for g in v3.KEEP_GROUPS}
        mask = k.topk_mask(k.weighted_score(mass_cal, tokens_cal, one), 128)
        for split, name, g, _, share in k.eval_groups(mass, tokens, test, mask, (0, "balanced128")):
            if name == "balanced128" and g in agg:
                agg[g].append(100 * share)
    bad = 0
    print("balanced128 leaky-repro vs v3 published (pp):")
    for g, pub in PUBLISHED.items():
        mine = sum(agg[g]) / len(agg[g])
        print(f"  {g:4s} mine={mine:5.2f} published={pub:5.2f} diff={mine - pub:+.2f}")
        if abs(mine - pub) > 0.3:
            bad += 1
    print("MISMATCH" if bad else "ANCHOR OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
