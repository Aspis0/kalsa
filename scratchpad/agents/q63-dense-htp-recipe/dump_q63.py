from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from q63_common import HTP_TYPES, sha256, write_json


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    result = {"label": args.label, "model": str(args.model), "status": "FAILED", "readability": "INVALID", "ppl": None, "ppl_err": None, "chunks": None, "rc": 1, "wall_s": 0.0}
    try:
        if not args.model.exists():
            result["error"] = "candidate missing"
            write_json(args.out, result)
            return 1
        root = Path(__file__).resolve().parents[3]
        sys.path.insert(0, str(root / "BigMoeOnEdge" / "third_party" / "llama.cpp" / "gguf-py"))
        from gguf.gguf_reader import GGUFReader
        reader = GGUFReader(str(args.model), "r")
        tensors = []
        for tensor in reader.tensors:
            tensors.append({"name": tensor.name, "shape": [int(x) for x in tensor.shape], "type": tensor.tensor_type.name, "bytes": int(tensor.n_bytes)})
        counts = Counter(item["type"] for item in tensors)
        unexpected = sorted(set(counts) - HTP_TYPES)
        quantized = [item for item in tensors if item["type"] in HTP_TYPES and len(item["shape"]) >= 2]
        row_ok = all(item["shape"][0] % 32 == 0 for item in quantized)
        result.update({
            "status": "COMPLETE", "rc": 0, "tensor_count": len(tensors), "data_offset": reader.data_offset,
            "alignment": reader.alignment, "model_bytes": args.model.stat().st_size, "sha256": sha256(args.model),
            "type_counts": dict(sorted(counts.items())), "unexpected_types": unexpected,
            "readability": "PASS" if not unexpected else "INVALID", "htp_types": sorted(HTP_TYPES),
            "shape_predicates": {"quantized_matrix_ne0_mod_32": row_ok, "quantized_matrix_count": len(quantized)},
            "tensors": tensors,
        })
        write_json(args.out, result)
        return 0 if not unexpected else 1
    except Exception as exc:
        result["error"] = repr(exc)
        write_json(args.out, result)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
