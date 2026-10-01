#!/usr/bin/env python3
"""Task D: merge every strategy into one comparable table.

All rows are recomputed on the same five content-disjoint splits, so values are directly
comparable; each cell is the mean over the 5 splits. Model-size columns are ESTIMATES from
model_sizes.csv (fixed average bpw read from the GGUF tensor shapes)."""

import csv
import sys

import k128_common as k

GROUPS = ["it", "fr", "es", "en", "zh", "code", "math", "de", "ja", "ko", "ru", "ar"]
COLS = ["strategy", "total_experts", "avg_per_layer", "IT", "FR", "ES", "EN", "ZH",
        "CODE", "MATH", "lang_mean", "sacrifice_mean", "approx_params_B",
        "gb_q4_k_m", "gb_q3_k_m", "gb_iq3_s"]
# strategy -> (total_experts, avg_per_layer); None rows are filled below
BUDGETS = {
    "balanced_u128": (5120, 128), "balanced_u160": (6400, 160),
    "balanced_u192": (7680, 192), "balanced_u224": (8960, 224),
    "en_only_u128": (5120, 128), "razor_u128": (5120, 128), "random_u128": (5120, 128),
    "weighted_w0.25_u128": (5120, 128), "weighted_w0.5_u128": (5120, 128),
    "weighted_w2_u128": (5120, 128), "weighted_w4_u128": (5120, 128),
    "weighted_w8_u128": (5120, 128),
    "alloc_b_waterline": (5120, 128), "alloc_c_w2_waterline": (5120, 128),
    "alloc_c_w4_waterline": (5120, 128),
}
# B's three allocation methods (global floor 64, floor 96, greedy) produced identical
# keep-sets on every split; one representative row stands for all. Same for C.
REPRESENT = {"alloc_b_waterline": "global_w1_f64",
             "alloc_c_w2_waterline": "global_w2_f64",
             "alloc_c_w4_waterline": "global_w4_f64"}


def read_means(path, rename=None):
    agg = {}
    with open(f"{k.OUT_DIR}/{path}") as f:
        for r in csv.DictReader(f):
            name = r["strategy"] if rename is None else rename.get(r["strategy"])
            if name is None:
                continue
            agg.setdefault((name, r["group"]), []).append(float(r["retained_share"]))
    return {k_: 100 * sum(v) / len(v) for k_, v in agg.items()}


def main():
    means = read_means("uniform_rows.csv")
    means.update(read_means("weighted_sweep.csv",
                            {f"weighted_w{w}_u128": f"weighted_w{w}_u128"
                             for w in ("0.25", "0.5", "2", "4", "8")}))
    means.update(read_means("alloc_retained.csv",
                            {src: merged for merged, src in REPRESENT.items()}))
    sizes = {}
    with open(f"{k.OUT_DIR}/model_sizes.csv") as f:
        for r in csv.DictReader(f):
            sizes[int(r["experts_kept"])] = r

    rows = []
    for name, (total, avg) in BUDGETS.items():
        vals = {g: means[(name, g)] for g in GROUPS}
        lang = sum(vals[g] for g in GROUPS[:5]) / 5
        sac = sum(vals[g] for g in GROUPS[7:]) / 5
        sz = sizes[total]
        rows.append([name, total, avg] + [f"{vals[g]:.1f}" for g in GROUPS[:7]]
                    + [f"{lang:.1f}", f"{sac:.1f}", sz["approx_params_B"],
                       sz["gb_q4_k_m"], sz["gb_q3_k_m"], sz["gb_iq3_s"]])
    with open(f"{k.OUT_DIR}/merged_curve.csv", "w") as f:
        f.write(",".join(COLS) + "\n")
        for row in rows:
            f.write(",".join(str(c) for c in row) + "\n")

    missing = [(n, g) for n in BUDGETS for g in GROUPS if (n, g) not in means]
    if missing:
        raise SystemExit(f"missing cells in merged table: {missing[:5]}")
    head = ["strategy", "tot", "/lay", "IT", "FR", "ES", "EN", "ZH", "CODE", "MATH",
            "lang", "sacr"]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for row in rows:
        print("| " + " | ".join(str(c) for c in row[:13]) + " |")
    print("wrote merged_curve.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
