#!/usr/bin/env python3
"""Summarize bmoe --compute-trace CSV for F5.2-C1.

Classifies each node into buckets required by the mandate:
  expert_gemm   — ffn_{gate,up,down}_exps / MUL_MAT_ID on experts
  attn_full     — full-attention layers (interval 4: 3,7,...,39)
  attn_gdn      — Gated DeltaNet / SSM layers (the other 30)
  router        — ffn_gate_inp, topk, softmax on routing, argsort
  barrier_like  — ops that are pure sync/view/reshape with near-zero compute
  rest          — everything else (norms, residual, embd, lm_head, shared ffn, ...)

Full-attn layers for Qwen3.6-35B-A3B: full_attention_interval=4 → {3,7,11,15,19,23,27,31,35,39}.

Usage:
  python3 f52_compute_trace_summary.py ct.csv [--phase decode|prefill|all]
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

FULL_ATTN = {3, 7, 11, 15, 19, 23, 27, 31, 35, 39}

EXPERT_NAME_RE = re.compile(
    r"ffn_(gate|up|down)_exps|ffn_gate_up_exps|exps\.|MUL_MAT_ID", re.I
)
ROUTER_NAME_RE = re.compile(
    r"ffn_gate_inp|gate_inp|topk|top_k|argsort|route", re.I
)
ATTN_NAME_RE = re.compile(
    r"attn_|flash_attn|soft_max|softmax|kqv|qkv|rope|alibi|ssm_|delta|conv1d|gated",
    re.I,
)
GDN_NAME_RE = re.compile(r"ssm_|delta|conv1d|gated_delta|recurrent", re.I)
BARRIER_OPS = {
    "VIEW",
    "RESHAPE",
    "PERMUTE",
    "TRANSPOSE",
    "CONT",
    "CPY",
    "NONE",
    "LAYER",  # layer-aggregate rows are handled separately
}


def read_trace(path: Path):
    meta = {}
    rows = []
    with path.open(encoding="utf-8", errors="replace") as f:
        body = []
        for ln in f:
            if ln.startswith("#"):
                for tok in ln.lstrip("#").split():
                    if "=" in tok:
                        k, v = tok.split("=", 1)
                        meta[k] = v
            else:
                body.append(ln)
        if not body:
            return meta, []
        rdr = csv.DictReader(body)
        for r in rdr:
            rows.append(r)
    return meta, rows


def layer_of(r) -> int:
    try:
        return int(r.get("layer", -1))
    except Exception:
        return -1


def classify(r) -> str:
    op = (r.get("op") or "").strip()
    name = (r.get("name") or "").strip()
    il = layer_of(r)

    if op == "LAYER":
        # layer-aggregate mode: name is pre / post / blk.N
        if name == "pre":
            return "rest"
        if name == "post":
            return "rest"
        m = re.match(r"blk\.(\d+)", name)
        if m:
            lil = int(m.group(1))
            if lil in FULL_ATTN:
                return "layer_full"
            return "layer_gdn"
        return "rest"

    # expert GEMM
    if op == "MUL_MAT_ID" or EXPERT_NAME_RE.search(name) or EXPERT_NAME_RE.search(op):
        return "expert_gemm"

    # router
    if ROUTER_NAME_RE.search(name) or op in {"TOP_K", "ARGSORT"}:
        # soft_max on router names only
        if op == "SOFT_MAX" and ROUTER_NAME_RE.search(name):
            return "router"
        if op != "SOFT_MAX":
            return "router"
        # bare SOFT_MAX without router name → attention
        return "attn_full" if il in FULL_ATTN else ("attn_gdn" if il >= 0 else "rest")

    if op == "SOFT_MAX":
        return "attn_full" if il in FULL_ATTN else ("attn_gdn" if il >= 0 else "rest")

    # GDN / SSM
    if GDN_NAME_RE.search(name):
        return "attn_gdn"

    # attention-ish
    if ATTN_NAME_RE.search(name) or op in {
        "FLASH_ATTN_EXT",
        "ROPE",
        "GET_REL_POS",
        "RWKV_WKV6",
        "RWKV_WKV7",
        "SSM_CONV",
        "SSM_SCAN",
    }:
        if il in FULL_ATTN or "attn" in name.lower():
            # ssm in name already caught; remaining attn → full if layer full else gdn bucket if ssm layer
            if il in FULL_ATTN:
                return "attn_full"
            if il >= 0 and il not in FULL_ATTN:
                return "attn_gdn"
            return "attn_full"
        return "attn_gdn" if il not in FULL_ATTN and il >= 0 else "attn_full"

    # MUL_MAT on attn projections (qkv/out) by name
    if op in {"MUL_MAT", "MUL"} and re.search(r"attn_|qkv|ssm_out|ssm_in", name, re.I):
        return "attn_full" if il in FULL_ATTN else "attn_gdn"

    # shared / dense ffn
    if re.search(r"ffn_(gate|up|down)(?!_exps|_inp)", name):
        return "rest"

    if op in BARRIER_OPS:
        return "barrier_like"

    return "rest"


def summarize(path: Path, phase: str = "decode"):
    meta, rows = read_trace(path)
    if not rows:
        print(f"EMPTY {path}")
        return

    if phase == "decode":
        rows = [r for r in rows if r.get("phase") == "1"] or rows
    elif phase == "prefill":
        rows = [r for r in rows if r.get("phase") == "0"] or rows

    steps = sorted({int(r["step"]) for r in rows if r.get("step", "").lstrip("-").isdigit()})
    n_steps = max(len(steps), 1)
    total_ns = sum(int(r.get("wall_ns") or 0) for r in rows)
    total_flt = sum(int(r.get("majflt") or 0) for r in rows)

    buckets = defaultdict(lambda: {"ns": 0, "n": 0, "majflt": 0})
    by_op = defaultdict(lambda: {"ns": 0, "n": 0})
    by_layer = defaultdict(lambda: {"ns": 0, "n": 0})

    for r in rows:
        b = classify(r)
        ns = int(r.get("wall_ns") or 0)
        mf = int(r.get("majflt") or 0)
        buckets[b]["ns"] += ns
        buckets[b]["n"] += 1
        buckets[b]["majflt"] += mf
        op = r.get("op") or "?"
        by_op[op]["ns"] += ns
        by_op[op]["n"] += 1
        il = layer_of(r)
        by_layer[il]["ns"] += ns
        by_layer[il]["n"] += 1

    # merge layer_* into attention if only layer-mode present
    is_layer_mode = all((r.get("op") == "LAYER") for r in rows)

    print(f"file={path}")
    print(f"meta={meta}")
    print(f"phase_filter={phase} rows={len(rows)} steps={n_steps} layer_mode={is_layer_mode}")
    print(f"measured_ms_per_tok={total_ns/1e6/n_steps:.2f} majflt_per_tok={total_flt/n_steps:.1f}")
    print()
    print(f"{'bucket':<16}{'ms/tok':>10}{'share%':>9}{'majflt/tok':>12}{'nodes':>8}")
    order = [
        "expert_gemm",
        "attn_full",
        "attn_gdn",
        "layer_full",
        "layer_gdn",
        "router",
        "barrier_like",
        "rest",
    ]
    for b in order:
        if b not in buckets:
            continue
        ns = buckets[b]["ns"]
        share = 100.0 * ns / total_ns if total_ns else 0
        print(
            f"{b:<16}{ns/1e6/n_steps:10.2f}{share:9.1f}"
            f"{buckets[b]['majflt']/n_steps:12.1f}{buckets[b]['n']:8d}"
        )
    print()
    print("top ops by wall:")
    for op, d in sorted(by_op.items(), key=lambda kv: -kv[1]["ns"])[:15]:
        share = 100.0 * d["ns"] / total_ns if total_ns else 0
        print(f"  {op:<20}{d['ns']/1e6/n_steps:8.2f} ms/tok  {share:5.1f}%  n={d['n']}")
    print()
    print("by layer (ms/tok), full-attn marked *:")
    for il in sorted(by_layer):
        mark = "*" if il in FULL_ATTN else " "
        print(f"  L{il:>3}{mark} {by_layer[il]['ns']/1e6/n_steps:8.2f}")

    # decision helpers
    print()
    if is_layer_mode:
        full = buckets.get("layer_full", {}).get("ns", 0)
        gdn = buckets.get("layer_gdn", {}).get("ns", 0)
        rest = buckets.get("rest", {}).get("ns", 0)
        print(
            f"LAYER_MODE shares: full_layers={100*full/total_ns:.1f}% "
            f"gdn_layers={100*gdn/total_ns:.1f}% pre/post={100*rest/total_ns:.1f}%"
        )
    else:
        eg = buckets.get("expert_gemm", {}).get("ns", 0)
        af = buckets.get("attn_full", {}).get("ns", 0)
        ag = buckets.get("attn_gdn", {}).get("ns", 0)
        rt = buckets.get("router", {}).get("ns", 0)
        br = buckets.get("barrier_like", {}).get("ns", 0)
        print(
            f"NODE_MODE shares: expert_gemm={100*eg/total_ns:.1f}% "
            f"attn_full={100*af/total_ns:.1f}% attn_gdn={100*ag/total_ns:.1f}% "
            f"router={100*rt/total_ns:.1f}% barrier_like={100*br/total_ns:.1f}%"
        )
        print(
            f"RULE_HINTS: expert_gemm>60? {100*eg/total_ns > 60}; "
            f"attn_full>30? {100*af/total_ns > 30}; "
            f"router+barrier>25? {100*(rt+br)/total_ns > 25}"
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--phase", default="decode", choices=["decode", "prefill", "all"])
    args = ap.parse_args()
    summarize(Path(args.path), args.phase)


if __name__ == "__main__":
    main()
