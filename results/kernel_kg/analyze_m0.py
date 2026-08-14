#!/usr/bin/env python3
"""Classify a bmoe-cli --compute-trace CSV into expert-FFN vs attn+dense+lm_head.

Prefill-only (phase=0). Shares, not absolutes: isolating every node inflates wall.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def read_trace(path: Path):
    meta = {}
    rows = []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("#"):
                body = line[1:].strip()
                if "=" in body and not body.startswith("compute_trace"):
                    for tok in body.split():
                        if "=" in tok:
                            k, v = tok.split("=", 1)
                            meta[k] = v
                continue
            if line.startswith("turn,"):
                header = [h.strip() for h in line.strip().split(",")]
                reader = csv.DictReader(f, fieldnames=header)
                for r in reader:
                    rows.append(r)
                break
            # already in body
            break
    if not rows:
        with path.open(encoding="utf-8", errors="replace") as f:
            lines = [ln for ln in f if not ln.startswith("#")]
        if not lines:
            return meta, []
        reader = csv.DictReader(lines)
        rows = list(reader)
    return meta, rows


def classify(op: str, name: str) -> str:
    """Return expert_ffn | attn_dense | glue | other."""
    n = (name or "").lower()
    o = (op or "").upper()

    expert_name_bits = (
        "ffn_gate_exps",
        "ffn_up_exps",
        "ffn_down_exps",
        "exps",
        "moe",
        "mul_mat_id",
    )
    if o == "MUL_MAT_ID" or any(b in n for b in expert_name_bits):
        return "expert_ffn"
    # routing that exists only because of MoE experts
    if any(b in n for b in ("ffn_gate_inp", "expert", "argsort")) or o in ("ARGSORT",):
        return "expert_ffn"

    attn_bits = (
        "attn",
        "ssm",
        "gdn",
        "gated_delta",
        "qkv",
        "rope",
        "softmax",
        "flash",
        "kqv",
        "wo",
        "attn_gate",
        "attn_norm",
        "attn_output",
    )
    dense_bits = (
        "ffn_gate_shexp",
        "ffn_up_shexp",
        "ffn_down_shexp",
        "ffn_gate_inp_shexp",
        "shexp",
        "shared",
        "output_norm",
        "output",
        "lm_head",
        "embd",
        "token_embd",
        "norm",
    )
    if any(b in n for b in attn_bits) or o in (
        "GATED_DELTA_NET",
        "SSM_CONV",
        "FLASH_ATTN_EXT",
        "ROPE",
        "SOFT_MAX",
        "SOLVE_TRI",
        "CUMSUM",
        "L2_NORM",
        "TRI",
        "DIAG",
    ):
        return "attn_dense"
    if any(b in n for b in dense_bits) or o in ("RMS_NORM", "GET_ROWS", "GLU"):
        # GET_ROWS on embd = embedding lookup (attn_dense bucket: not expert FFN)
        # GLU on shexp is dense; GLU after MUL_MAT_ID is expert — name usually has exps
        if "exps" in n:
            return "expert_ffn"
        return "attn_dense"

    if o in ("MUL_MAT",):
        # unnamed MUL_MAT: shared/attn projections vs gate_inp already caught
        if "ffn" in n and "exps" not in n and "shexp" not in n:
            return "attn_dense"
        return "attn_dense"

    if o in ("CPY", "CONT", "RESHAPE", "VIEW", "PERMUTE", "TRANSPOSE", "REPEAT", "CONCAT",
             "PAD", "ADD", "SUB", "MUL", "DIV", "SCALE", "SET", "FILL", "CLAMP"):
        return "glue"
    return "other"


def main():
    if len(sys.argv) < 2:
        print("usage: analyze_m0.py TRACE.csv [out.json]", file=sys.stderr)
        sys.exit(2)
    path = Path(sys.argv[1])
    meta, rows = read_trace(path)
    pref = [r for r in rows if str(r.get("phase", "0")) == "0"]
    if not pref:
        pref = rows

    buckets = defaultdict(lambda: {"ns": 0, "n": 0, "majflt": 0})
    by_op = defaultdict(lambda: {"ns": 0, "n": 0})
    by_class_op = defaultdict(lambda: {"ns": 0, "n": 0})
    total = 0
    for r in pref:
        try:
            ns = int(r.get("wall_ns") or 0)
        except ValueError:
            ns = 0
        total += ns
        op = r.get("op") or ""
        name = r.get("name") or ""
        cls = classify(op, name)
        buckets[cls]["ns"] += ns
        buckets[cls]["n"] += 1
        buckets[cls]["majflt"] += int(r.get("majflt") or 0)
        by_op[op]["ns"] += ns
        by_op[op]["n"] += 1
        by_class_op[f"{cls}|{op}"]["ns"] += ns
        by_class_op[f"{cls}|{op}"]["n"] += 1

    expert = buckets["expert_ffn"]["ns"]
    attn = buckets["attn_dense"]["ns"]
    glue = buckets["glue"]["ns"]
    other = buckets["other"]["ns"]
    # glue/other attached to neither: report separately, fold into attn_dense
    # for the gate question (expert-FFN vs the rest).
    rest = attn + glue + other
    expert_frac = (expert / total) if total else 0.0
    rest_frac = (rest / total) if total else 0.0

    out = {
        "meta": meta,
        "n_rows_prefill": len(pref),
        "n_rows_all": len(rows),
        "total_ns": total,
        "total_s": total / 1e9,
        "expert_ffn_ns": expert,
        "expert_ffn_frac": expert_frac,
        "attn_dense_ns": attn,
        "attn_dense_frac": (attn / total) if total else 0.0,
        "glue_ns": glue,
        "glue_frac": (glue / total) if total else 0.0,
        "other_ns": other,
        "other_frac": (other / total) if total else 0.0,
        "rest_frac": rest_frac,
        "gate_expert_gt_60pct": expert_frac > 0.60,
        "buckets": {k: dict(v) for k, v in buckets.items()},
        "by_op": {k: dict(v) for k, v in sorted(by_op.items(), key=lambda kv: -kv[1]["ns"])},
    }

    print(f"file={path}")
    print(f"model={meta.get('model','?')} arch={meta.get('arch','?')} n_layer={meta.get('n_layer','?')}")
    print(f"prefill_rows={len(pref)} traced_s={total/1e9:.3f}")
    print(f"expert_ffn  {expert/1e9:8.3f}s  {expert_frac*100:6.2f}%")
    print(f"attn_dense  {attn/1e9:8.3f}s  {(attn/total*100 if total else 0):6.2f}%")
    print(f"glue        {glue/1e9:8.3f}s  {(glue/total*100 if total else 0):6.2f}%")
    print(f"other       {other/1e9:8.3f}s  {(other/total*100 if total else 0):6.2f}%")
    print(f"GATE expert>60% = {out['gate_expert_gt_60pct']}")
    print("\nby op (top 15):")
    for op, v in list(out["by_op"].items())[:15]:
        frac = v["ns"] / total if total else 0
        print(f"  {op:<18} {v['ns']/1e9:8.3f}s {frac*100:6.2f}%  n={v['n']}")

    if len(sys.argv) >= 3:
        Path(sys.argv[2]).write_text(json.dumps(out, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
