#!/usr/bin/env python3
"""q48: tensor-type table, sha256, expert geometry for the OLMoE all-Q4_0 gguf."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from gguf import GGUFReader

HERE = Path(__file__).parent
GGUF = HERE / "gguf" / "OLMoE-1B-7B-0924-Instruct-Q4_0.gguf"
HTP_TYPES = {"Q4_0", "Q4_1", "Q8_0", "IQ4_NL", "MXFP4"}

def main() -> int:
    h = hashlib.sha256()
    with GGUF.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    sha = h.hexdigest()
    size = GGUF.stat().st_size

    r = GGUFReader(str(GGUF))
    kv = {}
    for k in ("olmoe.expert_count", "olmoe.expert_used_count", "olmoe.block_count"):
        try:
            f = r.get_field(k)
            kv[k] = int(f.parts[f.data[0]][0]) if f else None
        except Exception:
            kv[k] = None

    types = Counter()
    non_q40 = []
    experts = []
    expert_bytes = 0
    for t in r.tensors:
        typ = t.tensor_type.name
        types[typ] += 1
        nb = int(t.n_bytes)
        if "_exps" in t.name:
            experts.append({"name": t.name, "type": typ, "ne": [int(x) for x in t.shape], "nbytes": nb})
            expert_bytes += nb
        if typ not in ("F32",) and typ != "Q4_0":
            non_q40.append((t.name, typ))

    out = {
        "file": str(GGUF), "bytes": size, "sha256": sha,
        "kv": kv, "types": dict(types),
        "non_q40_non_f32": non_q40,
        "n_expert_tensors": len(experts),
        "expert_bytes_total": expert_bytes,
        "expert_examples": experts[:3],
        "expert_types": sorted({e["type"] for e in experts}),
        "experts_htp_type_ok": all(e["type"] in HTP_TYPES for e in experts),
        "experts_ne1_le_32768": all(e["ne"][1] <= 32768 for e in experts),
    }
    (HERE / "analysis.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
