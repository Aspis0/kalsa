#!/usr/bin/env python3
"""T2-B: within-layer expert weight similarity probe.

Read-only on models/. Writes artifacts under results/t2_simprobe/.
Dequantizes Q4_K / Q5_K / Q6_K (and any other type gguf.dequantize supports)
via the official gguf pip dequantizer — NOT raw-byte comparison.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from gguf import GGUFReader, dequantize
from gguf.constants import GGMLQuantizationType

FAMILIES = ("ffn_gate_exps", "ffn_up_exps", "ffn_down_exps")
COS_HI = 0.95
COS_VHI = 0.99
LAYER_STRIDE = 4  # every 4th MoE layer
RNG_SEED = 20260815


def log(msg: str) -> None:
    print(msg, flush=True)


def field_val(reader: GGUFReader, key: str):
    f = reader.get_field(key)
    if f is None:
        return None
    try:
        return f.contents()
    except Exception:  # noqa: BLE001
        return None


def union_find_clusters(sim: np.ndarray, thresh: float) -> int:
    """Single-linkage / greedy connected components at cosine >= thresh."""
    n = sim.shape[0]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        row = sim[i]
        for j in range(i + 1, n):
            if row[j] >= thresh:
                union(i, j)
    return len({find(i) for i in range(n)})


def pairwise_from_experts(X: np.ndarray) -> dict[str, np.ndarray]:
    """X: (n_exp, d) float32. Cosine + relative Frobenius via float32 GEMM."""
    norms = np.linalg.norm(X, axis=1)  # float32
    safe = np.where(norms > 0, norms, 1.0)
    X /= safe[:, None]  # in-place; caller does not reuse raw X
    cosine = X @ X.T
    np.clip(cosine, -1.0, 1.0, out=cosine)
    # ||Wi-Wj||^2 = ni^2 + nj^2 - 2 <Wi,Wj> = ni^2 + nj^2 - 2 ni nj cos
    # relative Frobenius vs row i: sqrt(1 + (nj/ni)^2 - 2 (nj/ni) cos)
    ratio = norms[None, :] / safe[:, None]
    diff2 = 1.0 + ratio * ratio - 2.0 * ratio * cosine
    np.maximum(diff2, 0.0, out=diff2)
    rel_frob = np.sqrt(diff2)
    rel_frob[norms == 0] = np.nan
    np.fill_diagonal(rel_frob, 0.0)
    np.fill_diagonal(cosine, 1.0)
    return {
        "cosine": cosine.astype(np.float64, copy=False),
        "rel_frob": rel_frob.astype(np.float64, copy=False),
        "norms": norms.astype(np.float64, copy=False),
    }


def offdiag_stats(sim: np.ndarray) -> dict[str, float]:
    n = sim.shape[0]
    mask = ~np.eye(n, dtype=bool)
    vals = sim[mask]
    return {
        "max_offdiag": float(np.max(vals)),
        "min_offdiag": float(np.min(vals)),
        "mean_offdiag": float(np.mean(vals)),
        "median_offdiag": float(np.median(vals)),
        "p99_offdiag": float(np.quantile(vals, 0.99)),
        "n_pairs_ge_0.95": int(np.sum(vals >= COS_HI) // 2),  # undirected
        "n_pairs_ge_0.99": int(np.sum(vals >= COS_VHI) // 2),
    }


def dequant_experts(tensor) -> tuple[np.ndarray, str]:
    """Return (n_exp, d) float32 and a method note."""
    qtype = tensor.tensor_type
    raw = tensor.data
    t0 = time.perf_counter()
    w = dequantize(raw, qtype)
    dt = time.perf_counter() - t0
    if w.dtype != np.float32:
        w = w.astype(np.float32, copy=False)
    if w.ndim < 2:
        raise RuntimeError(f"{tensor.name}: unexpected dequant ndim={w.ndim} shape={w.shape}")
    # Expert axis is the first numpy axis for packed *_exps (confirmed on Mellum2).
    if w.shape[0] < 2:
        # fallback: last axis if that looks like n_expert
        if w.shape[-1] in (8, 16, 32, 64, 128, 160, 256):
            w = np.moveaxis(w, -1, 0)
        else:
            raise RuntimeError(f"{tensor.name}: cannot find expert axis in {w.shape}")
    n_exp = int(w.shape[0])
    X = np.ascontiguousarray(w.reshape(n_exp, -1))
    note = (
        f"gguf.dequantize qtype={GGMLQuantizationType(qtype).name} "
        f"in={tuple(raw.shape)}/{raw.dtype} out={tuple(w.shape)}/{w.dtype} "
        f"n_exp={n_exp} d={X.shape[1]} dequant_s={dt:.3f}"
    )
    return X, note


def discover_moe(reader: GGUFReader) -> dict:
    arch = field_val(reader, "general.architecture")
    meta = {"architecture": arch, "name": field_val(reader, "general.name")}
    prefixes = [str(arch)] if arch else []
    prefixes += ["mellum", "qwen3moe", "qwen3_5_moe", "qwen35moe", "qwen3", "llama"]
    for p in prefixes:
        for key, dest in (
            (f"{p}.block_count", "block_count"),
            (f"{p}.expert_count", "expert_count"),
            (f"{p}.expert_used_count", "expert_used_count"),
            (f"{p}.expert_feed_forward_length", "expert_ff"),
            (f"{p}.embedding_length", "hidden"),
        ):
            if dest not in meta or meta[dest] is None:
                v = field_val(reader, key)
                if v is not None:
                    try:
                        meta[dest] = int(v)
                    except (TypeError, ValueError):
                        meta[dest] = v
    # tensor inventory
    by_layer: dict[int, dict[str, object]] = {}
    name_re = re.compile(r"^blk\.(\d+)\.(ffn_(?:gate|up|down)_exps)\.weight$")
    qtypes = defaultdict(Counter)
    for t in reader.tensors:
        m = name_re.match(t.name)
        if not m:
            continue
        li = int(m.group(1))
        fam = m.group(2)
        by_layer.setdefault(li, {})[fam] = t
        qtypes[fam][str(GGMLQuantizationType(t.tensor_type).name)] += 1
    meta["n_moe_layers"] = len(by_layer)
    meta["layers"] = sorted(by_layer)
    meta["qtypes"] = {k: dict(v) for k, v in qtypes.items()}
    return meta, by_layer


def sample_layers(all_layers: list[int], stride: int) -> list[int]:
    if not all_layers:
        return []
    # every stride-th, always include first and last if not already
    picked = [L for L in all_layers if (L - all_layers[0]) % stride == 0]
    if all_layers[-1] not in picked:
        picked.append(all_layers[-1])
    return picked


def cross_layer_pairs(sampled: list[int]) -> list[tuple[int, int]]:
    if len(sampled) < 2:
        return []
    pairs = [(sampled[0], sampled[len(sampled) // 2])]
    if len(sampled) >= 4:
        pairs.append((sampled[1], sampled[-2]))
    if len(sampled) >= 3:
        pairs.append((sampled[0], sampled[-1]))
    # unique
    out = []
    seen = set()
    for a, b in pairs:
        if a == b:
            continue
        key = (min(a, b), max(a, b))
        if key not in seen:
            seen.add(key)
            out.append((a, b))
    return out


def probe_model(model_path: Path, out_dir: Path, stride: int) -> dict:
    t_all = time.perf_counter()
    log(f"=== open {model_path} ===")
    reader = GGUFReader(str(model_path), mode="r")
    meta, by_layer = discover_moe(reader)
    log(f"meta: {json.dumps({k: v for k, v in meta.items() if k != 'layers'})}")
    sampled = sample_layers(meta["layers"], stride)
    log(f"sampled layers (stride={stride}): {sampled}")
    method_notes: list[str] = []
    rows: list[dict] = []

    slug = model_path.stem.replace(" ", "_")
    model_out = out_dir / slug
    model_out.mkdir(parents=True, exist_ok=True)

    for li in sampled:
        fams = by_layer[li]
        for fam in FAMILIES:
            tensor = fams.get(fam)
            if tensor is None:
                log(f"  L{li} {fam}: MISSING")
                continue
            log(f"  L{li} {fam}: dequant {tensor.name} q={GGMLQuantizationType(tensor.tensor_type).name} ...")
            t0 = time.perf_counter()
            X, note = dequant_experts(tensor)
            method_notes.append(f"L{li}.{fam}: {note}")
            pw = pairwise_from_experts(X)
            stats = offdiag_stats(pw["cosine"])
            n_exp = X.shape[0]
            n_cl = union_find_clusters(pw["cosine"], COS_HI)
            mult = n_exp / n_cl if n_cl else float("nan")
            frob_stats = offdiag_stats(pw["rel_frob"])
            rec = {
                "model": slug,
                "layer": li,
                "family": fam,
                "n_experts": n_exp,
                "d": int(X.shape[1]),
                "qtype": GGMLQuantizationType(tensor.tensor_type).name,
                "max_offdiag_cos": stats["max_offdiag"],
                "mean_offdiag_cos": stats["mean_offdiag"],
                "median_offdiag_cos": stats["median_offdiag"],
                "min_offdiag_cos": stats["min_offdiag"],
                "p99_offdiag_cos": stats["p99_offdiag"],
                "n_pairs_ge_0.95": stats["n_pairs_ge_0.95"],
                "n_pairs_ge_0.99": stats["n_pairs_ge_0.99"],
                "n_clusters_0.95": n_cl,
                "multiplier_0.95": mult,
                "max_offdiag_relfrob": frob_stats["max_offdiag"],
                "mean_offdiag_relfrob": frob_stats["mean_offdiag"],
                "median_offdiag_relfrob": frob_stats["median_offdiag"],
                "elapsed_s": time.perf_counter() - t0,
            }
            rows.append(rec)
            np.save(model_out / f"cos_L{li}_{fam}.npy", pw["cosine"])
            np.save(model_out / f"relfrob_L{li}_{fam}.npy", pw["rel_frob"])
            log(
                f"    max_cos={stats['max_offdiag']:.4f}  "
                f">0.95={stats['n_pairs_ge_0.95']}  >0.99={stats['n_pairs_ge_0.99']}  "
                f"clusters={n_cl}  mult={mult:.3f}  "
                f"mean_cos={stats['mean_offdiag']:.4f}  t={rec['elapsed_s']:.2f}s"
            )
            del X, pw

    # --- cross-layer baseline ---
    rng = np.random.default_rng(RNG_SEED)
    cross_rows: list[dict] = []
    pairs = cross_layer_pairs(sampled)
    log(f"cross-layer pairs: {pairs}")
    for la, lb in pairs:
        for fam in FAMILIES:
            ta = by_layer.get(la, {}).get(fam)
            tb = by_layer.get(lb, {}).get(fam)
            if ta is None or tb is None:
                continue
            Xa, note = dequant_experts(ta)
            method_notes.append(f"cross L{la}.{fam}: {note}")
            Xb, note = dequant_experts(tb)
            method_notes.append(f"cross L{lb}.{fam}: {note}")
            n = min(Xa.shape[0], Xb.shape[0])
            d = min(Xa.shape[1], Xb.shape[1])
            if Xa.shape[1] != Xb.shape[1]:
                log(f"  WARN shape mismatch {fam} L{la} d={Xa.shape[1]} vs L{lb} d={Xb.shape[1]}")
            A = Xa[:n, :d]
            B = Xb[:n, :d]
            na = np.linalg.norm(A, axis=1)
            nb = np.linalg.norm(B, axis=1)
            # aligned: expert k vs expert k
            aligned = []
            for k in range(n):
                den = na[k] * nb[k]
                aligned.append(float(np.dot(A[k], B[k]) / den) if den > 0 else 0.0)
            # mismatched: expert k vs expert (k+shift)
            shift = 1 + int(rng.integers(1, max(n - 1, 2)))
            mismatched = []
            for k in range(n):
                j = (k + shift) % n
                den = na[k] * nb[j]
                mismatched.append(float(np.dot(A[k], B[j]) / den) if den > 0 else 0.0)
            # a few random pairs
            rand_idx = rng.integers(0, n, size=(min(32, n * n), 2))
            random_cs = []
            for i, j in rand_idx:
                den = na[int(i)] * nb[int(j)]
                random_cs.append(float(np.dot(A[int(i)], B[int(j)]) / den) if den > 0 else 0.0)
            rec = {
                "model": slug,
                "layer_a": la,
                "layer_b": lb,
                "family": fam,
                "n_compared": n,
                "aligned_mean": float(np.mean(aligned)),
                "aligned_max": float(np.max(aligned)),
                "aligned_min": float(np.min(aligned)),
                "mismatched_mean": float(np.mean(mismatched)),
                "mismatched_max": float(np.max(mismatched)),
                "random_mean": float(np.mean(random_cs)),
                "random_max": float(np.max(random_cs)),
                "shift": shift,
            }
            cross_rows.append(rec)
            log(
                f"  cross L{la}vsL{lb} {fam}: aligned_mean={rec['aligned_mean']:.4f} "
                f"aligned_max={rec['aligned_max']:.4f} "
                f"mis_mean={rec['mismatched_mean']:.4f} rand_mean={rec['random_mean']:.4f}"
            )
            del Xa, Xb, A, B

    # write csv
    metrics_csv = model_out / "metrics.csv"
    if rows:
        with metrics_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    cross_csv = model_out / "cross_layer.csv"
    if cross_rows:
        with cross_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(cross_rows[0].keys()))
            w.writeheader()
            w.writerows(cross_rows)

    # verdict
    by_layer_mult: dict[int, list[float]] = defaultdict(list)
    by_layer_max: dict[int, list[float]] = defaultdict(list)
    for rec in rows:
        by_layer_mult[rec["layer"]].append(rec["multiplier_0.95"])
        by_layer_max[rec["layer"]].append(rec["max_offdiag_cos"])
    layer_mult = {L: float(np.mean(vs)) for L, vs in by_layer_mult.items()}
    layer_max = {L: float(np.max(vs)) for L, vs in by_layer_max.items()}
    n_layers = len(layer_mult)
    n_struct = sum(1 for m in layer_mult.values() if m >= 1.5)
    n_any_pair = sum(1 for rec in rows if rec["n_pairs_ge_0.95"] > 0)
    within_max = max((r["max_offdiag_cos"] for r in rows), default=float("nan"))
    within_mean = float(np.mean([r["mean_offdiag_cos"] for r in rows])) if rows else float("nan")
    cross_means = [r["random_mean"] for r in cross_rows] + [r["mismatched_mean"] for r in cross_rows]
    cross_maxes = [r["random_max"] for r in cross_rows] + [r["mismatched_max"] for r in cross_rows]
    cross_mean = float(np.mean(cross_means)) if cross_means else float("nan")
    cross_max = float(np.max(cross_maxes)) if cross_maxes else float("nan")
    # "within ~= cross" if max offdiag is close to cross max (no high-similarity pairs)
    # and mean offdiag is within ~0.05 of cross mean.
    deadish = (
        (not np.isnan(within_max) and not np.isnan(cross_max) and within_max < 0.5
         and abs(within_mean - cross_mean) < 0.05)
        or (n_any_pair == 0 and within_max < 0.5)
    )
    if n_layers > 0 and n_struct >= (n_layers / 2.0) and max(layer_mult.values()) >= 1.5:
        overall_mult = float(np.median(list(layer_mult.values())))
        verdict = f"SIMPROBE_STRUCTURE(mult={overall_mult:.2f})"
    elif n_any_pair > 0 and not deadish:
        verdict = (
            f"SIMPROBE_WEAK(max_offdiag={within_max:.4f}, "
            f"pairs_ge_0.95={sum(r['n_pairs_ge_0.95'] for r in rows)}, "
            f"layers_with_pairs={n_any_pair})"
        )
    else:
        verdict = f"SIMPROBE_DEAD(max_offdiag={within_max:.6f})"

    summary = {
        "verdict": verdict,
        "model": str(model_path),
        "slug": slug,
        "meta": meta,
        "sampled_layers": sampled,
        "method": "gguf.dequantize to f32 (Q4_K/Q5_K/Q6_K supported); full flattened matrices; no row/col sampling",
        "cosine_thresholds": {"hi": COS_HI, "vhi": COS_VHI},
        "cluster_algo": "greedy union-find / single-linkage connected components at cos>=0.95",
        "within_max_offdiag": within_max,
        "within_mean_offdiag": within_mean,
        "cross_mean": cross_mean,
        "cross_max": cross_max,
        "n_layers_sampled": n_layers,
        "n_layers_mult_ge_1_5": n_struct,
        "layer_multiplier_mean": layer_mult,
        "layer_max_offdiag": layer_max,
        "rows": rows,
        "cross": cross_rows,
        "method_notes": method_notes,
        "elapsed_s": time.perf_counter() - t_all,
    }
    (model_out / "summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    log(f"VERDICT {slug}: {verdict}  elapsed={summary['elapsed_s']:.1f}s")
    return summary


def write_report(path: Path, summaries: list[dict], script_path: Path) -> None:
    lines: list[str] = []
    primary = summaries[0] if summaries else None
    if primary is None:
        lines.append("SIMPROBE_DEAD(max_offdiag=nan)")
        lines.append("")
        lines.append("No models probed.")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return

    lines.append(primary["verdict"])
    lines.append("")
    lines.append("# T2-B expert similarity probe")
    lines.append("")
    lines.append(f"- Script: `{script_path}`")
    lines.append(f"- Artifacts: `{script_path.parent}`")
    lines.append("- Dequant: **`gguf.dequantize` → f32** (Q4_K / Q5_K / Q6_K). Not raw-byte comparison.")
    lines.append("- Similarity: cosine on **full flattened** expert matrices (no row/col sampling).")
    lines.append("- Also computed relative Frobenius `||Wi-Wj||_F / ||Wi||_F` (saved as npy).")
    lines.append("- Clusters: greedy union-find (single-linkage connected components) at cos ≥ 0.95.")
    lines.append("- Multiplier: `n_experts / n_clusters`.")
    lines.append("")

    for s in summaries:
        slug = s["slug"]
        lines.append(f"## {slug}")
        lines.append("")
        lines.append(f"**Verdict:** `{s['verdict']}`")
        lines.append("")
        m = s.get("meta") or {}
        lines.append(
            f"- arch=`{m.get('architecture')}`  layers={m.get('n_moe_layers')}  "
            f"experts={m.get('expert_count')}  used={m.get('expert_used_count')}  "
            f"hidden={m.get('hidden')}  expert_ff={m.get('expert_ff')}"
        )
        lines.append(f"- sampled layers: {s['sampled_layers']}")
        lines.append(f"- qtypes: `{json.dumps(m.get('qtypes'))}`")
        lines.append(
            f"- within-layer: max off-diag cos={s['within_max_offdiag']:.6f}, "
            f"mean off-diag cos={s['within_mean_offdiag']:.6f}"
        )
        lines.append(
            f"- cross-layer baseline: mean={s['cross_mean']:.6f}, max={s['cross_max']:.6f}"
        )
        lines.append(f"- wall time: {s['elapsed_s']:.1f}s")
        lines.append("")
        lines.append("| layer | family | qtype | max cos | mean cos | #>0.95 | #>0.99 | clusters@0.95 | mult |")
        lines.append("|------:|--------|-------|--------:|---------:|-------:|-------:|--------------:|-----:|")
        for r in s["rows"]:
            lines.append(
                f"| {r['layer']} | {r['family']} | {r['qtype']} | "
                f"{r['max_offdiag_cos']:.4f} | {r['mean_offdiag_cos']:.4f} | "
                f"{r['n_pairs_ge_0.95']} | {r['n_pairs_ge_0.99']} | "
                f"{r['n_clusters_0.95']} | {r['multiplier_0.95']:.3f} |"
            )
        lines.append("")
        if s["cross"]:
            lines.append("### Cross-layer baseline")
            lines.append("")
            lines.append("| La | Lb | family | aligned mean/max | mismatched mean/max | random mean/max |")
            lines.append("|---:|---:|--------|-----------------:|--------------------:|----------------:|")
            for c in s["cross"]:
                lines.append(
                    f"| {c['layer_a']} | {c['layer_b']} | {c['family']} | "
                    f"{c['aligned_mean']:.4f} / {c['aligned_max']:.4f} | "
                    f"{c['mismatched_mean']:.4f} / {c['mismatched_max']:.4f} | "
                    f"{c['random_mean']:.4f} / {c['random_max']:.4f} |"
                )
            lines.append("")
        lines.append("### Interpretation")
        lines.append("")
        if s["verdict"].startswith("SIMPROBE_DEAD"):
            lines.append(
                "Within-layer expert-expert cosine is indistinguishable from the "
                "cross-layer baseline (near-orthogonal high-D random weights). "
                "**No exploitable near-duplicate structure.** A representative-cache "
                "would not multiply capacity. The trick is **DEAD**."
            )
        elif s["verdict"].startswith("SIMPROBE_WEAK"):
            lines.append(
                "Only isolated near-duplicate pairs; not enough to get a ≥1.5× "
                "capacity multiplier on most layers."
            )
        else:
            lines.append(
                "Most sampled layers cluster at cos≥0.95 with multiplier ≥1.5×. "
                "A representative cache is *in principle* viable on weight space "
                "(still needs an activation/routing check before shipping)."
            )
        lines.append("")

    lines.append("## Method caveats")
    lines.append("")
    lines.append("- Dequant used the official `gguf` Python dequantizer (true Q4_K/Q5_K/Q6_K → f32), not raw quantized bytes.")
    lines.append("- Full matrices (no sampling). Cosine in ~2e6-D; a few duplicate rows would still show up as cos≈1.")
    lines.append("- Q4_K_M mixes Q4_K / Q5_K / Q6_K across tensors; each tensor is dequantized with its own type.")
    lines.append("- Clustering is single-linkage (greedy). Complete-linkage would only *increase* cluster count (lower multiplier).")
    lines.append("- Weight-space cosine ≠ activation-space interchangeability. This probe only falsifies *weight redundancy*.")
    lines.append("- Cross-layer compares same family, possibly different quant types after dequant to f32.")
    lines.append("- models/ was opened read-only (`GGUFReader(..., mode='r')` memmap).")
    lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--stride", type=int, default=LAYER_STRIDE)
    ap.add_argument("models", nargs="+", type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    summaries = []
    for mp in args.models:
        if not mp.is_file():
            log(f"SKIP missing {mp}")
            continue
        try:
            summaries.append(probe_model(mp, args.out, args.stride))
        except Exception as exc:  # noqa: BLE001
            log(f"FAIL {mp}: {type(exc).__name__}: {exc}")
            raise

    write_report(args.report, summaries, Path(__file__).resolve())
    # also copy a local report next to artifacts
    local = args.out / "report.md"
    local.write_text(args.report.read_text(encoding="utf-8"), encoding="utf-8")
    if summaries:
        log(summaries[0]["verdict"])
    log("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
