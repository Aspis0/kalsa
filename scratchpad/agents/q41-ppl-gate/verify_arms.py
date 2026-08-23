#!/usr/bin/env python3
"""Verify IQ4_NL / Q4_0 vs kept control: expert sha identical, trunk types."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from gguf import GGUFReader

Q37 = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q37-bprime-from-source")
HERE = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q41-ppl-gate")
PREFIX = "Marco-Mini-Instruct-KEXP-fromsrc"
EXPECT = {"iq4_nl": "IQ4_NL", "q4_0": "Q4_0"}
EXPERT_SUBSTR = ("ffn_gate_exps", "ffn_up_exps", "ffn_down_exps")
TRUNK_SUBSTR = (
    "attn_q.weight", "attn_k.weight", "attn_v.weight", "attn_output.weight",
)


def role(name: str) -> str:
    if any(s in name for s in EXPERT_SUBSTR):
        return "expert"
    if name in ("token_embd.weight", "output.weight"):
        return "trunk"
    if any(s in name for s in TRUNK_SUBSTR):
        return "trunk"
    return "other"


def load(path: Path) -> dict:
    r = GGUFReader(str(path))
    expert_hash = hashlib.sha256()
    types = Counter()
    trunk_bytes = expert_bytes = 0
    tensors = []
    for t in r.tensors:
        typ = t.tensor_type.name
        types[typ] += 1
        data = bytes(t.data)
        rec = {"name": t.name, "type": typ, "nbytes": len(data), "role": role(t.name)}
        if rec["role"] == "expert":
            expert_hash.update(t.name.encode("utf-8"))
            expert_hash.update(data)
            expert_bytes += rec["nbytes"]
        elif rec["role"] == "trunk":
            trunk_bytes += rec["nbytes"]
        tensors.append(rec)
    return {
        "path": str(path),
        "bytes_on_disk": path.stat().st_size,
        "types": dict(types),
        "trunk_bytes": trunk_bytes,
        "expert_bytes": expert_bytes,
        "expert_sha256": expert_hash.hexdigest(),
        "tensors": tensors,
    }


def gguf(arm: str) -> Path:
    return Q37 / "gguf" / "marco" / f"{PREFIX}-trunk-{arm}.gguf"


def main() -> int:
    arms = sys.argv[1:] or list(EXPECT)
    base = load(gguf("control"))
    report = {"control": {k: v for k, v in base.items() if k != "tensors"}}
    base_by = {t["name"]: t for t in base["tensors"]}
    lines = [
        f"control bytes={base['bytes_on_disk']} types={base['types']}",
        f"control trunk={base['trunk_bytes']} expert={base['expert_bytes']}",
        f"control expert_sha256={base['expert_sha256']}",
    ]
    all_ok = True
    variants = {}
    for tag in arms:
        path = gguf(tag)
        v = load(path)
        expect = EXPECT[tag]
        v_by = {t["name"]: t for t in v["tensors"]}
        trunk_bad = [
            (n, v_by[n]["type"], expect)
            for n, bt in base_by.items()
            if bt["role"] == "trunk" and v_by.get(n) and v_by[n]["type"] != expect
        ]
        ok = (
            v["expert_sha256"] == base["expert_sha256"]
            and not trunk_bad
            and set(base_by) == set(v_by)
        )
        all_ok = all_ok and ok
        rec = {
            "ok": ok,
            "bytes_on_disk": v["bytes_on_disk"],
            "delta": v["bytes_on_disk"] - base["bytes_on_disk"],
            "delta_pct": 100.0 * (v["bytes_on_disk"] - base["bytes_on_disk"]) / base["bytes_on_disk"],
            "trunk_bytes": v["trunk_bytes"],
            "types": v["types"],
            "expert_sha_match": v["expert_sha256"] == base["expert_sha256"],
            "expert_sha256": v["expert_sha256"],
            "trunk_type_bad": trunk_bad,
        }
        variants[tag] = rec
        lines += [
            "",
            f"== {tag} ok={ok} ==",
            f"  disk={v['bytes_on_disk']} delta={rec['delta']} ({rec['delta_pct']:.3f}%)",
            f"  types={v['types']} expert_sha_match={rec['expert_sha_match']}",
        ]
    report["variants"] = variants
    report["all_ok"] = all_ok
    HERE.mkdir(parents=True, exist_ok=True)
    (HERE / "verify_arms.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (HERE / "verify_arms.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print("all_ok", all_ok)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
