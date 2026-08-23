#!/usr/bin/env python3
"""Dump GGUF tensor map: types, shapes, nbytes, role classification."""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from gguf import GGUFReader

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


def role(name: str) -> str:
    if any(s in name for s in EXPERT_SUBSTR):
        return "expert"
    if name in ("token_embd.weight", "output.weight"):
        return "trunk"
    if any(s in name for s in TRUNK_SUBSTR):
        return "trunk"
    return "other"


def dump(path: Path) -> dict:
    r = GGUFReader(str(path))
    tensors = []
    types = Counter()
    roles = defaultdict(lambda: {"count": 0, "bytes": 0, "types": Counter()})
    for t in r.tensors:
        typ = t.tensor_type.name
        if hasattr(t, "n_bytes"):
            nbytes = int(t.n_bytes)
        else:
            nbytes = int(len(bytes(t.data)))
        rec = {
            "name": t.name,
            "type": typ,
            "shape": [int(x) for x in t.shape],
            "nbytes": nbytes,
            "role": role(t.name),
        }
        tensors.append(rec)
        types[typ] += 1
        roles[rec["role"]]["count"] += 1
        roles[rec["role"]]["bytes"] += nbytes
        roles[rec["role"]]["types"][typ] += 1
    meta = {}
    for k in (
        "general.architecture",
        "general.name",
        "general.file_type",
        "olmoe.expert_count",
        "olmoe.expert_used_count",
        "qwen3moe.expert_count",
        "qwen3moe.expert_used_count",
        "lfm2moe.expert_count",
        "lfm2moe.expert_used_count",
        "llama.expert_count",
        "llama.expert_used_count",
    ):
        try:
            v = r.get_field(k)
            if v is not None:
                meta[k] = str(v)
        except Exception:
            pass
    # also scan fields
    try:
        for field in r.fields.values():
            name = field.name if hasattr(field, "name") else None
            if not name:
                continue
            if any(x in name for x in ("expert", "architecture", "block_count", "embedding_length", "vocab")):
                try:
                    meta[name] = str(field.contents())
                except Exception:
                    pass
    except Exception:
        pass
    role_out = {
        k: {"count": v["count"], "bytes": v["bytes"], "types": dict(v["types"])}
        for k, v in roles.items()
    }
    return {
        "file": str(path),
        "bytes_on_disk": path.stat().st_size,
        "n_tensors": len(tensors),
        "types": dict(types),
        "roles": role_out,
        "meta": meta,
        "tensors": tensors,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: dump_gguf.py IN.gguf OUT.json", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    d = dump(src)
    out.parent.mkdir(parents=True, exist_ok=True)
    slim = {k: v for k, v in d.items() if k != "tensors"}
    out.write_text(json.dumps(d, indent=2), encoding="utf-8")
    txt = out.with_suffix(".txt")
    lines = [
        f"file={d['file']}",
        f"bytes_on_disk={d['bytes_on_disk']}",
        f"n_tensors={d['n_tensors']}",
        f"types={d['types']}",
        f"roles={json.dumps(d['roles'])}",
        f"meta={json.dumps(d['meta'], indent=2)}",
        "",
        "name type shape nbytes role",
    ]
    for t in d["tensors"]:
        lines.append(f"{t['name']}\t{t['type']}\t{t['shape']}\t{t['nbytes']}\t{t['role']}")
    txt.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(slim, indent=2))
    print("wrote", out)
    print("wrote", txt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
