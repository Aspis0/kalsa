"""Fail if LFM2.5-KEXP GGUF tensor types do not match the recipe."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from gguf import GGUFReader

ROOT = Path(__file__).resolve().parent
RECIPE = ROOT / "tensor_types_lfm25.txt"


def recipe_map() -> dict[str, str]:
    out = {}
    for line in RECIPE.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or line.startswith("^"):
            continue
        name, typ = line.split("=", 1)
        out[name] = typ.lower()
    return out


def ggml_name(t) -> str:
    # gguf lib may expose tensor_type as the enum OR as a raw int, depending on version
    tt = t.tensor_type
    try:
        from gguf.constants import GGMLQuantizationType
        nm = GGMLQuantizationType(int(tt)).name
    except (ValueError, TypeError, ImportError):
        nm = str(tt).split(".")[-1]
    return nm.lower().replace("q3_k_m", "q3_k").replace("q4_k_m", "q4_k")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: verify_kexp.py <gguf>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    want = recipe_map()
    r = GGUFReader(str(path))
    mismatches = []
    counts = Counter()
    for t in r.tensors:
        got = ggml_name(t)
        counts[got] += 1
        exp = want.get(t.name)
        if exp is None:
            mismatches.append((t.name, "UNLISTED", got))
            continue
        if got != exp and not (exp == "q3_k" and got in ("q3_k", "q3_k_m")):
            if not (exp == got):
                mismatches.append((t.name, exp, got))
    report = {
        "path": str(path),
        "n_tensors": len(r.tensors),
        "types": dict(counts),
        "n_mismatch": len(mismatches),
        "mismatches": mismatches[:40],
        "gate_exps": dict(Counter(ggml_name(t) for t in r.tensors if "ffn_gate_exps" in t.name)),
        "up_exps": dict(Counter(ggml_name(t) for t in r.tensors if "ffn_up_exps" in t.name)),
        "down_exps": dict(Counter(ggml_name(t) for t in r.tensors if "ffn_down_exps" in t.name)),
        "iq_count": sum(1 for k in counts if k.startswith("iq")),
    }
    outp = ROOT / "QUANTIZE_VERIFY.json"
    outp.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if mismatches:
        print(f"FAIL {len(mismatches)} type mismatches", file=sys.stderr)
        return 1
    if report["gate_exps"] != {"q2_k": 22} or report["up_exps"] != {"q2_k": 22}:
        print("FAIL expert gate/up not 22x q2_k", file=sys.stderr)
        return 1
    if report["down_exps"] != {"q3_k": 22} and report["down_exps"] != {"q3_k_m": 22}:
        print(f"FAIL expert down not 22x q3_k: {report['down_exps']}", file=sys.stderr)
        return 1
    if report["iq_count"]:
        print("FAIL IQ tensors present", file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
