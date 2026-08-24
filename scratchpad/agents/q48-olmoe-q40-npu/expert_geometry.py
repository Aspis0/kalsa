#!/usr/bin/env python3
"""Expert geometry + NPU desk predicates for MUL_MAT_ID on OLMoE Q4_0 gguf.

Reports: n_experts, experts per token (top-k), expert tensor shapes,
total expert bytes, and per-tensor HTP predicates
(ggml_hexagon_supported_mul_mat desk rules):
  - type in {Q4_0,Q4_1,Q8_0,IQ4_NL,MXFP4} for the quantized switch
  - ne[0] % 32 == 0
  - ne[1] <= 32768
MUL_MAT_ID additionally requires all expert tensors share identical ne.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from gguf import GGUFReader

LEGAL = {"Q4_0", "Q4_1", "Q8_0", "IQ4_NL", "MXFP4"}


def main() -> int:
    src = Path(sys.argv[1])
    out_json = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    r = GGUFReader(str(src))

    # --- metadata of interest ---
    meta = {}
    for k in r.fields:
        if any(s in k for s in ("expert", "n_layer", "n_embd", "n_head", "general.")):
            try:
                meta[k] = [v.as_bytes() if v else None for v in r.get_reader(k).data] \
                    if False else str(r.get_reader(k).data)
            except Exception:
                pass

    def kv_str(key):
        try:
            rd = r.get_reader(key)
            return rd.data.tolist() if hasattr(rd.data, "tolist") else str(rd.data)
        except Exception:
            return None

    n_expert = kv_str("olmoe.expert_count") or kv_str("{arch}.expert_count")
    n_expert_used = kv_str("olmoe.expert_used_count") or kv_str("{arch}.expert_used_count")

    # --- scan tensors ---
    expert_rows = []
    attn_rows = []
    other_types = {}
    total_expert_bytes = 0
    for t in r.tensors:
        typ = t.tensor_type.name
        shape = [int(x) for x in t.shape]
        name = t.name
        # gguf shape order is reversed vs ne; compute ne
        dims = t.data.shape  # numpy view shape = reversed ne already? use field approach below
        ne = list(reversed(shape)) if len(shape) > 1 else shape
        nbytes = int(t.n_bytes)

        is_expert = ("ffn_gate_exps" in name or "ffn_up_exps" in name or "ffn_down_exps" in name)
        is_attn = any(s in name for s in ("attn_q.weight", "attn_k.weight", "attn_v.weight",
                                          "attn_output.weight", "attn_qkv.weight"))
        rec = {"name": name, "type": typ, "shape_gguf": shape, "ne": ne, "bytes": nbytes}
        if is_expert:
            align = (ne[0] % 32 == 0)
            dim_ok = (ne[1] <= 32768)
            type_ok = typ in LEGAL
            rec["predicate"] = {
                "type_ok": type_ok, "align_ne0_mod32": align, "ne1_le_32768": dim_ok,
                "verdict": "PASS" if (type_ok and align and dim_ok) else (
                    "FAIL_TYPE" if not type_ok else ("FAIL_ALIGN" if not align else "FAIL_DIM")),
            }
            total_expert_bytes += nbytes
            expert_rows.append(rec)
        elif is_attn:
            align = (ne[0] % 32 == 0)
            dim_ok = (ne[1] <= 32768)
            if typ in ("F32", "F16"):
                verdict = f"PASS_{typ}"  # F32/F16 path
                type_ok = True
            elif typ not in LEGAL:
                verdict = "FAIL_TYPE"
                type_ok = False
            elif not align:
                verdict = "FAIL_ALIGN"
                type_ok = True
            elif not dim_ok:
                verdict = "FAIL_DIM"
                type_ok = True
            else:
                verdict = "PASS"
                type_ok = True
            rec["predicate"] = {"type_ok": type_ok, "align_ne0_mod32": align,
                                "ne1_le_32768": dim_ok, "verdict": verdict}
            attn_rows.append(rec)
        else:
            other_types.setdefault(typ, []).append(name)

    # --- collapse expert rows by pattern ---
    patterns = {}
    for x in expert_rows:
        suffix = x["name"].split(".", 2)[2] if x["name"].startswith("blk.") else x["name"]
        p = patterns.setdefault((suffix, x["type"], tuple(x["ne"])),
                                {"suffix": suffix, "type": x["type"], "ne": x["ne"],
                                 "count": 0, "bytes_each": x["bytes"], "preds": set()})
        p["count"] += 1
        p["preds"].add(x["predicate"]["verdict"])

    # distinct expert shapes check (MUL_MAT_ID needs identical ne across experts;
    # here experts are stacked in one tensor so check consistency ACROSS layers)
    distinct_shapes = {(x["type"], tuple(x["ne"])) for x in expert_rows}

    summary = {
        "file": str(src),
        "file_size_bytes": src.stat().st_size,
        "sha256": None,  # filled by caller if provided
        "n_expert_kv": n_expert,
        "n_expert_used_kv": n_expert_used,
        "expert_tensor_count": len(expert_rows),
        "attn_tensor_count": len(attn_rows),
        "total_expert_bytes": total_expert_bytes,
        "total_expert_GiB": round(total_expert_bytes / 1024**3, 3),
        "distinct_expert_type_shape": [[t, list(s)] for t, s in sorted(distinct_shapes)],
        "non_q40_other_types": {k: v for k, v in sorted(other_types.items())},
        "expert_predicates_fail": [x["name"] for x in expert_rows
                                   if x["predicate"]["verdict"] != "PASS"],
        "attn_predicate_summary": {},
    }
    for x in attn_rows:
        summary["attn_predicate_summary"][x["predicate"]["verdict"]] = \
            summary["attn_predicate_summary"].get(x["predicate"]["verdict"], 0) + 1

    payload = {
        "summary": summary,
        "expert_patterns": [
            {k: v for k, v in p.items() if k != "preds"} | {"preds": sorted(p["preds"])}
            for p in patterns.values()
        ],
        "attn_patterns": [],
    }
    seen = set()
    for x in attn_rows:
        suffix = x["name"].split(".", 2)[2] if x["name"].startswith("blk.") else x["name"]
        key = (suffix, x["type"], tuple(x["ne"]), x["predicate"]["verdict"])
        if key not in seen:
            seen.add(key)
            payload["attn_patterns"].append({"name_suffix": suffix, "type": x["type"],
                                             "ne": x["ne"], "verdict": x["predicate"]["verdict"]})

    text = json.dumps(payload, indent=2)
    print(text)
    if out_json:
        out_json.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
