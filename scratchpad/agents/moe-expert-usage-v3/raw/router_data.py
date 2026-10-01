"""Shared loader for the per-segment router data produced by llama-eval-callback v3."""

import csv
import json

import numpy as np

N_LAYER = 40
N_EXPERT = 256

KEEP_GROUPS = ["it", "fr", "es", "en", "zh", "code", "math"]
SACRIFICE_GROUPS = ["de", "ja", "ko", "ru", "ar"]
OVERLAP_GROUPS = ["it", "en", "zh", "code", "math"]
KEEP_SIZES = [128, 160, 192, 224]


def load_segments(runs_dir):
    """Returns (groups, tokens, counts, mass): mass is float64 [seg, layer, expert]."""
    with open(f"{runs_dir}/full_segs.csv") as f:
        segs = list(csv.DictReader(f))
    s = len(segs)
    counts = np.fromfile(f"{runs_dir}/full_counts.bin", dtype=np.uint32)
    mass = np.fromfile(f"{runs_dir}/full_mass.bin", dtype=np.float32)
    if counts.size != s * N_LAYER * N_EXPERT or mass.size != s * N_LAYER * N_EXPERT:
        raise SystemExit(f"bin size mismatch: counts={counts.size} mass={mass.size} segments={s}")
    groups = [r["group"] for r in segs]
    tokens = np.array([int(r["tokens"]) for r in segs], dtype=np.int64)
    c = counts.reshape(s, N_LAYER, N_EXPERT)
    m = mass.reshape(s, N_LAYER, N_EXPERT).astype(np.float64)
    return groups, tokens, c, m


def group_indices(groups):
    """Group name -> array of segment indices, in run order."""
    out = {}
    for i, g in enumerate(groups):
        out.setdefault(g, []).append(i)
    return {g: np.array(v) for g, v in out.items()}


def load_manifest(manifest_path):
    with open(manifest_path) as f:
        return list(csv.DictReader(f))


def razor_keep_masks(json_path):
    """RAZOR survivor manifest -> boolean [layer, expert] keep mask."""
    with open(json_path) as f:
        manifest = json.load(f)
    keep = np.zeros((N_LAYER, N_EXPERT), dtype=bool)
    for layer in range(N_LAYER):
        ids = manifest[f"main_{layer}"]
        if len(ids) != N_EXPERT // 2:
            raise SystemExit(f"main_{layer}: {len(ids)} ids, expected {N_EXPERT // 2}")
        keep[layer, ids] = True
    return keep


def split_half(indices, rng):
    """Random calibration/test split of one group's segment indices."""
    perm = rng.permutation(indices)
    half = len(perm) // 2
    return perm[:half], perm[half:]


def retained_share(mass, seg_rows, keep_mask):
    """Share of selected top-k mass on kept experts: sum over rows/layer of kept / total.

    mass: [seg, layer, expert]; seg_rows: segment index array; keep_mask: [layer, expert]."""
    sel = mass[seg_rows]
    kept = sel[:, keep_mask].sum()
    total = sel.sum()
    return kept / total


def per_segment_totals(mass, keep_mask):
    """Per segment kept and total selected mass summed over layers: (kept, total) vectors."""
    kept = mass[:, keep_mask].sum(axis=1)
    total = mass.sum(axis=(1, 2))
    return kept, total


def bootstrap_ci(kept, total, n_boot, rng):
    """95% percentile CI of kept/total over segment resampling (kept/total are per segment)."""
    n = len(kept)
    draws = rng.integers(0, n, size=(n_boot, n))
    shares = kept[draws].sum(axis=1) / total[draws].sum(axis=1)
    return np.percentile(shares, [2.5, 97.5])
