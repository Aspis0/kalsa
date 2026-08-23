#!/usr/bin/env python3
"""NPU desk predicates on trunk attention tensors (q36 method, no device).

Predicates from upstream-hexagon ggml-hexagon.cpp ggml_hexagon_supported_mul_mat:
  quantized MUL_MAT accepts Q4_0 / Q4_1 / Q8_0 / IQ4_NL / MXFP4 only
  1. src0->ne[0] % 32 == 0
  2. src0->ne[1] <= 32768
  3. nseq=1 (assumed at desk)
  4. K-quants -> FAIL_TYPE
GET_ROWS is F32-only (~3136-3155).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from gguf import GGUFReader

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
LEGAL = {"Q4_0", "Q4_1", "Q8_0", "IQ4_NL", "MXFP4"}
ATTN = ("attn_q.weight", "attn_k.weight", "attn_v.weight", "attn_output.weight", "attn_qkv.weight")
SHORTCONV = ("shortconv.in_proj.weight", "shortconv.out_proj.weight")


def classify(name: str, typ: str, shape: list[int]) -> dict:
    ne0 = shape[0] if shape else 0
    ne1 = shape[1] if len(shape) > 1 else 0
    kind = "other"
    if name in ("token_embd.weight", "output.weight"):
        kind = "embed_or_head"
    elif any(s in name for s in ATTN):
        kind = "attn"
    elif any(s in name for s in SHORTCONV):
        kind = "shortconv"
    elif "ffn_gate_exps" in name or "ffn_up_exps" in name or "ffn_down_exps" in name:
        kind = "expert"
    elif "ffn_gate_inp" in name:
        kind = "router"
    align = (ne0 % 32 == 0)
    dim_ok = ne1 <= 32768
    if typ in ("F32", "F16"):
        pred = "PASS_F32" if typ == "F32" else "PASS_F16"
        note = "F32/F16 path (not the quantized switch)"
    elif typ not in LEGAL:
        pred = "FAIL_TYPE"
        note = f"{typ} not in Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4"
    elif not align:
        pred = "FAIL_ALIGN"
        note = f"ne[0]={ne0} % 32 != 0"
    elif not dim_ok:
        pred = "FAIL_DIM"
        note = f"ne[1]={ne1} > 32768 (lm-head cap)"
    else:
        pred = "PASS"
        note = "quantized MUL_MAT predicates hold (desk, nseq=1 assumed)"
    if kind == "embed_or_head" and name == "token_embd.weight":
        note += "; GET_ROWS is F32-only so embed lookup on HTP is FAIL_TYPE regardless"
    return {
        "name": name,
        "type": typ,
        "shape": shape,
        "ne0": ne0,
        "ne1": ne1,
        "kind": kind,
        "predicate": pred,
        "note": note,
    }


def scan(path: Path) -> list[dict]:
    r = GGUFReader(str(path))
    rows = []
    for t in r.tensors:
        shape = [int(x) for x in t.shape]
        rec = classify(t.name, t.tensor_type.name, shape)
        if rec["kind"] in ("attn", "embed_or_head", "shortconv", "router", "expert"):
            rows.append(rec)
    return rows


def summarize(rows: list[dict]) -> dict:
    attn = [x for x in rows if x["kind"] == "attn"]
    heads = [x for x in rows if x["kind"] == "embed_or_head"]
    sc = [x for x in rows if x["kind"] == "shortconv"]
    return {
        "attn_n": len(attn),
        "attn_pass": sum(1 for x in attn if x["predicate"] == "PASS"),
        "attn_fail_type": sum(1 for x in attn if x["predicate"] == "FAIL_TYPE"),
        "attn_fail_other": sum(1 for x in attn if x["predicate"] not in ("PASS", "FAIL_TYPE")),
        "embed_head": heads,
        "shortconv_n": len(sc),
        "shortconv_pass": sum(1 for x in sc if x["predicate"] == "PASS"),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: npu_desk.py GGUF [OUT.md]", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    rows = scan(src)
    summ = summarize(rows)
    md = [
        f"# NPU desk — {src.name}",
        "",
        "Method: q36 / `ggml_hexagon_supported_mul_mat`. Desk only, no device.",
        "",
        f"- attn tensors: {summ['attn_n']}; PASS={summ['attn_pass']} FAIL_TYPE={summ['attn_fail_type']} other={summ['attn_fail_other']}",
        f"- shortconv: {summ['shortconv_n']} PASS={summ['shortconv_pass']}",
        "",
        "| tensor | type | shape | kind | predicate | note |",
        "|---|---|---|---|---|---|",
    ]
    interesting = [x for x in rows if x["kind"] in ("attn", "embed_or_head", "shortconv")]
    # collapse identical (suffix after blk.N., type, shape, pred) across layers
    def pattern(name: str) -> str:
        if name.startswith("blk."):
            rest = name.split(".", 2)
            return rest[2] if len(rest) == 3 else name
        return name
    seen = []
    collapsed = []
    counts = {}
    for x in interesting:
        key = (pattern(x["name"]), x["type"], tuple(x["shape"]), x["kind"], x["predicate"])
        counts[key] = counts.get(key, 0) + 1
        if key not in seen:
            seen.append(key)
            collapsed.append(x)
    for x in collapsed:
        key = (pattern(x["name"]), x["type"], tuple(x["shape"]), x["kind"], x["predicate"])
        label = x["name"] if counts[key] == 1 else f"{key[0]} ×{counts[key]}"
        md.append(
            f"| `{label}` | {x['type']} | {x['shape']} | {x['kind']} | **{x['predicate']}** | {x['note']} |"
        )
    text = "\n".join(md) + "\n"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        (out.with_suffix(".json")).write_text(
            json.dumps({"file": str(src), "summary": summ, "rows": rows}, indent=2),
            encoding="utf-8",
        )
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
