#!/usr/bin/env python3
"""T2-M enabler probe: per-domain MoE expert-usage skew.

Runs 5 campaign-style decode traces (--route-trace) then computes Gini,
top-16 coverage, cross-domain Jaccard, and never-used counts.

Does not touch the engine or models/ (model is opened read-only by bmoe-cli).
"""

from __future__ import annotations

import csv
import json
import math
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-kf\build\cli\bmoe-cli.exe")
BIN_DIR = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-kf\build\bin")
MODEL = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Marco-Mini-Instruct-KEXP.gguf")

N_PREDICT = 300
DOMAINS = [
    (
        "coding",
        "Write a complete, well-documented Python function that implements an LRU cache "
        "with per-entry TTL. Include the class, helper methods, a short pytest module, "
        "and two usage examples. Do not stop until the implementation is complete.",
    ),
    (
        "cooking",
        "Write a detailed recipe for a three-course Italian dinner for eight people: "
        "antipasto, primo, and dessert. List every ingredient with quantities, the full "
        "step-by-step method, timing, make-ahead notes, and a wine pairing.",
    ),
    (
        "legal",
        "Draft a formal software license and SaaS subscription agreement between a "
        "vendor and an enterprise customer. Cover grant of license, fees, service levels, "
        "data protection, liability caps, indemnities, termination, and governing law. "
        "Use formal legal English.",
    ),
    (
        "casual",
        "Hey! How is your weekend going? Tell me about a funny thing that happened to "
        "you recently, like we are just chatting over coffee. Keep it warm, rambling, "
        "and conversational — stories, asides, questions back to me.",
    ),
    (
        "math",
        "A train leaves station A at 9:00 AM traveling east at 60 mph. Another leaves "
        "station B, 180 miles east of A, at 9:30 AM traveling west at 75 mph. A bird "
        "flies back and forth between them at 90 mph starting at 9:00 AM. When and "
        "where do the trains meet, and how far does the bird fly? Solve step by step, "
        "show all algebra, then generalize to speeds u, v, bird speed w, distance D, "
        "and a delayed start.",
    ),
]


def gini(counts: list[int]) -> float:
    """Gini of a non-negative vector. 0 = uniform, 1 = all mass on one bin.

    Includes zeros (full expert population). Empty / all-zero -> 0.
    """
    n = len(counts)
    if n == 0:
        return 0.0
    total = sum(counts)
    if total == 0:
        return 0.0
    xs = sorted(counts)
    # G = (2 * sum_i i*x_i) / (n * sum x) - (n+1)/n
    weighted = sum((i + 1) * x for i, x in enumerate(xs))
    return (2.0 * weighted) / (n * total) - (n + 1) / n


def parse_trace(path: Path) -> dict:
    meta = {"n_layer": None, "n_expert": None, "n_expert_used": None, "arch": None, "model": None}
    # counts[layer][expert] = activation count (decode only)
    counts: dict[int, Counter] = defaultdict(Counter)
    decode_steps = set()
    prefill_steps = set()
    n_rows_decode = 0
    n_rows_prefill = 0
    n_dropped_decode = 0
    with path.open("r", encoding="utf-8", newline="") as f:
        for line in f:
            if line.startswith("#"):
                if line.startswith("# model="):
                    # # model=... arch=... n_layer=N n_expert=N n_expert_used=N
                    parts = line[2:].strip().split()
                    kv = {}
                    for p in parts:
                        if "=" in p:
                            k, v = p.split("=", 1)
                            kv[k] = v
                    meta["model"] = kv.get("model")
                    meta["arch"] = kv.get("arch")
                    if "n_layer" in kv:
                        meta["n_layer"] = int(kv["n_layer"])
                    if "n_expert" in kv:
                        meta["n_expert"] = int(kv["n_expert"])
                    if "n_expert_used" in kv:
                        meta["n_expert_used"] = int(kv["n_expert_used"])
                continue
            if line.startswith("turn,"):
                continue
            row = line.strip()
            if not row:
                continue
            cols = row.split(",")
            # turn,phase,step,layer,slot,expert,weight,residency,expert_bytes,dropped
            if len(cols) < 10:
                continue
            phase = int(cols[1])
            step = int(cols[2])
            layer = int(cols[3])
            expert = int(cols[5])
            dropped = int(cols[9])
            if phase == 0:
                prefill_steps.add(step)
                n_rows_prefill += 1
                continue
            decode_steps.add(step)
            n_rows_decode += 1
            if dropped:
                n_dropped_decode += 1
            counts[layer][expert] += 1
    return {
        "meta": meta,
        "counts": {int(k): dict(v) for k, v in counts.items()},
        "decode_steps": len(decode_steps),
        "prefill_steps": len(prefill_steps),
        "n_rows_decode": n_rows_decode,
        "n_rows_prefill": n_rows_prefill,
        "n_dropped_decode": n_dropped_decode,
    }


