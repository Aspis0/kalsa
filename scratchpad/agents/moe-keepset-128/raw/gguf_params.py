#!/usr/bin/env python3
"""Parameter counts and approximate model sizes for pruned-expert budgets.

Tensor shapes are read from the GGUF itself with gguf-py (llama.cpp tooling); nothing is
guessed. Routed-expert weights are the *_exps tensors (256 experts per layer, kept or
dropped together per the keep-set); everything else - shared expert, router, attention,
ssm, embeddings - is unaffected by expert pruning. GB figures are ESTIMATES: file bytes =
params * bpw / 8 at fixed average bit widths; real Q4_K_M/Q3_K_M/IQ3_S files mix block
formats and carry metadata, so they only approximate."""

import os
import sys

import numpy as np

sys.path.insert(0, "/tmp/razor-italian-loss/kalsallama/gguf-py")
from gguf import GGUFReader  # noqa: E402

import k128_common as k  # noqa: E402

GGUF_PATH = os.path.expanduser(
    "~/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf")
BUDGETS = [5120, 6400, 7680, 8960]  # 128/160/192/224 per layer x 40
BPW = {"gb_q4_k_m": 4.85, "gb_q3_k_m": 3.9, "gb_iq3_s": 3.44}


def main():
    reader = GGUFReader(GGUF_PATH)
    expert_elems = other_elems = 0
    n_layer = n_exp = None
    for t in reader.tensors:
        elems = int(np.prod(t.shape))
        if t.name.endswith("_exps.weight"):
            expert_elems += elems
            n_exp = int(t.shape[-1])  # GGUF dim order: expert count is last
            if t.name.endswith("ffn_gate_exps.weight"):
                n_layer = (n_layer or 0) + 1
        else:
            other_elems += elems
    if n_layer != 40 or n_exp != 256:
        raise SystemExit(f"expected 40x256 routed experts, saw {n_layer}x{n_exp}")
    total = expert_elems + other_elems
    print(f"non-expert params      : {other_elems:,}")
    print(f"routed-expert params   : {expert_elems:,} "
          f"({expert_elems // (n_layer * n_exp):,} per expert)")
    print(f"total params (256 exp) : {total:,}")
    file_bytes = os.path.getsize(GGUF_PATH)
    print(f"GGUF file size         : {file_bytes:,} bytes "
          f"(implied {file_bytes * 8 / total:.2f} bpw average incl. metadata)")
    with open(f"{k.OUT_DIR}/model_sizes.csv", "w") as f:
        f.write("experts_kept,approx_params_B,gb_q4_k_m,gb_q3_k_m,gb_iq3_s\n")
        for kept in BUDGETS:
            params = other_elems + expert_elems * kept / (n_layer * n_exp)
            f.write(f"{kept},{params / 1e9:.3f},"
                    + ",".join(f"{params * b / 8 / 1e9:.2f}" for b in BPW.values()) + "\n")
            print(f"kept={kept:5d}: {params / 1e9:.3f} B params -> "
                  + ", ".join(f"{name}~{params * b / 8 / 1e9:.2f} GB"
                              for name, b in BPW.items()) + " (estimates)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
