#!/usr/bin/env python3
"""Simulate ggml_nbytes after q23k init_tensor nb[2] mutation vs native/packed."""
from __future__ import annotations

import json
import sys
from pathlib import Path

QK_K = 256
Q2_TYPE = 84
Q3_TYPE = 110
Q2_TILE = 672
Q3_TILE = 912


def align64(n: int) -> int:
    return (n + 63) & ~63


def native_slice(ne0: int, ne1: int, type_size: int) -> int:
    nblocks = ne0 // QK_K
    return ne1 * nblocks * type_size


def packed_stride(ne0: int, ne1: int, tile: int) -> int:
    n_tiles = (ne1 // 8) * (ne0 // QK_K)
    return align64(n_tiles * tile)


def ggml_nbytes_hybrid(ne, nb0, nb1, nb2, nb3, blck: int) -> int:
    # ggml.c:1289 quantized branch
    ne0, ne1, ne2, ne3 = ne
    nbytes = ne0 * nb0 // blck
    nbytes += (ne1 - 1) * nb1
    nbytes += (ne2 - 1) * nb2
    nbytes += (ne3 - 1) * nb3
    return nbytes


def analyze(name: str, typ: str, ne0: int, ne1: int, ne2: int) -> dict:
    type_size = Q2_TYPE if typ == "Q2_K" else Q3_TYPE
    tile = Q2_TILE if typ == "Q2_K" else Q3_TILE
    ne = (ne0, ne1, ne2, 1)
    nblocks = ne0 // QK_K
    nb0 = type_size
    nb1 = type_size * nblocks
    native_nb2 = nb1 * ne1
    ns = native_slice(ne0, ne1, type_size)
    stride = packed_stride(ne0, ne1, tile)
    native_total = ns * ne2
    packed_total = stride * ne2
    # after init_tensor: nb[2]=stride, nb[0]/nb[1]/nb[3] native
    hybrid = ggml_nbytes_hybrid(ne, nb0, nb1, stride, native_nb2 * ne2, QK_K)
    native_from_formula = ggml_nbytes_hybrid(ne, nb0, nb1, native_nb2, native_nb2 * ne2, QK_K)
    return {
        "name": name,
        "type": typ,
        "ne": list(ne),
        "nblocks": nblocks,
        "native_slice": ns,
        "native_slice_mod64": ns % 64,
        "packed_payload_mod64": (n_tiles_payload(ne0, ne1, tile) % 64),
        "packed_stride": stride,
        "pad_per_slice": stride - (n_tiles_payload(ne0, ne1, tile)),
        "native_total": native_total,
        "packed_total": packed_total,
        "hybrid_nbytes_after_init": hybrid,
        "ggml_nbytes_before_init": native_from_formula,
        "loader_size_eq_native": hybrid == native_total,
        "set_tensor_would_abort": hybrid != native_total,
        "bounds_native_le_hybrid": native_total <= hybrid,
        "delta_hybrid_minus_native": hybrid - native_total,
    }


def n_tiles_payload(ne0: int, ne1: int, tile: int) -> int:
    return (ne1 // 8) * (ne0 // QK_K) * tile


def main() -> int:
    cases = [
        analyze("padded_q2_3d_m2pin", "Q2_K", 256, 8, 3),
        analyze("2d_q2", "Q2_K", 256, 8, 1),
        analyze("lfm_gate_q2", "Q2_K", 2048, 1792, 32),
        analyze("lfm_down_q3", "Q3_K", 1792, 2048, 32),
        analyze("marco_gate_q2", "Q2_K", 1024, 768, 256),
        analyze("marco_down_q3", "Q3_K", 768, 1024, 256),
    ]
    gguf = Path(
        r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents"
        r"\q37-bprime-from-source\gguf\lfm\LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf"
    )
    gguf_info = {"path": str(gguf), "exists": gguf.is_file()}
    if gguf.is_file():
        from gguf import GGUFReader

        r = GGUFReader(str(gguf))
        want = (
            "blk.2.ffn_gate_exps.weight",
            "blk.2.ffn_up_exps.weight",
            "blk.2.ffn_down_exps.weight",
        )
        found = []
        for t in r.tensors:
            if t.name in want:
                if hasattr(t, "n_bytes"):
                    nbytes = int(t.n_bytes)
                else:
                    nbytes = int(t.data.nbytes)
                found.append(
                    {
                        "name": t.name,
                        "type": t.tensor_type.name,
                        "shape": [int(x) for x in t.shape],
                        "nbytes": nbytes,
                    }
                )
        gguf_info["tensors"] = found
        gguf_info["size_bytes"] = gguf.stat().st_size

    out = {"cases": cases, "gguf": gguf_info}
    dest = Path(__file__).with_name("NBYTES_MATH.json")
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