def env_with_bin() -> dict:
    env = os.environ.copy()
    prev = env.get("PATH", "")
    env["PATH"] = str(BIN_DIR) + os.pathsep + prev
    return env


def run_domain(name: str, prompt: str) -> Path:
    out_csv = ROOT / f"{name}.route.csv"
    out_log = ROOT / f"{name}.log"
    out_txt = ROOT / f"{name}.gen.txt"
    cmd = [
        str(ENGINE),
        "-m",
        str(MODEL),
        "-p",
        prompt,
        "-n",
        str(N_PREDICT),
        "-t",
        "8",
        "--temp",
        "0",
        "--chatml",
        "--no-think",
        "--moe-stream",
        "--cache-mb",
        "2000",
        "--io-threads",
        "4",
        "--n-expert-used",
        "6",
        "--drop-cold-experts",
        "0.65",
        "--route-trace",
        str(out_csv),
    ]
    print(f"=== RUN {name} ===", flush=True)
    print(" ".join(cmd[:8]), "... --route-trace", out_csv.name, flush=True)
    t0 = time.time()
    with out_log.open("w", encoding="utf-8", errors="replace") as logf:
        logf.write("# cmd: " + " ".join(cmd) + "\n")
        logf.flush()
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env_with_bin(),
            cwd=str(ROOT),
        )
        text = proc.stdout.decode("utf-8", errors="replace")
        logf.write(text)
        logf.write(f"\n# exit={proc.returncode} elapsed_s={time.time() - t0:.1f}\n")
    out_txt.write_text(text, encoding="utf-8", errors="replace")
    elapsed = time.time() - t0
    print(f"=== DONE {name} exit={proc.returncode} elapsed={elapsed:.1f}s csv={out_csv.exists()} ===", flush=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{name} failed rc={proc.returncode}; see {out_log}")
    if not out_csv.exists() or out_csv.stat().st_size < 100:
        raise RuntimeError(f"{name} produced no usable route-trace at {out_csv}")
    return out_csv


def layer_metrics(counts: dict[int, int], n_expert: int, top_k: int = 16) -> dict:
    vec = [int(counts.get(i, 0)) for i in range(n_expert)]
    total = sum(vec)
    used = sum(1 for x in vec if x > 0)
    ranked = sorted(range(n_expert), key=lambda e: vec[e], reverse=True)
    top = ranked[:top_k]
    top_share = (sum(vec[e] for e in top) / total) if total else 0.0
    return {
        "gini": gini(vec),
        "top16_share": top_share,
        "top16": top,
        "used": used,
        "never_used": n_expert - used,
        "total_act": total,
    }


def analyze(parsed: dict[str, dict]) -> dict:
    # share meta
    any_meta = next(iter(parsed.values()))["meta"]
    n_expert = int(any_meta["n_expert"])
    n_layer = int(any_meta["n_layer"])
    domains = list(parsed.keys())

    per_layer = {}
    for layer in range(n_layer):
        row = {}
        for d in domains:
            c = parsed[d]["counts"].get(layer, {})
            row[d] = layer_metrics(c, n_expert)
        # pairwise Jaccard of top-16 sets
        jacc = {}
        for i, a in enumerate(domains):
            for b in domains[i + 1 :]:
                sa, sb = set(row[a]["top16"]), set(row[b]["top16"])
                union = sa | sb
                jacc[f"{a}|{b}"] = (len(sa & sb) / len(union)) if union else 0.0
        # never-used across ALL domains at this layer
        used_any = set()
        used_all = None
        for d in domains:
            s = {e for e, n in parsed[d]["counts"].get(layer, {}).items() if n > 0}
            used_any |= s
            used_all = s if used_all is None else (used_all & s)
        row["_jaccard"] = jacc
        row["_mean_jaccard"] = (sum(jacc.values()) / len(jacc)) if jacc else 0.0
        row["_never_used_all_domains"] = n_expert - len(used_any)
        row["_used_in_every_domain"] = len(used_all or [])
        per_layer[layer] = row

    # aggregates over layers
    def mean(xs):
        return sum(xs) / len(xs) if xs else 0.0

    agg = {"domains": {}, "mean_pairwise_jaccard": mean([per_layer[l]["_mean_jaccard"] for l in range(n_layer)])}
    for d in domains:
        ginis = [per_layer[l][d]["gini"] for l in range(n_layer)]
        shares = [per_layer[l][d]["top16_share"] for l in range(n_layer)]
        unused = [per_layer[l][d]["never_used"] for l in range(n_layer)]
        agg["domains"][d] = {
            "mean_gini": mean(ginis),
            "median_gini": sorted(ginis)[len(ginis) // 2],
            "frac_layers_gini_ge_0_5": mean([1.0 if g >= 0.5 else 0.0 for g in ginis]),
            "mean_top16_share": mean(shares),
            "median_top16_share": sorted(shares)[len(shares) // 2],
            "frac_layers_top16_ge_0_6": mean([1.0 if s >= 0.6 else 0.0 for s in shares]),
            "mean_never_used": mean(unused),
            "decode_steps": parsed[d]["decode_steps"],
            "n_rows_decode": parsed[d]["n_rows_decode"],
            "n_dropped_decode": parsed[d]["n_dropped_decode"],
        }

    # experts never used in ANY layer of a domain (union of used across layers)
    never_global = {}
    used_union_all = set()  # (layer, expert)
    used_per_domain = {}
    for d in domains:
        used = set()
        for layer, cmap in parsed[d]["counts"].items():
            for e, n in cmap.items():
                if n > 0:
                    used.add((layer, e))
                    used_union_all.add((layer, e))
        used_per_domain[d] = used
        total_slots = n_layer * n_expert
        never_global[d] = {
            "used_layer_expert_pairs": len(used),
            "never_used_layer_expert_pairs": total_slots - len(used),
            "frac_never": (total_slots - len(used)) / total_slots if total_slots else 0.0,
        }
    total_slots = n_layer * n_expert
    never_combined = {
        "used_layer_expert_pairs": len(used_union_all),
        "never_used_layer_expert_pairs": total_slots - len(used_union_all),
        "frac_never": (total_slots - len(used_union_all)) / total_slots if total_slots else 0.0,
    }

    # most-layers verdict ingredients
    all_gini = [per_layer[l][d]["gini"] for l in range(n_layer) for d in domains]
    all_share = [per_layer[l][d]["top16_share"] for l in range(n_layer) for d in domains]
    frac_strong = mean([1.0 if (g >= 0.5 and s >= 0.6) else 0.0 for g, s in zip(all_gini, all_share)])
    mean_gini = mean(all_gini)
    mean_share = mean(all_share)
    mean_j = agg["mean_pairwise_jaccard"]

    if frac_strong >= 0.5 and mean_j < 0.4:
        verdict_tag = "SKEW_DOMAIN"
    elif frac_strong >= 0.5:
        verdict_tag = "SKEW_STRONG"
    else:
        verdict_tag = "SKEW_WEAK/UNIFORM"

    verdict = (
        f"{verdict_tag}(gini={mean_gini:.3f}, top16={100.0 * mean_share:.1f}%, "
        f"jaccard={mean_j:.3f})"
    )

    return {
        "verdict": verdict,
        "verdict_tag": verdict_tag,
        "mean_gini": mean_gini,
        "mean_top16_share": mean_share,
        "mean_pairwise_jaccard": mean_j,
        "frac_layer_domain_strong": frac_strong,
        "n_expert": n_expert,
        "n_layer": n_layer,
        "meta": any_meta,
        "agg": agg,
        "never_per_domain": never_global,
        "never_combined": never_combined,
        "per_layer": per_layer,
    }


def strip_top16_for_json(result: dict) -> dict:
    """Keep per-layer numbers but drop the raw top-16 id lists from the big dump."""
    slim = dict(result)
    pl = {}
    for layer, row in result["per_layer"].items():
        nr = {}
        for k, v in row.items():
            if isinstance(v, dict) and "top16" in v:
                vv = dict(v)
                vv["top16"] = v["top16"]  # keep — useful and small (16 ints)
                nr[k] = vv
            else:
                nr[k] = v
        pl[layer] = nr
    slim["per_layer"] = pl
    return slim


def write_tables(result: dict) -> None:
    # per-layer CSV
    domains = list(result["agg"]["domains"].keys())
    path = ROOT / "per_layer_metrics.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        header = ["layer"]
        for d in domains:
            header += [f"{d}_gini", f"{d}_top16", f"{d}_never_used", f"{d}_used"]
        header += ["mean_pairwise_jaccard", "never_used_all_domains"]
        w.writerow(header)
        for layer in range(result["n_layer"]):
            row = result["per_layer"][layer]
            out = [layer]
            for d in domains:
                out += [
                    f"{row[d]['gini']:.6f}",
                    f"{row[d]['top16_share']:.6f}",
                    row[d]["never_used"],
                    row[d]["used"],
                ]
            out += [f"{row['_mean_jaccard']:.6f}", row["_never_used_all_domains"]]
            w.writerow(out)

    # pairwise jaccard mean per pair across layers
    pairs = list(result["per_layer"][0]["_jaccard"].keys())
    path2 = ROOT / "jaccard_pairs.csv"
    with path2.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pair", "mean_jaccard", "min", "max"])
        for p in pairs:
            xs = [result["per_layer"][l]["_jaccard"][p] for l in range(result["n_layer"])]
            w.writerow([p, f"{sum(xs)/len(xs):.6f}", f"{min(xs):.6f}", f"{max(xs):.6f}"])


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    skip_run = "--analyze-only" in sys.argv
    parsed = {}
    run_info = {}
    if not skip_run:
        for name, prompt in DOMAINS:
            t0 = time.time()
            csv_path = run_domain(name, prompt)
            run_info[name] = {"elapsed_s": time.time() - t0, "csv": str(csv_path), "bytes": csv_path.stat().st_size}
            parsed[name] = parse_trace(csv_path)
    else:
        for name, _ in DOMAINS:
            csv_path = ROOT / f"{name}.route.csv"
            if not csv_path.exists():
                raise SystemExit(f"missing {csv_path}")
            parsed[name] = parse_trace(csv_path)
            run_info[name] = {"csv": str(csv_path), "bytes": csv_path.stat().st_size}

    result = analyze(parsed)
    result["run_info"] = run_info
    result["parse_info"] = {
        d: {
            "decode_steps": parsed[d]["decode_steps"],
            "prefill_steps": parsed[d]["prefill_steps"],
            "n_rows_decode": parsed[d]["n_rows_decode"],
            "n_rows_prefill": parsed[d]["n_rows_prefill"],
            "n_dropped_decode": parsed[d]["n_dropped_decode"],
            "meta": parsed[d]["meta"],
        }
        for d in parsed
    }
    (ROOT / "analysis.json").write_text(
        json.dumps(strip_top16_for_json(result), indent=2), encoding="utf-8"
    )
    write_tables(result)
    (ROOT / "verdict.txt").write_text(result["verdict"] + "\n", encoding="utf-8")
    print("VERDICT", result["verdict"], flush=True)
    print("wrote", ROOT / "analysis.json", ROOT / "per_layer_metrics.csv", ROOT / "jaccard_pairs.csv", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
