#!/usr/bin/env python3
"""Aggregate the per-split analysis CSVs into the headline tables for REPORT.md."""

import csv
import os
import sys
from collections import defaultdict

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
KEEP = ["it", "fr", "es", "en", "zh", "code", "math"]
SACRIFICE = ["de", "ja", "ko", "ru", "ar"]
GROUPS = KEEP + SACRIFICE
SIZES = [128, 160, 192, 224]


def rows(path):
    with open(f"{OUT_DIR}/{path}") as f:
        return list(csv.DictReader(f))


def main():
    lines = []

    def emit(s=""):
        lines.append(s)
        print(s)

    # 1. retained-mass curve, balanced keep-set (mean over splits, mean CI half-width)
    per = defaultdict(list)
    for r in rows("curve_retained_mass.csv"):
        per[(int(r["size"]), r["comparator"], r["group"])].append(
            (float(r["retained_share"]), float(r["boot_lo"]), float(r["boot_hi"])))
    emit("== Retained selected top-k mass on TEST segments (mean of 5 splits, [bootstrap 95% CI mean]) ==")
    emit("size | comparator | " + " | ".join(KEEP))
    for size in SIZES:
        for comp in ("balanced", "en_only", "razor"):
            cells = []
            for g in KEEP:
                v = per.get((size, comp, g)) or per.get((size, "razor" if comp == "razor" else comp, g))
                if comp == "razor":
                    v = per[(128, "razor", g)]
                share = sum(x[0] for x in v) / len(v)
                lo = sum(x[1] for x in v) / len(v)
                hi = sum(x[2] for x in v) / len(v)
                cells.append(f"{share*100:5.1f} [{lo*100:4.1f},{hi*100:4.1f}]")
            emit(f"{size:4d} | {comp:9s} | " + " | ".join(cells))
    emit()
    emit("== Random-null retained mass (mean over draws, sd; averaged over 5 splits) ==")
    nulls = defaultdict(lambda: [[], []])
    for r in rows("random_null.csv"):
        nulls[(int(r["size"]), r["group"])][0].append(float(r["null_mean"]))
        nulls[(int(r["size"]), r["group"])][1].append(float(r["null_sd"]))
    emit("size | " + " | ".join(GROUPS))
    for size in SIZES:
        cells = [f"{sum(nulls[(size,g)][0])/5*100:5.1f}+-{sum(nulls[(size,g)][1])/5*100:.2f}" for g in GROUPS]
        emit(f"{size:4d} | " + " | ".join(cells))
    emit()

    # 2. RAZOR check table (already aggregated in razor_check.csv, single run over all segments)
    emit("== RAZOR removed-mass share per group (all segments; bootstrap 95% CI; random-half null; two-sided p) ==")
    for r in rows("razor_check.csv"):
        emit(f"{r['group']:5s} removed={float(r['removed_mass_share'])*100:5.2f}% "
             f"CI=[{float(r['boot_lo'])*100:.2f},{float(r['boot_hi'])*100:.2f}] "
             f"sel={float(r['removed_selection_share'])*100:5.2f}% "
             f"null={float(r['null_mean'])*100:.2f}+-{float(r['null_sd'])*100:.2f} p={float(r['p_two_sided']):.4f}")
    emit()

    # 3. sacrifice-dominated experts per layer
    per_layer = defaultdict(list)
    for r in rows("sacrifice_dominated.csv"):
        per_layer[int(r["layer"])].append(int(r["n_dominated"]))
    means = [sum(v) / len(v) for _, v in sorted(per_layer.items())]
    means_sorted = sorted(means)
    med = (means_sorted[19] + means_sorted[20]) / 2
    emit("== Experts per layer dominated (>=80% of their test mass) by SACRIFICE groups ==")
    emit(f"layers=40, mean count per layer over 5 splits: median={med:.1f} min={min(means):.1f} "
         f"max={max(means):.1f} (of 256)")
    emit()

    # 4. top-k (top-128 by test mass) Jaccard overlap among headline groups
    pair = defaultdict(list)
    for r in rows("topk_overlap.csv"):
        pair[(r["group_a"], r["group_b"])].append(float(r["jaccard"]))
    emit("== Top-128 set Jaccard overlap on TEST segments (mean over layers and splits) ==")
    for (a, b), v in sorted(pair.items()):
        emit(f"{a}~{b}: {sum(v)/len(v):.3f}")

    with open(f"{OUT_DIR}/summary.txt", "w") as f:
        f.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
