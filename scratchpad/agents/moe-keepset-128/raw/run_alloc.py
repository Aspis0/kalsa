#!/usr/bin/env python3
"""Tasks B and C: non-uniform per-layer expert allocation at the same total budget
(40 x 128 = 5120) on content-disjoint splits, and its combination with weighted scores.

B: global ranking of (layer, expert) by the per-layer-normalised score (score divided by
that layer's score total, so layers compete fairly), per-layer floor 64/96, cap 256; plus a
greedy marginal-gain allocation (next expert to the layer where it adds the most normalised
score). Balanced weights. C: the same allocations with the code/math weight from task A."""

import heapq
import sys

import numpy as np

import k128_common as k
import router_data as v3

TOTAL = 40 * 128
FLOORS = [64, 96]
WEIGHTS = [1.0, 2.0, 4.0]


def global_alloc(score, floor):
    """Floor experts per layer by rank, then fill the remaining budget in global
    normalised-score order."""
    layer_sum = score.sum(axis=1, keepdims=True)
    if (layer_sum <= 0).any():
        raise SystemExit("layer with zero calibration score")
    norm = score / layer_sum
    mask = k.topk_mask(norm, floor)
    remaining = TOTAL - floor * v3.N_LAYER
    for flat in np.argsort(-norm, axis=None, kind="stable"):
        if remaining <= 0:
            break
        l, e = divmod(int(flat), v3.N_EXPERT)
        if not mask[l, e]:
            mask[l, e] = True
            remaining -= 1
    counts = mask.sum(axis=1)
    if remaining != 0 or counts.max() > v3.N_EXPERT or counts.min() < floor:
        raise SystemExit("allocation invariant violated")
    return mask, counts


def greedy_alloc(score):
    """Heap-merge layers by their next expert's normalised score until TOTAL assigned."""
    layer_sum = score.sum(axis=1, keepdims=True)
    norm = score / layer_sum
    order = np.argsort(-score, axis=1, kind="stable")
    heap = [(-norm[l, order[l, 0]], l, 0) for l in range(v3.N_LAYER)]
    heapq.heapify(heap)
    mask = np.zeros((v3.N_LAYER, v3.N_EXPERT), dtype=bool)
    picks = 0
    while picks < TOTAL:
        _, l, i = heapq.heappop(heap)
        mask[l, order[l, i]] = True
        picks += 1
        if i + 1 < v3.N_EXPERT:
            heapq.heappush(heap, (-norm[l, order[l, i + 1]], l, i + 1))
    return mask, mask.sum(axis=1)


def main():
    seg_ids, groups, tokens, counts, mass, manifest = k.load_all()
    splits = k.make_splits(seg_ids, groups, manifest)
    ret_rows, count_rows = [], []
    for split, (calib, test) in enumerate(splits):
        mass_cal = {g: mass[calib[g]] for g in v3.KEEP_GROUPS}
        tokens_cal = {g: float(tokens[calib[g]].sum()) for g in v3.KEEP_GROUPS}
        for w in WEIGHTS:
            weights = {g: 1.0 for g in k.LANG_GROUPS}
            weights["code"] = weights["math"] = w
            score = k.weighted_score(mass_cal, tokens_cal, weights)
            plans = [(f"global_w{w:g}_f{f}", *global_alloc(score, f)) for f in FLOORS]
            plans.append((f"greedy_w{w:g}", *greedy_alloc(score)))
            for name, mask, cnt in plans:
                ret_rows += k.eval_groups(mass, tokens, test, mask, (split, name))
                for l in range(v3.N_LAYER):
                    count_rows.append((split, name, l, int(cnt[l])))
                print(f"split {split} {name}: per-layer min={cnt.min()} "
                      f"max={cnt.max()} mean={cnt.mean():.1f}", flush=True)
    k.write_retained(f"{k.OUT_DIR}/alloc_retained.csv", ret_rows)
    with open(f"{k.OUT_DIR}/alloc_counts.csv", "w") as f:
        f.write("split,strategy,layer,n_kept\n")
        for split, name, l, n in count_rows:
            f.write(f"{split},{name},{l},{n}\n")
    print(f"wrote alloc_retained.csv alloc_counts.csv ({len(ret_rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
