#!/usr/bin/env python3
"""CalaQwen kernel-readability desk analysis over dump.json (no GGUF re-read)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DUMP = HERE / "dump.json"
LEGAL_NPU = {"Q4_0", "Q4_1", "Q8_0", "IQ4_NL", "MXFP4"}
ATTN_SUFFIX = (
    "attn_q.weight",
    "attn_k.weight",
    "attn_v.weight",
    "attn_output.weight",
    "attn_qkv.weight",
)
# cook recipe actually used (results/requant1c/tensor_types_patterns.txt)
RECIPE = {
    "ffn_gate_exps": "Q2_K",
    "ffn_up_exps": "Q2_K",
    "ffn_down_exps": "Q3_K",
    "attn_gate.weight": "Q5_K",
    "attn_k.weight": "Q5_K",
    "attn_output.weight": "Q5_K",
    "attn_q.weight": "Q5_K",
    "attn_qkv.weight": "Q5_K",
    "attn_v.weight": "Q5_K",
    "ffn_down_shexp.weight": "Q6_K",
    "ffn_gate_shexp.weight": "Q5_K",
    "ffn_up_shexp.weight": "Q5_K",
    "output.weight": "Q4_K",
    "ssm_out.weight": "Q6_K",
    "token_embd.weight": "Q5_K",
}


def suffix(name: str) -> str:
    if name.startswith("blk."):
        parts = name.split(".", 2)
        return parts[2] if len(parts) == 3 else name
    return name


def npu_pred(typ: str, shape: list[int], assume_type: str | None = None) -> str:
    t = assume_type or typ
    ne0 = shape[0] if shape else 0
    ne1 = shape[1] if len(shape) > 1 else 0
    if t in ("F32", "F16"):
        return "PASS_F32" if t == "F32" else "PASS_F16"
    if t not in LEGAL_NPU:
        return "FAIL_TYPE"
    if ne0 % 32 != 0:
        return "FAIL_ALIGN"
    if ne1 > 32768:
        return "FAIL_DIM"
    return "PASS"


def main() -> None:
    d = json.loads(DUMP.read_text(encoding="utf-8"))
    tensors = d["tensors"]
    classes = defaultdict(list)
    for t in tensors:
        classes[suffix(t["name"])].append(t)

    expert_names = ("ffn_gate_exps.weight", "ffn_up_exps.weight", "ffn_down_exps.weight")
    experts = [t for t in tensors if suffix(t["name"]) in expert_names]
    expert_bytes = sum(t["nbytes"] for t in experts)
    fail_exps = []
    geom_counter = Counter()
    type_counter = Counter()
    for t in experts:
        sh = t["shape"]
        ne0, ne1 = sh[0], sh[1] if len(sh) > 1 else 0
        ne2 = sh[2] if len(sh) > 2 else None
        ok = (ne0 % 256 == 0) and (ne1 % 8 == 0)
        key = (suffix(t["name"]), t["type"], tuple(sh))
        geom_counter[key] += 1
        type_counter[t["type"]] += 1
        if not ok:
            fail_exps.append(
                {
                    "name": t["name"],
                    "type": t["type"],
                    "shape": sh,
                    "ne0_mod256": ne0 % 256,
                    "ne1_mod8": ne1 % 8,
                    "nbytes": t["nbytes"],
                }
            )
    fail_bytes = sum(x["nbytes"] for x in fail_exps)

    # layer expert-count uniformity
    by_layer = defaultdict(list)
    for t in experts:
        layer = int(t["name"].split(".")[1])
        by_layer[layer].append(t)
    n_exp_set = {tuple(sorted((suffix(t["name"]), t["shape"][2] if len(t["shape"]) > 2 else None) for t in ts)) for ts in by_layer.values()}
    layers_missing = [i for i in range(40) if i not in by_layer]

    # recipe check
    recipe_fail = []
    for t in tensors:
        suf = suffix(t["name"])
        expect = None
        for pat, typ in RECIPE.items():
            if pat in suf or pat == suf:
                expect = typ
                break
        if expect and t["type"] != expect:
            recipe_fail.append({"name": t["name"], "type": t["type"], "expect": expect})

    # first/last expert types
    first_last = {}
    for layer in (0, 39):
        first_last[layer] = [
            {"name": t["name"], "type": t["type"], "shape": t["shape"]}
            for t in sorted(by_layer.get(layer, []), key=lambda x: x["name"])
        ]

    # attn / embed NPU now vs IQ4_NL
    attn_now = []
    attn_iq4 = []
    attn_classes = defaultdict(lambda: {"n": 0, "bytes": 0, "type": None, "shape": None})
    for t in tensors:
        suf = suffix(t["name"])
        if suf in ATTN_SUFFIX or t["name"] in ("token_embd.weight", "output.weight") or suf == "attn_gate.weight":
            rec = {
                "suffix": suf if t["name"].startswith("blk.") else t["name"],
                "type": t["type"],
                "shape": t["shape"],
                "npu_now": npu_pred(t["type"], t["shape"]),
                "npu_iq4_nl": npu_pred(t["type"], t["shape"], assume_type="IQ4_NL"),
                "nbytes": t["nbytes"],
            }
            if suf in ATTN_SUFFIX or suf == "attn_gate.weight":
                attn_now.append(rec)
            attn_iq4.append(rec)
            k = rec["suffix"]
            attn_classes[k]["n"] += 1
            attn_classes[k]["bytes"] += t["nbytes"]
            attn_classes[k]["type"] = t["type"]
            attn_classes[k]["shape"] = t["shape"]
            attn_classes[k]["npu_now"] = rec["npu_now"]
            attn_classes[k]["npu_iq4_nl"] = rec["npu_iq4_nl"]
            attn_classes[k]["ne0_mod32"] = t["shape"][0] % 32
            attn_classes[k]["ne1"] = t["shape"][1] if len(t["shape"]) > 1 else 0

    # shexp + ssm_out (trunk-like, dump_gguf role=other)
    extra_trunk = defaultdict(lambda: {"n": 0, "bytes": 0, "type": None, "shape": None})
    for t in tensors:
        suf = suffix(t["name"])
        if suf in (
            "ffn_gate_shexp.weight",
            "ffn_up_shexp.weight",
            "ffn_down_shexp.weight",
            "ssm_out.weight",
        ):
            extra_trunk[suf]["n"] += 1
            extra_trunk[suf]["bytes"] += t["nbytes"]
            extra_trunk[suf]["type"] = t["type"]
            extra_trunk[suf]["shape"] = t["shape"]
            extra_trunk[suf]["npu_now"] = npu_pred(t["type"], t["shape"])
            extra_trunk[suf]["npu_iq4_nl"] = npu_pred(t["type"], t["shape"], assume_type="IQ4_NL")

    # layer kinds
    gdn_layers = sorted(
        {int(t["name"].split(".")[1]) for t in tensors if suffix(t["name"]) == "attn_qkv.weight"}
    )
    full_attn_layers = sorted(
        {int(t["name"].split(".")[1]) for t in tensors if suffix(t["name"]) == "attn_q.weight"}
    )

    # unique class table
    class_table = []
    for suf, ts in sorted(classes.items()):
        types = Counter(t["type"] for t in ts)
        shapes = Counter(tuple(t["shape"]) for t in ts)
        nbytes = sum(t["nbytes"] for t in ts)
        role = ts[0]["role"]
        sh0 = ts[0]["shape"]
        is_exp = suf in expert_names
        entry = {
            "class": suf,
            "n": len(ts),
            "types": dict(types),
            "shapes": {str(list(k)): v for k, v in shapes.items()},
            "nbytes": nbytes,
            "dump_role": role,
            "repack_gate": None,
            "npu_now": npu_pred(ts[0]["type"], sh0),
            "npu_iq4_nl": npu_pred(ts[0]["type"], sh0, assume_type="IQ4_NL"),
        }
        if is_exp:
            ne0, ne1 = sh0[0], sh0[1]
            entry["repack_gate"] = "PASS" if (ne0 % 256 == 0 and ne1 % 8 == 0) else "FAIL"
            entry["ne0"] = ne0
            entry["ne1"] = ne1
            entry["n_exp"] = sh0[2] if len(sh0) > 2 else None
            entry["ne0_mod256"] = ne0 % 256
            entry["ne1_mod8"] = ne1 % 8
        class_table.append(entry)

    token = next(t for t in tensors if t["name"] == "token_embd.weight")
    head = next(t for t in tensors if t["name"] == "output.weight")

    out = {
        "source_dump": str(DUMP),
        "gguf": d["file"],
        "bytes_on_disk": d["bytes_on_disk"],
        "n_tensors": d["n_tensors"],
        "types": d["types"],
        "roles": d["roles"],
        "meta": {
            k: v
            for k, v in d["meta"].items()
            if not str(v).startswith("ReaderField")
        },
        "vocab_from_embd": token["shape"][1],
        "embd": token["shape"][0],
        "experts": {
            "n": len(experts),
            "bytes": expert_bytes,
            "share": expert_bytes / d["bytes_on_disk"],
            "types": dict(type_counter),
            "geometries": {str(k): v for k, v in geom_counter.items()},
            "fail_n": len(fail_exps),
            "fail_bytes": fail_bytes,
            "fail_share_of_expert_bytes": fail_bytes / expert_bytes if expert_bytes else None,
            "fail_tensors": fail_exps,
            "n_layers_with_experts": len(by_layer),
            "layers_missing_experts": layers_missing,
            "expert_layout_unique": len(n_exp_set) == 1,
            "first_last": first_last,
        },
        "hybrid": {
            "gdn_layers": gdn_layers,
            "full_attn_layers": full_attn_layers,
            "n_gdn": len(gdn_layers),
            "n_full_attn": len(full_attn_layers),
        },
        "recipe_fail": recipe_fail,
        "attn_classes": dict(attn_classes),
        "extra_trunk": dict(extra_trunk),
        "class_table": class_table,
        "lm_head": {"name": head["name"], "type": head["type"], "shape": head["shape"], "nbytes": head["nbytes"]},
        "token_embd": {"name": token["name"], "type": token["type"], "shape": token["shape"], "nbytes": token["nbytes"]},
    }
    dest = HERE / "analysis.json"
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", dest)
    print("experts", out["experts"]["n"], "fail", out["experts"]["fail_n"], "fail_share", out["experts"]["fail_share_of_expert_bytes"])
    print("recipe_fail", len(recipe_fail))
    print("gdn", out["hybrid"]["n_gdn"], "full_attn", out["hybrid"]["n_full_attn"])
    print("vocab", out["vocab_from_embd"], "head", out["lm_head"])


if __name__ == "__main__":
    main()
