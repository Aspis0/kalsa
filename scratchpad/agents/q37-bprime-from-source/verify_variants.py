#!/usr/bin/env python3
"""Verify from-source B′ variants: experts byte-identical, trunk types, sizes."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from gguf import GGUFReader

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q37-bprime-from-source"
EXPECT_TRUNK = {"q8_0": "Q8_0", "iq4_nl": "IQ4_NL", "q4_0": "Q4_0"}
EXPERT_SUBSTR = ("ffn_gate_exps", "ffn_up_exps", "ffn_down_exps")
TRUNK_SUBSTR = (
    "attn_q.weight",
    "attn_k.weight",
    "attn_v.weight",
    "attn_output.weight",
    "attn_qkv.weight",
    "shortconv.in_proj.weight",
    "shortconv.out_proj.weight",
    "ffn_gate.weight",
    "ffn_up.weight",
    "ffn_down.weight",
)
KQUANT = {"Q2_K", "Q3_K", "Q4_K", "Q5_K", "Q6_K"}


def is_expert(name: str) -> bool:
    return any(s in name for s in EXPERT_SUBSTR)


def is_trunk_weight(name: str) -> bool:
    if name in ("token_embd.weight", "output.weight"):
        return True
    return any(s in name for s in TRUNK_SUBSTR)


def load(path: Path) -> dict:
    r = GGUFReader(str(path))
    tensors = []
    types = Counter()
    expert_hash = hashlib.sha256()
    trunk_bytes = 0
    expert_bytes = 0
    other_bytes = 0
    for t in r.tensors:
        typ = t.tensor_type.name
        types[typ] += 1
        data = bytes(t.data)
        nbytes = len(data)
        rec = {
            "name": t.name,
            "type": typ,
            "shape": [int(x) for x in t.shape],
            "nbytes": nbytes,
        }
        if is_expert(t.name):
            expert_hash.update(t.name.encode("utf-8"))
            expert_hash.update(data)
            expert_bytes += nbytes
            rec["role"] = "expert"
        elif is_trunk_weight(t.name):
            trunk_bytes += nbytes
            rec["role"] = "trunk"
        else:
            other_bytes += nbytes
            rec["role"] = "other"
        tensors.append(rec)
    return {
        "path": str(path),
        "bytes_on_disk": path.stat().st_size,
        "n_tensors": len(tensors),
        "types": dict(types),
        "trunk_bytes": trunk_bytes,
        "expert_bytes": expert_bytes,
        "other_bytes": other_bytes,
        "trunk_share": trunk_bytes / path.stat().st_size if path.stat().st_size else 0,
        "expert_sha256": expert_hash.hexdigest(),
        "tensors": tensors,
    }


def gguf_for(model: str, arm: str) -> Path:
    prefix = {
        "marco": "Marco-Mini-Instruct-KEXP-fromsrc",
        "olmoe": "OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc",
        "lfm": "LFM2.5-8B-A1B-KEXP-fromsrc",
    }[model]
    return HERE / "gguf" / model / f"{prefix}-trunk-{arm}.gguf"


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: verify_variants.py marco|olmoe|lfm", file=sys.stderr)
        return 2
    model = sys.argv[1]
    out_dir = HERE / "verify" / model
    out_dir.mkdir(parents=True, exist_ok=True)
    base_path = gguf_for(model, "control")
    if not base_path.exists():
        print("missing control", base_path, file=sys.stderr)
        return 2
    base = load(base_path)
    report = {"model": model, "baseline": {k: v for k, v in base.items() if k != "tensors"}}
    base_by_name = {t["name"]: t for t in base["tensors"]}
    lines = [
        f"model={model}",
        f"control bytes={base['bytes_on_disk']} types={base['types']}",
        f"control trunk_bytes={base['trunk_bytes']} share={base['trunk_share']:.4f}",
        f"control expert_bytes={base['expert_bytes']}",
        f"control expert_sha256={base['expert_sha256']}",
    ]
    all_ok = True
    variants_out = {}
    for tag, expect in EXPECT_TRUNK.items():
        path = gguf_for(model, tag)
        if not path.exists():
            lines.append(f"MISSING {tag} {path}")
            all_ok = False
            continue
        v = load(path)
        v_by = {t["name"]: t for t in v["tensors"]}
        missing = sorted(set(base_by_name) - set(v_by))
        extra = sorted(set(v_by) - set(base_by_name))
        expert_type_mismatch = []
        expert_byte_mismatch = []
        trunk_bad = []
        leftover_k = []
        for name, bt in base_by_name.items():
            vt = v_by.get(name)
            if vt is None:
                continue
            if bt["role"] == "expert":
                if vt["type"] != bt["type"]:
                    expert_type_mismatch.append((name, bt["type"], vt["type"]))
                if vt["nbytes"] != bt["nbytes"]:
                    expert_byte_mismatch.append((name, bt["nbytes"], vt["nbytes"]))
            if bt["role"] == "trunk":
                if vt["type"] != expect:
                    trunk_bad.append((name, vt["type"], expect))
                if vt["type"] in KQUANT:
                    leftover_k.append((name, vt["type"]))
        delta = v["bytes_on_disk"] - base["bytes_on_disk"]
        trunk_delta = v["trunk_bytes"] - base["trunk_bytes"]
        ok = (
            not missing
            and not extra
            and not expert_type_mismatch
            and v["expert_sha256"] == base["expert_sha256"]
            and not trunk_bad
            and not leftover_k
        )
        all_ok = all_ok and ok
        summary = {
            "ok": ok,
            "bytes_on_disk": v["bytes_on_disk"],
            "delta_vs_control": delta,
            "delta_pct": 100.0 * delta / base["bytes_on_disk"],
            "trunk_bytes": v["trunk_bytes"],
            "trunk_share": v["trunk_share"],
            "trunk_delta": trunk_delta,
            "expert_bytes": v["expert_bytes"],
            "expert_sha256": v["expert_sha256"],
            "expert_sha_match": v["expert_sha256"] == base["expert_sha256"],
            "types": v["types"],
            "missing": missing,
            "extra": extra,
            "expert_type_mismatch": expert_type_mismatch,
            "expert_nbytes_mismatch": expert_byte_mismatch,
            "trunk_type_bad": trunk_bad,
            "leftover_kquant_on_trunk": leftover_k,
        }
        variants_out[tag] = summary
        lines += [
            "",
            f"== {tag} ok={ok} ==",
            f"  disk={v['bytes_on_disk']} delta={delta} ({summary['delta_pct']:.3f}%)",
            f"  trunk={v['trunk_bytes']} share={v['trunk_share']:.4f} trunk_delta={trunk_delta}",
            f"  types={v['types']}",
            f"  expert_sha_match={summary['expert_sha_match']}",
        ]
        if not ok:
            lines.append("  FAIL " + json.dumps({k: summary[k] for k in (
                "missing", "extra", "expert_type_mismatch", "trunk_type_bad",
                "leftover_kquant_on_trunk", "expert_sha_match",
            )}))
    report["variants"] = variants_out
    report["all_ok"] = all_ok
    (out_dir / "verify_variants.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    text = "\n".join(lines) + "\n"
    (out_dir / "verify_variants.txt").write_text(text, encoding="utf-8")
    print(text)
    print("all_ok", all_ok)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
