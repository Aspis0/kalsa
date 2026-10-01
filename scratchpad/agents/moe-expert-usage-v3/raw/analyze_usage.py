#!/usr/bin/env python3
"""Held-out expert-usage analysis: keep-set selection on calibration segments,
retained-mass evaluation on test segments, against RAZOR / random-null / EN-only.

Every number that reaches the report is computed only on test segments of each
random calibration/test split. Outputs long-format CSVs plus a summary."""

import random
import sys

import numpy as np

from router_data import (KEEP_GROUPS, KEEP_SIZES, N_EXPERT, N_LAYER, OVERLAP_GROUPS,
                         SACRIFICE_GROUPS, bootstrap_ci, group_indices, load_manifest,
                         load_segments, razor_keep_masks, retained_share, split_half)

RUNS_DIR = __import__("os").environ.get("ROUTER_RUNS_DIR", "/tmp/moe-expert-usage-v3/runs")
OUT_DIR = __import__("os").environ.get("ROUTER_OUT_DIR", __import__("os").path.expanduser(
    "~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw"))
RAZOR_JSON = f"{OUT_DIR}/kept_expert_indices.json"
N_SPLITS = 5
N_BOOT = 2000
N_RANDOM_DRAWS = 2000
MIN_SELECTIONS = 16  # an expert must draw at least this many test selections to be judged
SEED = 20261001


def top_sets(mass_sum, size):
    """mass_sum: [layer, expert] -> per-layer indices of the top `size` experts, ties by lower id."""
    order = np.argsort(-mass_sum, axis=1, kind="stable")
    return order[:, :size]


def keep_score(mass_cal, tokens_cal, groups_cal):
    """Balanced score: per group, selected mass per token on calibration, averaged equally."""
    score = np.zeros((N_LAYER, N_EXPERT))
    for g in groups_cal:
        score += mass_cal[g].sum(axis=0) / tokens_cal[g]
    return score / len(groups_cal)


def main():
    groups, tokens, counts, mass = load_segments(RUNS_DIR)
    manifest = load_manifest(f"{OUT_DIR}/corpus/manifest.csv")
    if len(manifest) != len(groups):
        raise SystemExit("manifest size mismatch")
    gidx = group_indices(groups)
    razor_keep = razor_keep_masks(RAZOR_JSON)

    curve_f = open(f"{OUT_DIR}/curve_retained_mass.csv", "w")
    curve_f.write("split,size,comparator,group,tokens_test,retained_share,boot_lo,boot_hi\n")
    null_f = open(f"{OUT_DIR}/random_null.csv", "w")
    null_f.write("split,size,group,null_mean,null_sd\n")
    dom_f = open(f"{OUT_DIR}/sacrifice_dominated.csv", "w")
    dom_f.write("split,layer,n_dominated,n_eligible\n")
    ov_f = open(f"{OUT_DIR}/topk_overlap.csv", "w")
    ov_f.write("split,layer,group_a,group_b,jaccard\n")

    master_rng = random.Random(SEED)
    for split in range(N_SPLITS):
        rng = np.random.default_rng(master_rng.randrange(1 << 62))

        calib, test = {}, {}
        for g in gidx:
            calib[g], test[g] = split_half(gidx[g], rng)
        mass_cal = {g: mass[calib[g]] for g in gidx}
        tokens_cal = {g: float(tokens[calib[g]].sum()) for g in gidx}
        mass_test = {g: mass[test[g]] for g in gidx}

        sets = {"razor": ("razor", razor_keep)}
        for size in KEEP_SIZES:
            balanced = top_sets(keep_score(mass_cal, tokens_cal, KEEP_GROUPS), size)
            en_only = top_sets(keep_score(mass_cal, tokens_cal, ["en"]), size)
            sets[f"balanced{size}"] = ("balanced", balanced)
            sets[f"en_only{size}"] = ("en_only", en_only)
        # boolean masks per comparator
        masks = {}
        for name, (label, idx_sets) in sets.items():
            m = np.zeros((N_LAYER, N_EXPERT), dtype=bool)
            if name == "razor":
                m = idx_sets
            else:
                for l in range(N_LAYER):
                    m[l, idx_sets[l]] = True
            masks[name] = (label, m)

        # bootstrap CIs per group for every fixed comparator
        for name, (label, mask) in masks.items():
            size = 128 if name == "razor" else int(name.partition(label)[2])
            for g in gidx:
                mt = mass[test[g]]
                kept, total = mt[:, mask].sum(axis=1), mt.sum(axis=(1, 2))
                share = kept.sum() / total.sum()
                lo, hi = bootstrap_ci(kept, total, N_BOOT, rng)
                curve_f.write(f"{split},{size},{label},{g},"
                              f"{int(tokens[test[g]].sum())},{share:.6f},{lo:.6f},{hi:.6f}\n")

        # random-null distribution of retained share, same aggregation as the point
        # estimates: per draw, share = kept mass summed over layers / total mass.
        # The same per-layer draws are used for every group, so cross-group comparisons
        # share Monte Carlo noise.
        totals_test = {g: float(mass_test[g].sum()) for g in gidx}
        for size in KEEP_SIZES:
            kept_acc = {g: np.zeros(N_RANDOM_DRAWS) for g in gidx}
            for l in range(N_LAYER):
                keys = rng.random((N_RANDOM_DRAWS, N_EXPERT))
                draw = np.argsort(keys, axis=1)[:, :size]
                for g in gidx:
                    mt = mass_test[g][:, l, :]
                    kept_acc[g] += mt[:, draw].sum(axis=(0, 2))
            for g in gidx:
                shares = kept_acc[g] / totals_test[g]
                null_f.write(f"{split},{size},{g},{shares.mean():.6f},{shares.std():.6f}\n")

        # experts predominantly used by SACRIFICE groups (test segments)
        mt_all = np.concatenate([mass_test[g] for g in gidx])
        ct_all = np.concatenate([counts[test[g]] for g in gidx])
        mt_sac = np.concatenate([mass_test[g] for g in SACRIFICE_GROUPS])
        mass_tot = mt_all.sum(axis=0)
        mass_sac = mt_sac.sum(axis=0)
        sel_tot = ct_all.sum(axis=0)
        for l in range(N_LAYER):
            with np.errstate(invalid="ignore", divide="ignore"):
                share = np.where(mass_tot[l] > 0, mass_sac[l] / mass_tot[l], 0.0)
            eligible = sel_tot[l] >= MIN_SELECTIONS
            dom_f.write(f"{split},{l},{int((eligible & (share >= 0.8)).sum())},"
                        f"{int(eligible.sum())}\n")

        # per-layer Jaccard overlap of top-128 sets among the headline groups
        top128 = {}
        for g in OVERLAP_GROUPS:
            top128[g] = top_sets(mass_test[g].sum(axis=0), 128)
        for l in range(N_LAYER):
            for i, a in enumerate(OVERLAP_GROUPS):
                for b in OVERLAP_GROUPS[i + 1:]:
                    sa, sb = set(top128[a][l].tolist()), set(top128[b][l].tolist())
                    ov_f.write(f"{split},{l},{a},{b},{len(sa & sb) / len(sa | sb):.6f}\n")

        print(f"split {split}: done", flush=True)

    for f in (curve_f, null_f, dom_f, ov_f):
        f.close()
    print("wrote curve_retained_mass.csv random_null.csv sacrifice_dominated.csv topk_overlap.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
