#!/usr/bin/env python3
"""Compute exact per-ratio parameter counts and GGUF size estimates for Kalsa.

Reads the real tensor shapes (tensor-shapes.json, built from the 26 safetensors
shard headers of Qwen/Qwen3.6-35B-A3B) and classifies every tensor the way
moep surgery does: expert tensors scale by kept/256, mtp.*/model.visual.* are
dropped, everything else is copied. Prints the markdown table for
docs/PARAM-BUDGET.md and fails if the base sum disagrees with the published
safetensors index total.
"""

import json
import math
import pathlib
import re
import sys

Q8_0_BPW = 8.5 / 8    # 32 params per 34-byte block
Q4_0_BPW = 4.5 / 8    # 32 params per 18-byte block
Q4_K_M_BPW = 4.85 / 8  # llama.cpp k-quant doc value, average over tensors

# Unsloth full-model Q4_K_M measured on 2026-08-03 (reports/moe-f0.1.md)
FULL_Q4_K_M_MEASURED = 22_134_528_992

KEEP_BY_PRUNE_RATIO = {0.0: 256, 0.25: 192, 0.50: 128, 0.65: 90, 0.75: 64}

_EXPERT_RE = re.compile(r"^model\.language_model\.layers\.(\d+)\.mlp\.experts\.")
_ROUTER_RE = re.compile(r"^model\.language_model\.layers\.(\d+)\.mlp\.gate\.weight$")


def classify(shapes: dict) -> dict[str, dict[str, int]]:
    buckets: dict[str, dict[str, int]] = {
        "expert": {}, "router": {}, "dropped_mtp": {}, "dropped_visual": {}, "copied": {},
    }
    for name, shape in shapes.items():
        n = math.prod(shape[:-1])
        if name.startswith("mtp."):
            buckets["dropped_mtp"][name] = n
        elif name.startswith("model.visual."):
            buckets["dropped_visual"][name] = n
        elif _EXPERT_RE.match(name):
            buckets["expert"][name] = n
        elif _ROUTER_RE.match(name):
            buckets["router"][name] = n
        else:
            buckets["copied"][name] = n
    return buckets


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} tensor-shapes.json", file=sys.stderr)
        return 2
    shapes = json.load(open(sys.argv[1]))
    buckets = classify(shapes)

    expert_params = sum(buckets["expert"].values())          # 40 layers x 256 experts
    router_params = sum(buckets["router"].values())
    copied_params = sum(buckets["copied"].values())           # embed, head, attn, GDN, shared expert
    total = sum(sum(b.values()) for b in buckets.values())
    published = json.load(open(pathlib.Path(sys.argv[1]).parent / "model.safetensors.index.json"))
    expected = int(published["metadata"]["total_size"] // 2)
    if total != expected:
        print(f"FAIL: shape sum {total} != index total {expected}", file=sys.stderr)
        return 1

    expert_bytes_bf16 = expert_params * 2
    est_q4km_full = (total * Q4_K_M_BPW)
    scale = FULL_Q4_K_M_MEASURED / est_q4km_full
    print(f"# base text+vision+mtp params: {total:,} (matches safetensors index)")
    print(f"# expert params (40 layers x 256): {expert_params:,} = {expert_bytes_bf16 / 1e9:.2f} GB BF16")
    print(f"# Q4_K_M sanity: estimated {est_q4km_full / 1e9:.2f} GB vs unsloth measured "
          f"{FULL_Q4_K_M_MEASURED / 1e9:.2f} GB -> k-quant overhead factor {scale:.4f}")
    print()
    print("| prune | kept/layer | text params | BF16 GB | Q8_0 GB | Q4_0 GB | Q4_K_M GB (x1.016) |")
    print("|---:|---:|---:|---:|---:|---:|---:|")
    for ratio, kept in KEEP_BY_PRUNE_RATIO.items():
        text_params = copied_params + router_params * kept / 256 + expert_params * kept / 256
        bf16 = text_params * 2
        q8 = text_params * Q8_0_BPW
        q4 = text_params * Q4_0_BPW
        q4km = text_params * Q4_K_M_BPW * scale
        print(f"| {ratio:.0%} | {kept} | {text_params:,.0f} | {bf16 / 1e9:.2f} | "
              f"{q8 / 1e9:.2f} | {q4 / 1e9:.2f} | {q4km / 1e9:.2f} |")
    dropped_mtp = sum(buckets["dropped_mtp"].values())
    dropped_vis = sum(buckets["dropped_visual"].values())
    print(f"\n# dropped from text-only GGUF: mtp.* {dropped_mtp:,} params, "
          f"model.visual.* {dropped_vis:,} params")
    return 0


if __name__ == "__main__":
    sys.exit(main())
