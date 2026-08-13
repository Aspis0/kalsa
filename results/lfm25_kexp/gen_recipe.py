"""Generate LFM2.5 KEXP tensor_types from the Q4_K_M dump."""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent
DUMP = OUT / "tensor_dump.txt"


def assign(name: str) -> str:
    if name in ("token_embd.weight", "output.weight"):
        return "q5_k"
    if name.endswith("exp_probs_b.bias"):
        return "f32"
    if "ffn_gate_inp" in name:
        return "f32"
    if name.endswith("shortconv.conv.weight"):
        return "f32"
    if any(
        s in name
        for s in (
            "attn_norm.weight",
            "attn_q_norm.weight",
            "attn_k_norm.weight",
            "ffn_norm.weight",
            "token_embd_norm.weight",
            "output_norm.weight",
        )
    ):
        return "f32"
    if "ffn_gate_exps" in name or "ffn_up_exps" in name:
        return "q2_k"
    if "ffn_down_exps" in name:
        return "q3_k"
    if name.endswith("ffn_down.weight"):
        return "q6_k"
    if name.endswith("shortconv.out_proj.weight"):
        return "q6_k"
    if name.endswith("shortconv.in_proj.weight"):
        return "q5_k"
    if any(
        s in name
        for s in (
            "attn_q.weight",
            "attn_k.weight",
            "attn_v.weight",
            "attn_output.weight",
            "ffn_gate.weight",
            "ffn_up.weight",
        )
    ):
        return "q5_k"
    return "UNMAPPED"


def main() -> None:
    rows = []
    for line in DUMP.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        name, typ, shape, n_el, n_b = line.split("\t")
        rows.append((name, typ, shape, int(n_el), int(n_b)))

    mapped = [(n, assign(n), typ, shape, nel, nb) for n, typ, shape, nel, nb in rows]
    unmapped = [m for m in mapped if m[1] == "UNMAPPED"]
    if unmapped:
        raise SystemExit(f"UNMAPPED tensors: {unmapped}")

    lines = [
        "# LFM2.5-8B-A1B KEXP tensor_types",
        "# source dump: results/lfm25_kexp/tensor_dump.txt (official Q4_K_M; names identical on F16)",
        "# default llama-quantize type: Q5_K",
        "# KEXP 1c split: routed gate/up -> q2_k ; routed down -> q3_k",
        "# dense/attn/shortconv mixer kept Q5_K/Q6_K ; norms/router/conv F32",
        "# tied embeddings: no output.weight in dump; regex kept as 1c lesson",
        r"^output\.weight$=q5_k",
    ]
    for n, a, *_ in mapped:
        lines.append(f"{n}={a}")
    (OUT / "tensor_types_lfm25.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    by_class: dict[tuple[str, str], list] = defaultdict(list)
    for n, a, typ, shape, nel, nb in mapped:
        key = n.split(".", 2)[2] if n.startswith("blk.") else n
        by_class[(key, a)].append((n, shape, nel))

    order = [
        ("token_embd.weight", "q5_k", "KEXP embd class"),
        ("token_embd_norm.weight", "f32", "norm"),
        ("attn_q.weight", "q5_k", "6 GQA attn layers"),
        ("attn_k.weight", "q5_k", "6 GQA attn layers"),
        ("attn_v.weight", "q5_k", "6 GQA attn layers"),
        ("attn_output.weight", "q5_k", "6 GQA attn layers"),
        ("attn_norm.weight", "f32", "all 24 layers"),
        ("attn_q_norm.weight", "f32", "6 attn layers"),
        ("attn_k_norm.weight", "f32", "6 attn layers"),
        ("shortconv.in_proj.weight", "q5_k", "attn-replacement; NOT in qwen35moe KEXP"),
        ("shortconv.out_proj.weight", "q6_k", "analog of KEXP ssm_out"),
        ("shortconv.conv.weight", "f32", "analog of KEXP ssm_conv1d"),
        ("ffn_gate.weight", "q5_k", "2 leading dense blocks"),
        ("ffn_up.weight", "q5_k", "2 leading dense blocks"),
        ("ffn_down.weight", "q6_k", "2 leading dense blocks (KEXP shexp-down class)"),
        ("ffn_gate_exps.weight", "q2_k", "22 MoE layers, KEXP gate-exps"),
        ("ffn_up_exps.weight", "q2_k", "22 MoE layers, KEXP up-exps"),
        ("ffn_down_exps.weight", "q3_k", "22 MoE layers, KEXP down-exps"),
        ("ffn_gate_inp.weight", "f32", "router"),
        ("exp_probs_b.bias", "f32", "router bias; LFM-specific, not in qwen35moe"),
        ("ffn_norm.weight", "f32", "all 24 layers"),
    ]
    pat = [
        "# LFM2.5-8B-A1B KEXP pattern summary (NOT the file passed to llama-quantize)",
        "# Use tensor_types_lfm25.txt with --tensor-type-file",
        "#",
        "# CLASS                          TYPE    COUNT  NOTES",
    ]
    for key, a, note in order:
        recs = by_class.get((key, a), [])
        pat.append(f"{key:32s} {a:6s} n={len(recs):2d}  {note}")
    pat += [
        "",
        "INAPPLICABLE vs qwen35moe KEXP (do not invent tensors):",
        "  ffn_*_shexp          — no shared expert on lfm2moe",
        "  ffn_gate_inp_shexp   — no shared-expert router",
        "  attn_qkv / attn_gate — unfused Q/K/V; no attn_gate",
        "  ssm_*                — LFM2.5 uses shortconv, not SSM",
        "  output.weight        — tied to token_embd (absent in dump)",
    ]
    (OUT / "tensor_types_patterns.txt").write_text("\n".join(pat) + "\n", encoding="utf-8")

    layer: dict[int, list] = defaultdict(list)
    for n, a, typ, shape, nel, nb in mapped:
        if n.startswith("blk."):
            li = int(n.split(".")[1])
            layer[li].append((n.split(".", 2)[2], a, shape))

    ll = ["# per-layer tensor classes", ""]
    for i in range(24):
        keys = [x[0] for x in layer[i]]
        kind = []
        if any(k.startswith("attn_q.") for k in keys):
            kind.append("ATTN")
        if any(k.startswith("shortconv.") for k in keys):
            kind.append("SHORTCONV")
        if any("_exps" in k for k in keys):
            kind.append("MOE")
        if any(k in ("ffn_gate.weight", "ffn_up.weight", "ffn_down.weight") for k in keys):
            kind.append("DENSE_FFN")
        ll.append(f"blk.{i}: {'+'.join(kind)}")
        for k, a, shape in layer[i]:
            ll.append(f"  {k:32s} {a:6s} {shape}")
        ll.append("")
    (OUT / "layer_map.txt").write_text("\n".join(ll), encoding="utf-8")

    # gguf_header_arch.txt is written separately (do not dump tokenizer).

    cls = Counter(a for _, a, *_ in mapped)
    print("n_tensors", len(mapped))
    print("classes", dict(cls))
    print("recipe_lines", len(lines))


if __name__ == "__main__":
    main()
