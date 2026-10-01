"""Shared setup for the 128-average keep-set study: v3 loaders + content-disjoint splits.

Audit F1 fix: a FLORES content block (consecutive source lines) is in calibration for ALL
ten languages or in test for ALL; CODE and MATH split by item. Every script here imports
the v3 loaders instead of copying them."""

import csv
import os
import random
import re
import sys

import numpy as np

V3_RAW = os.path.expanduser(
    "~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw")
sys.path.insert(0, V3_RAW)
import router_data as v3  # noqa: E402  (audited v3 loader, used via import)

RUNS_DIR = os.environ.get("ROUTER_RUNS_DIR", "/tmp/moe-expert-usage-v3/runs")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
GROUPS = v3.KEEP_GROUPS + v3.SACRIFICE_GROUPS  # 12: it fr es en zh code math + de ja ko ru ar
LANG_GROUPS = ["it", "fr", "es", "en", "zh"]
N_SPLITS = 5
SEED = 20261001
LINE_RE = re.compile(r"(\w+)\.dev\+devtest lines (\d+)-(\d+)")


def load_all():
    """(seg_ids, groups, tokens, counts, mass) in run order + manifest join sanity."""
    groups, tokens, counts, mass = v3.load_segments(RUNS_DIR)
    with open(f"{RUNS_DIR}/full_segs.csv") as f:
        rows = list(csv.DictReader(f))
    seg_ids = [int(r["seg_id"]) for r in rows]
    if seg_ids != sorted(seg_ids) or len(seg_ids) != len(groups):
        raise SystemExit("full_segs.csv run order is not seg_id order; join would be wrong")
    manifest = {int(r["seg_id"]): r for r in v3.load_manifest(f"{V3_RAW}/corpus/manifest.csv")}
    if set(manifest) != set(seg_ids):
        raise SystemExit("manifest seg_id set mismatch")
    return seg_ids, groups, tokens, counts, mass, manifest


def content_ids(seg_ids, manifest):
    """Disjointness unit per segment: FLORES block start line, or (group, seg_id) item."""
    out = []
    for sid in seg_ids:
        m = LINE_RE.match(manifest[sid]["source"])
        out.append(int(m.group(2)) if m else (manifest[sid]["group"], sid))
    return out


def make_splits(seg_ids, groups, manifest):
    """List of (calib, test) dicts group -> segment indices; FLORES blocks shared across
    languages, code/math split by item. 20/20 per group."""
    cids = content_ids(seg_ids, manifest)
    flores_blocks = sorted({c for c, g in zip(cids, groups) if not isinstance(c, tuple)})
    if len(flores_blocks) != 40:
        raise SystemExit(f"expected 40 FLORES blocks, got {len(flores_blocks)}")
    idx_by_group = v3.group_indices(groups)
    master = random.Random(SEED)
    splits = []
    for _ in range(N_SPLITS):
        rng = np.random.default_rng(master.randrange(1 << 62))
        cal_blocks = set(rng.permutation(flores_blocks)[:len(flores_blocks) // 2].tolist())
        calib, test = {}, {}
        for g, idx in idx_by_group.items():
            item = [i for i in idx if isinstance(cids[i], tuple)]
            perm = rng.permutation(item)
            item_cal = set(perm[:len(perm) // 2].tolist())
            cal_m, test_m = [], []
            for i in idx:
                cid = cids[i]
                is_cal = (cid in cal_blocks) if not isinstance(cid, tuple) \
                    else i in item_cal
                (cal_m if is_cal else test_m).append(i)
            if len(cal_m) != 20 or len(test_m) != 20:
                raise SystemExit(f"group {g}: split {len(cal_m)}/{len(test_m)}, expected 20/20")
            calib[g], test[g] = np.array(cal_m), np.array(test_m)
        splits.append((calib, test))
    return splits


def weighted_score(mass_cal, tokens_cal, weights):
    """sum_g w_g * (calibration selected mass of g per token); ranking is scale-free."""
    score = np.zeros((v3.N_LAYER, v3.N_EXPERT))
    for g, w in weights.items():
        score += w * (mass_cal[g].sum(axis=0) / tokens_cal[g])
    return score


def topk_mask(score, size):
    """Per-layer boolean keep mask of the top `size` experts by score (ties by lower id)."""
    order = np.argsort(-score, axis=1, kind="stable")
    mask = np.zeros((v3.N_LAYER, v3.N_EXPERT), dtype=bool)
    rows = np.arange(v3.N_LAYER)[:, None]
    mask[rows, order[:, :size]] = True
    return mask


def eval_groups(mass, tokens, test, mask, out_row):
    """Retained share per group on the split's test segments -> list of CSV strings."""
    rows = []
    for g in GROUPS:
        mt = mass[test[g]]
        kept, total = mt[:, mask].sum(axis=1), mt.sum(axis=(1, 2))
        rows.append(out_row + (g, int(tokens[test[g]].sum()),
                               float(kept.sum() / total.sum())))
    return rows


RETAINED_HEADER = "split,strategy,group,tokens_test,retained_share\n"


def write_retained(path, rows):
    with open(path, "w") as f:
        f.write(RETAINED_HEADER)
        for split, strategy, group, toks, share in rows:
            f.write(f"{split},{strategy},{group},{toks},{share:.6f}\n")
