#!/usr/bin/env python3
"""RAZOR check: per group, the share of selected top-k routing mass that lands on
RAZOR-removed experts, with a segment bootstrap CI and a two-sided p-value against
the random-half null (random 128-of-256 keep sets, same layer aggregation)."""

import os
import sys

import numpy as np

from router_data import (N_EXPERT, N_LAYER, bootstrap_ci, group_indices, load_segments,
                         razor_keep_masks)

RUNS_DIR = __import__("os").environ.get("ROUTER_RUNS_DIR", "/tmp/moe-expert-usage-v3/runs")
OUT_DIR = os.environ.get("ROUTER_OUT_DIR", os.path.expanduser(
    "~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw"))
RAZOR_JSON = f"{OUT_DIR}/kept_expert_indices.json"
N_BOOT = 5000
N_NULL_DRAWS = 20000
NULL_SEED = 20261001


def null_removed_shares(mass, rng):
    """Distribution over random 128-of-256 keep sets of the aggregate removed mass share."""
    total = float(mass.sum())
    kept = np.zeros(N_NULL_DRAWS)
    for l in range(N_LAYER):
        keys = rng.random((N_NULL_DRAWS, N_EXPERT))
        draw = np.argsort(keys, axis=1)[:, :N_EXPERT // 2]
        kept += mass[:, l, :][:, draw].sum(axis=(0, 2))
    return (total - kept) / total


def main():
    groups, tokens, counts, mass = load_segments(RUNS_DIR)
    gidx = group_indices(groups)
    removed = ~razor_keep_masks(RAZOR_JSON)

    # per segment: mass and selections on removed experts, summed over layers
    m_rem = mass[:, removed].sum(axis=1)
    s_rem = counts[:, removed].sum(axis=1)
    m_tot = mass.sum(axis=(1, 2))
    s_tot = counts.sum(axis=(1, 2))

    rng = np.random.default_rng(NULL_SEED)
    null_share = null_removed_shares(mass, rng)
    null_mean = null_share.mean()

    out = open(f"{OUT_DIR}/razor_check.csv", "w")
    out.write("group,tokens,removed_mass_share,boot_lo,boot_hi,removed_selection_share,"
              "null_mean,null_sd,p_two_sided\n")
    for g in sorted(gidx):
        rows = gidx[g]
        share = m_rem[rows].sum() / m_tot[rows].sum()
        sel_share = s_rem[rows].sum() / s_tot[rows].sum()
        lo, hi = bootstrap_ci(m_rem[rows], m_tot[rows], N_BOOT, rng)
        # two-sided p: chance of a random half deviating from the null mean at least
        # as far as the observed share does
        dev = abs(share - null_mean)
        p = min(1.0, 2 * (1 + np.sum(np.abs(null_share - null_mean) >= dev)) / (N_NULL_DRAWS + 1))
        out.write(f"{g},{int(tokens[rows].sum())},{share:.6f},{lo:.6f},{hi:.6f},{sel_share:.6f},"
                  f"{null_mean:.6f},{null_share.std():.6f},{p:.6f}\n")
        print(f"{g:5s} removed_mass={share:.4f} CI=[{lo:.4f},{hi:.4f}] sel={sel_share:.4f} "
              f"null={null_mean:.4f}+-{null_share.std():.4f} p={p:.4f}", flush=True)
    out.close()

    # per-layer removed-mass share per group, for the report's dispersion note
    with open(f"{OUT_DIR}/razor_per_layer.csv", "w") as f:
        f.write("group,layer,removed_mass_share\n")
        for g in sorted(gidx):
            rows = gidx[g]
            ml_tot = mass[rows].sum(axis=(0, 2))
            ml_rem = (mass[rows] * removed[None]).sum(axis=(0, 2))
            for l in range(N_LAYER):
                if ml_tot[l] <= 0:
                    raise SystemExit(f"layer {l}: zero total mass for group {g}")
                f.write(f"{g},{l},{ml_rem[l] / ml_tot[l]:.6f}\n")
    print("wrote razor_check.csv razor_per_layer.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
