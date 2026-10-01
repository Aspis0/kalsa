#!/usr/bin/env python3
"""Build a tiny synthetic checkpoint shaped exactly like a moep-pruned export.

Moep surgery never instantiates the model: it copies the BASE checkpoint's
safetensors shard-by-shard, index-selecting expert/router tensors and dropping
mtp.*. Its output therefore keeps the fused Hub layout —
model.language_model.layers.N.mlp.experts.gate_up_proj [E, 2I, H],
...down_proj [E, H, I], mlp.gate.weight [E, H], model.visual.* verbatim —
with a config whose text_config has mtp_num_hidden_layers=0 and
num_experts=kept. transformers' own save_pretrained does NOT produce that
layout (it re-serializes per-expert), so this script writes the tensors
directly, at doll-house scale consistent with the small config it emits.

Usage: make_synth_checkpoint.py <out_dir> [num_experts=128]
"""

import json
import pathlib
import shutil
import sys

import torch
from safetensors.torch import save_file

META = pathlib.Path.home() / "kalsa-models/reap-calib/qwen36-meta"

H, I, V = 64, 16, 248320          # text hidden, expert intermediate, real vocab
NK, NV, HK = 2, 4, 8              # linear-attn key heads, value heads, head dim
NH, NKV, HD = 4, 2, 16            # full-attn heads, kv heads, head dim
KEY_DIM, VAL_DIM = NK * HK, NV * HK
VIS, VIS_I = 32, 64               # vision hidden, vision intermediate

TEXT = {
    "hidden_size": H, "num_hidden_layers": 2, "moe_intermediate_size": I,
    "shared_expert_intermediate_size": I, "num_attention_heads": NH,
    "num_key_value_heads": NKV, "head_dim": HD, "vocab_size": V,
    "num_experts": 128, "num_experts_per_tok": 2, "mtp_num_hidden_layers": 0,
    "layer_types": ["linear_attention", "full_attention"],
    "linear_num_key_heads": NK, "linear_num_value_heads": NV,
    "linear_key_head_dim": HK, "linear_value_head_dim": HK,
    "linear_conv_kernel_dim": 4, "full_attention_interval": 1,
    "rms_norm_eps": 1e-6, "hidden_act": "silu", "max_position_embeddings": 512,
    "attention_bias": False, "attn_output_gate": True,
    "partial_rotary_factor": 0.25, "rope_theta": 1000000.0,
    "rope_parameters": {"rope_type": "default", "partial_rotary_factor": 0.25,
                        "mrope_interleaved": True, "mrope_section": [1, 1, 2]},
}
VISION = {
    "depth": 1, "hidden_size": VIS, "intermediate_size": VIS_I, "num_heads": 2,
    "num_position_embeddings": 8, "patch_size": 4, "spatial_merge_size": 1,
    "temporal_patch_size": 1, "out_hidden_size": H, "in_channels": 3,
    "hidden_act": "gelu_pytorch_tanh", "deepstack_visual_indexes": [],
}


def r(*shape):
    return torch.randn(*shape, dtype=torch.float32).bfloat16() if len(shape) > 1 \
        else torch.ones(*shape, dtype=torch.bfloat16)


