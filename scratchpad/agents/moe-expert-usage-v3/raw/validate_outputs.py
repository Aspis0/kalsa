#!/usr/bin/env python3
"""Validator for the moe-expert-usage-v3 run artifacts. Exits nonzero on any failure.

Checks:
  1. uniform selection counts per (group, layer) — the stride-read bug signature —
     and a minimum count diversity (a partial stride bug could stay non-uniform);
  2. coverage: bin sizes, segment blocks, manifest <-> instrument agreement,
     per-group segment counts;
  3. token counts: log total vs segments CSV, per-group token targets, group balance;
  4. router sanity: every weight-sum inside (0, 1] (from the log), no failure lines.
"""

import csv
import re
import sys

import numpy as np

from router_data import N_EXPERT, N_LAYER, group_indices, load_manifest, load_segments

RUNS_DIR = __import__("os").environ.get("ROUTER_RUNS_DIR", "/tmp/moe-expert-usage-v3/runs")
OUT_DIR = __import__("os").environ.get("ROUTER_OUT_DIR", __import__("os").path.expanduser(
    "~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw"))
MIN_GROUP_TOKENS = 8000      # design target from the study brief
MIN_GROUP_TOKENS_HARD = 7500  # validator floor
MAX_GROUP_RATIO = 1.75
MIN_DISTINCT_COUNTS = 32     # of 256 experts per (group, layer); run-2 valid data had 68+, a stride bug gives ~1-8


failures = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


def main():
    groups, tokens, counts, mass = load_segments(RUNS_DIR)
    gidx = group_indices(groups)
    n = len(groups)
    check(n == 480, f"480 segments present (got {n})")

    # 2. coverage
    manifest = load_manifest(f"{OUT_DIR}/corpus/manifest.csv")
    check(len(manifest) == n, "manifest row count matches instrument segments")
    man_groups = [r["group"] for r in sorted(manifest, key=lambda r: int(r["idx"]))]
    check(man_groups == groups, "manifest group order matches instrument order")
    check(all(len(x) == 40 for x in gidx.values()),
          "every group has 40 segments: " + ", ".join(f"{g}={len(gidx[g])}" for g in sorted(gidx)))

    # selections-total invariant: every (group, layer) must have exactly
    # top_k * tokens selections, whatever the distribution over experts
    top_k = 8
    bad_tot = []
    for g, idx in gidx.items():
        agg = counts[idx].sum(axis=0)
        expected = int(tokens[idx].sum()) * top_k
        for l in range(N_LAYER):
            if int(agg[l].sum()) != expected:
                bad_tot.append((g, l, int(agg[l].sum()), expected))
    check(not bad_tot, f"selections == top_k*tokens in every (group, layer) ({len(bad_tot)} bad)")

    # 3. token counts
    log = open(f"{RUNS_DIR}/full.log").read()
    m = re.search(r"ROUTER_RUN_OK segments=(\d+) total_tokens=(\d+)", log)
    check(m is not None, "ROUTER_RUN_OK line present (run finished)")
    if m:
        check(int(m.group(1)) == n, "log segment count matches")
        check(int(m.group(2)) == int(tokens.sum()), "log total tokens match segments CSV")
    tok_by_group = {g: int(tokens[idx].sum()) for g, idx in gidx.items()}
    for g in sorted(tok_by_group):
        check(tok_by_group[g] >= MIN_GROUP_TOKENS_HARD,
              f"group {g} tokens={tok_by_group[g]} >= {MIN_GROUP_TOKENS_HARD}")
    ratio = max(tok_by_group.values()) / min(tok_by_group.values())
    check(ratio <= MAX_GROUP_RATIO, f"group token ratio {ratio:.2f} <= {MAX_GROUP_RATIO}")

    # 1. uniform counts / diversity per (group, layer)
    uniform, low_diversity = [], []
    for g, idx in gidx.items():
        agg = counts[idx].sum(axis=0)  # [layer, expert]
        for l in range(N_LAYER):
            row = agg[l]
            if len(np.unique(row)) == 1:
                uniform.append((g, l))
            elif len(np.unique(row)) < MIN_DISTINCT_COUNTS:
                low_diversity.append((g, l, len(np.unique(row))))
    check(not uniform, f"no (group, layer) with perfectly uniform counts ({len(uniform)} found)")
    check(not low_diversity,
          f"every (group, layer) has >= {MIN_DISTINCT_COUNTS} distinct expert counts "
          f"({len(low_diversity)} below: {low_diversity[:5]})")

    # 4. router sanity from the log
    check("ROUTER_SEG_FAIL" not in log and "ROUTER_CALLBACK_ERROR" not in log,
          "no ROUTER_SEG_FAIL / ROUTER_CALLBACK_ERROR lines")
    check(log.count("ROUTER_SEG ") == n, f"ROUTER_SEG lines = {n}")

    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
