#!/usr/bin/env python3
"""Verify trunk-requant variants vs Marco KEXP baseline.

Writes verify_variants.json + verify_variants.txt under this directory.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from gguf import GGUFReader

ROOT = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
HERE = ROOT / "scratchpad" / "agents" / "q36-trunk-requant"
BASE = ROOT / "models" / "Marco-Mini-Instruct-KEXP.gguf"
VARIANTS = {
    "q8_0": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-q8_0.gguf",
    "iq4_nl": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-iq4_nl.gguf",
    "q4_0": HERE / "gguf" / "Marco-Mini-Instruct-KEXP-trunk-q4_0.gguf",
}
EXPECT_TRUNK = {"q8_0": "Q8_0", "iq4_nl": "IQ4_NL", "q4_0": "Q4_0"}
EXPERT_SUBSTR = ("ffn_gate_exps", "ffn_up_exps", "ffn_down_exps")
TRUNK_SUBSTR = ("attn_q.weight", "attn_k.weight", "attn_v.weight", "attn_output.weight")


def is_expert(name: str) -> bool:
    return any(s in name for s in EXPERT_SUBSTR)


def is_trunk_weight(name: str) -> bool:
    if name == "token_embd.weight" or name == "output.weight":
        return True
    return any(s in name for s in TRUNK_SUBSTR)


def load(path: Path) -> dict:
    r = GGUFReader(str(path))
    tensors = []
    types = Counter()
    expert_hash = hashlib.sha256()
    trunk_bytes = 0
    expert_bytes = 0
    for t in r.tensors:
        typ = t.tensor_type.name
        types[typ] += 1
        data = bytes(t.data)
        nbytes = len(data)
        rec = {"name": t.name, "type": typ, "shape": [int(x) for x in t.shape], "nbytes": nbytes}
        if is_expert(t.name):
            expert_hash.update(t.name.encode("utf-8"))
            expert_hash.update(data)
            expert_bytes += nbytes
            rec["role"] = "expert"
        elif is_trunk_weight(t.name):
            trunk_bytes += nbytes
            rec["role"] = "trunk"
        else:
            rec["role"] = "other"
        tensors.append(rec)
    return {
        "path": str(path),
        "bytes_on_disk": path.stat().st_size,
        "n_tensors": len(tensors),
        "types": dict(types),
        "trunk_bytes": trunk_bytes,
        "expert_bytes": expert_bytes,
        "expert_sha256": expert_hash.hexdigest(),
        "tensors": tensors,
    }


def main() -> int:
    base = load(BASE)
    report = {"baseline": {k: v for k, v in base.items() if k != "tensors"}}
    base_by_name = {t["name"]: t for t in base["tensors"]}
    lines = []
    lines.append(f"baseline bytes={base['bytes_on_disk']} types={base['types']}")
    lines.append(f"baseline trunk_bytes={base['trunk_bytes']} expert_bytes={base['expert_bytes']}")
    lines.append(f"baseline expert_sha256={base['expert_sha256']}")
    all_ok = True
    variants_out = {}
    for tag, path in VARIANTS.items():
        v = load(path)
        expect = EXPECT_TRUNK[tag]
        v_by = {t["name"]: t for t in v["tensors"]}
        missing = sorted(set(base_by_name) - set(v_by))
        extra = sorted(set(v_by) - set(base_by_name))
        expert_type_mismatch = []
        expert_byte_mismatch = []
        trunk_bad = []
        leftover_q5 = []
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
            if bt["role"] == "trunk" and vt["type"] == "Q5_K":
                leftover_q5.append(name)
        # leftover Q5_K anywhere in weights that should have changed
        q5_left = [t["name"] for t in v["tensors"] if t["type"] == "Q5_K"]
        delta = v["bytes_on_disk"] - base["bytes_on_disk"]
        trunk_delta = v["trunk_bytes"] - base["trunk_bytes"]
        ok = (
            not missing
            and not extra
            and not expert_type_mismatch
            and v["expert_sha256"] == base["expert_sha256"]
            and not trunk_bad
            and not q5_left
        )
        all_ok = all_ok and ok
        summary = {
            "ok": ok,
            "bytes_on_disk": v["bytes_on_disk"],
            "delta_vs_baseline": delta,
            "delta_pct": 100.0 * delta / base["bytes_on_disk"],
            "trunk_bytes": v["trunk_bytes"],
            "trunk_delta": trunk_delta,
            "trunk_delta_pct_of_baseline_total": 100.0 * trunk_delta / base["bytes_on_disk"],
            "expert_bytes": v["expert_bytes"],
            "expert_sha256": v["expert_sha256"],
            "expert_sha_match": v["expert_sha256"] == base["expert_sha256"],
            "types": v["types"],
            "missing": missing,
            "extra": extra,
            "expert_type_mismatch": expert_type_mismatch,
            "expert_nbytes_mismatch": expert_byte_mismatch,
            "trunk_type_bad": trunk_bad,
            "q5_k_remaining": q5_left,
        }
        variants_out[tag] = summary
        lines.append("")
        lines.append(f"== {tag} ok={ok} ==")
        lines.append(f"  disk={v['bytes_on_disk']} delta={delta} ({summary['delta_pct']:.3f}%)")
        lines.append(f"  trunk={v['trunk_bytes']} trunk_delta={trunk_delta}")
        lines.append(f"  types={v['types']}")
        lines.append(f"  expert_sha_match={summary['expert_sha_match']}")
        if not ok:
            lines.append(f"  FAIL details={json.dumps({k: summary[k] for k in ('missing','extra','expert_type_mismatch','trunk_type_bad','q5_k_remaining')})}")
    report["variants"] = variants_out
    report["all_ok"] = all_ok
    (HERE / "verify_variants.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    text = "\n".join(lines) + "\n"
    (HERE / "verify_variants.txt").write_text(text, encoding="utf-8")
    print(text)
    print("all_ok", all_ok)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