def tensors(num_experts: int) -> dict:
    E = num_experts
    t = {
        "model.language_model.embed_tokens.weight": r(V, H),
        "model.language_model.norm.weight": r(H),
        "lm_head.weight": r(V, H),
    }
    for n in range(2):
        p = f"model.language_model.layers.{n}"
        t[f"{p}.input_layernorm.weight"] = r(H)
        t[f"{p}.post_attention_layernorm.weight"] = r(H)
        if n == 0:  # linear attention layer (real mix is 3:1; one of each here)
            qkv = 2 * KEY_DIM + VAL_DIM
            t[f"{p}.linear_attn.in_proj_qkv.weight"] = r(qkv, H)
            t[f"{p}.linear_attn.in_proj_z.weight"] = r(VAL_DIM, H)
            t[f"{p}.linear_attn.in_proj_a.weight"] = r(NV, H)
            t[f"{p}.linear_attn.in_proj_b.weight"] = r(NV, H)
            t[f"{p}.linear_attn.conv1d.weight"] = r(qkv, 1, 4)
            t[f"{p}.linear_attn.dt_bias"] = r(NV)
            t[f"{p}.linear_attn.A_log"] = r(NV)
            t[f"{p}.linear_attn.norm.weight"] = r(HK)
            t[f"{p}.linear_attn.out_proj.weight"] = r(H, VAL_DIM)
        else:       # full attention layer
            t[f"{p}.self_attn.q_proj.weight"] = r(NH * HD * 2, H)   # gated (x2)
            t[f"{p}.self_attn.k_proj.weight"] = r(NKV * HD, H)
            t[f"{p}.self_attn.v_proj.weight"] = r(NKV * HD, H)
            t[f"{p}.self_attn.o_proj.weight"] = r(H, NH * HD)
            t[f"{p}.self_attn.q_norm.weight"] = r(HD)
            t[f"{p}.self_attn.k_norm.weight"] = r(HD)
        t[f"{p}.mlp.gate.weight"] = r(E, H)
        t[f"{p}.mlp.experts.gate_up_proj"] = r(E, 2 * I, H)   # fused, Hub layout
        t[f"{p}.mlp.experts.down_proj"] = r(E, H, I)
        t[f"{p}.mlp.shared_expert.gate_proj.weight"] = r(I, H)
        t[f"{p}.mlp.shared_expert.up_proj.weight"] = r(I, H)
        t[f"{p}.mlp.shared_expert.down_proj.weight"] = r(H, I)
        t[f"{p}.mlp.shared_expert_gate.weight"] = r(1, H)
    v = "model.visual"
    # shapes mirror the real checkpoint (tensor-shapes.json) and transformers'
    # Qwen3_5MoeVisionPatchMerger: norm over vision hidden, fc1 hidden->hidden
    # (spatial_merge_size=1), fc2 vision hidden -> text hidden; conv kernel is
    # [out, in_channels, temporal_patch, patch, patch]
    t[f"{v}.patch_embed.proj.weight"] = r(VIS, 3, 1, 4, 4)
    t[f"{v}.patch_embed.proj.bias"] = r(VIS)
    t[f"{v}.pos_embed.weight"] = r(8, VIS)
    t[f"{v}.blocks.0.norm1.weight"] = r(VIS)
    t[f"{v}.blocks.0.norm1.bias"] = r(VIS)
    t[f"{v}.blocks.0.norm2.weight"] = r(VIS)
    t[f"{v}.blocks.0.norm2.bias"] = r(VIS)
    t[f"{v}.blocks.0.attn.qkv.weight"] = r(3 * VIS, VIS)
    t[f"{v}.blocks.0.attn.qkv.bias"] = r(3 * VIS)
    t[f"{v}.blocks.0.attn.proj.weight"] = r(VIS, VIS)
    t[f"{v}.blocks.0.attn.proj.bias"] = r(VIS)
    t[f"{v}.blocks.0.mlp.linear_fc1.weight"] = r(VIS_I, VIS)
    t[f"{v}.blocks.0.mlp.linear_fc1.bias"] = r(VIS_I)
    t[f"{v}.blocks.0.mlp.linear_fc2.weight"] = r(VIS, VIS_I)
    t[f"{v}.blocks.0.mlp.linear_fc2.bias"] = r(VIS)
    t[f"{v}.merger.norm.weight"] = r(VIS)
    t[f"{v}.merger.norm.bias"] = r(VIS)
    t[f"{v}.merger.linear_fc1.weight"] = r(VIS, VIS)
    t[f"{v}.merger.linear_fc1.bias"] = r(VIS)
    t[f"{v}.merger.linear_fc2.weight"] = r(H, VIS)
    t[f"{v}.merger.linear_fc2.bias"] = r(H)
    return t


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = pathlib.Path(sys.argv[1])
    E = int(sys.argv[2]) if len(sys.argv) > 2 else 128
    out.mkdir(parents=True, exist_ok=True)

    cfg = {
        "architectures": ["Qwen3_5MoeForConditionalGeneration"],
        "model_type": "qwen3_5_moe",
        "image_token_id": 248056, "video_token_id": 248057,
        "vision_start_token_id": 248053, "vision_end_token_id": 248054,
        "bos_token_id": 248044, "eos_token_id": 248044,
        "tie_word_embeddings": False,
        "text_config": dict(TEXT, num_experts=E),
        "vision_config": VISION,
    }
    (out / "config.json").write_text(json.dumps(cfg, indent=2))
    t = tensors(E)
    assert not any(n.startswith("mtp.") for n in t)
    save_file(t, str(out / "model-00001-of-00001.safetensors"))
    (out / "model.safetensors.index.json").write_text(json.dumps({
        "metadata": {"total_size": sum(v.numel() * 2 for v in t.values())},
        "weight_map": {n: "model-00001-of-00001.safetensors" for n in t},
    }))
    for aux in ("tokenizer.json", "tokenizer_config.json", "vocab.json",
                "merges.txt", "generation_config.json"):
        shutil.copy(META / aux, out / aux)

    print(f"synth moep-style pruned dir: {out}")
    print(f"  tensors={len(t)} mtp_tensors=0 experts/layer={E}")
    print(f"  sample: model.language_model.layers.0.mlp.experts.gate_up_proj "
          f"{tuple(t['model.language_model.layers.0.mlp.experts.gate_up_proj'].shape)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
