#!/usr/bin/env python3
"""
F0.6 — Analisi GGUF Qwen3.6-35B-A3B UD-IQ2_M via GGUFReader (gguf pip).
Sostituisce le stime [S] di PLAN.md §5 con numeri misurati [V].

Uso:
  .venv/Scripts/python analysis/gguf_dump_analyze.py \\
      models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf \\
      > results/gguf_ud-iq2m_dump.txt
"""

from __future__ import annotations

import os
import re
import sys
from collections import defaultdict
from pathlib import Path

from gguf import GGUFReader


# Chiavi metadata di interesse per architettura MoE
META_KEYS = [
    "general.architecture",
    "general.name",
    "general.file_type",
    "general.quantization_version",
    "general.size_label",
    "general.basename",
    "general.finetune",
    "general.type",
]


def _field_value(reader: GGUFReader, key: str):
    """Estrae il valore di un campo GGUF via contents() (API ufficiale)."""
    field = reader.get_field(key)
    if field is None:
        return None
    try:
        return field.contents()
    except Exception as exc:  # noqa: BLE001
        return f"<err:{exc}>"


def _arch_keys(arch: str) -> list[str]:
    """Chiavi tipiche per architettura (es. qwen3moe / qwen3_5_moe / qwen35moe)."""
    prefixes = [arch] if arch else []
    # Fallback comuni per questa famiglia
    for p in ("qwen3moe", "qwen3_5_moe", "qwen35moe", "qwen3", "llama"):
        if p not in prefixes:
            prefixes.append(p)
    keys = []
    for p in prefixes:
        keys.extend(
            [
                f"{p}.block_count",
                f"{p}.context_length",
                f"{p}.embedding_length",
                f"{p}.feed_forward_length",
                f"{p}.expert_count",
                f"{p}.expert_used_count",
                f"{p}.expert_feed_forward_length",
                f"{p}.expert_shared_count",
                f"{p}.expert_weights_scale",
                f"{p}.attention.head_count",
                f"{p}.attention.head_count_kv",
                f"{p}.attention.key_length",
                f"{p}.attention.value_length",
                f"{p}.rope.dimension_count",
                f"{p}.ssm.conv_kernel",
                f"{p}.ssm.inner_size",
                f"{p}.ssm.state_size",
                f"{p}.ssm.time_step_rank",
                f"{p}.ssm.group_count",
            ]
        )
    return keys


def fmt_bytes(n: int) -> str:
    if n >= 1 << 30:
        return f"{n} ({n / (1 << 30):.4f} GiB / {n / 1e9:.4f} GB)"
    if n >= 1 << 20:
        return f"{n} ({n / (1 << 20):.4f} MiB / {n / 1e6:.4f} MB)"
    if n >= 1 << 10:
        return f"{n} ({n / (1 << 10):.4f} KiB)"
    return str(n)


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: gguf_dump_analyze.py <path.gguf>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"File non trovato: {path}", file=sys.stderr)
        return 1

    file_size = os.path.getsize(path)
    print("=" * 78)
    print("F0.6 — GGUF dump + analisi esperti — 2026-08-03")
    print(f"File: {path}")
    print(f"Size su disco: {fmt_bytes(file_size)}")
    print(f"Atteso UD-IQ2_M: 11522702304 bytes — match={file_size == 11522702304}")
    print("=" * 78)

    # mode='r' = memmap read-only; non carica i pesi in RAM come array Python
    reader = GGUFReader(str(path), mode="r")

    # --- Metadata ---
    print("\n## 1. Metadata (chiavi architettura / MoE)\n")
    arch = _field_value(reader, "general.architecture")
    print(f"general.architecture = {arch!r}")

    all_interesting = META_KEYS + _arch_keys(str(arch) if arch else "")
    # Aggiungi anche qualunque chiave che contenga 'expert' / 'block' / 'embed'
    for k in reader.fields:
        kl = k.lower()
        if any(s in kl for s in ("expert", "block_count", "embed", "feed_forward", "ssm", "attention", "moe")):
            if k not in all_interesting:
                all_interesting.append(k)

    seen = set()
    for k in all_interesting:
        if k in seen:
            continue
        seen.add(k)
        v = _field_value(reader, k)
        if v is not None:
            print(f"  {k} = {v!r}")

    # Estrai parametri chiave per i calcoli
    def get_int(key: str, default=None):
        v = _field_value(reader, key)
        if v is None:
            return default
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    # Prova le varianti di prefisso
    n_layer = n_expert = n_expert_used = hidden = moe_ff = None
    for p in (str(arch) if arch else "", "qwen3moe", "qwen3_5_moe", "qwen35moe", "qwen3"):
        if not p:
            continue
        n_layer = n_layer or get_int(f"{p}.block_count")
        n_expert = n_expert or get_int(f"{p}.expert_count")
        n_expert_used = n_expert_used or get_int(f"{p}.expert_used_count")
        hidden = hidden or get_int(f"{p}.embedding_length")
        moe_ff = moe_ff or get_int(f"{p}.expert_feed_forward_length")

    print("\nParametri risolti per i calcoli:")
    print(f"  n_layer (block_count)           = {n_layer}")
    print(f"  n_expert (expert_count)         = {n_expert}")
    print(f"  n_expert_used (per token)       = {n_expert_used}")
    print(f"  hidden (embedding_length)       = {hidden}")
    print(f"  moe_intermediate (expert_ff)    = {moe_ff}")

    # --- Inventario tensori ---
    print("\n## 2. Inventario tensori (tutti)\n")
    print(f"{'#':>4}  {'offset':>14}  {'n_bytes':>14}  {'dtype':<12}  {'shape':<28}  name")
    print("-" * 110)

    tensors = reader.tensors
    sum_tensor_bytes = 0
    # Nomi GGUF: blk.<L>.ffn_{gate,up,down}_exps.weight (+ shexp / fused gate_up)
    expert_re = re.compile(
        r"^blk\.(\d+)\.(ffn_(?:gate|up|down)_exps|ffn_gate_up_exps|"
        r"ffn_(?:gate|up|down)_shexp|ffn_gate_up_shexp)(?:\.weight)?$"
    )
    # Classificazione
    expert_tensors = []  # (idx, layer, kind, tensor)
    other_tensors = []

    for i, t in enumerate(tensors):
        shape = tuple(int(x) for x in t.shape.tolist()) if hasattr(t.shape, "tolist") else tuple(t.shape)
        dtype = str(t.tensor_type).replace("GGMLQuantizationType.", "")
        off = int(t.data_offset)
        nb = int(t.n_bytes)
        sum_tensor_bytes += nb
        print(f"{i:4d}  {off:14d}  {nb:14d}  {dtype:<12}  {str(shape):<28}  {t.name}")
        m = expert_re.match(t.name)
        if m:
            expert_tensors.append((i, int(m.group(1)), m.group(2), t, shape, dtype, off, nb))
        else:
            other_tensors.append((i, t, shape, dtype, off, nb))

    print(f"\nTotale tensori: {len(tensors)}")
    print(f"Somma n_bytes tensori: {fmt_bytes(sum_tensor_bytes)}")
    overhead = file_size - sum_tensor_bytes
    print(f"Overhead metadata (file - sum tensor): {fmt_bytes(overhead)}  ({100.0 * overhead / file_size:.4f}%)")
    print(f"Nota offset: GGUFReader espone data_offset (offset assoluto nel file del payload tensore).")

    # --- Analisi esperti ---
    print("\n## 3. Tensori esperti MoE\n")
    print(f"Trovati {len(expert_tensors)} tensori esperti (ffn_*_exps / shexp).")

    # Raggruppa per layer e kind
    by_layer: dict[int, dict[str, tuple]] = defaultdict(dict)
    for i, layer, kind, t, shape, dtype, off, nb in expert_tensors:
        by_layer[layer][kind] = (i, t, shape, dtype, off, nb)

    layers = sorted(by_layer.keys())
    print(f"Layer con tensori esperti: {len(layers)}  (min={layers[0] if layers else None}, max={layers[-1] if layers else None})")

    # Determina se fused gate_up o separati
    sample_kinds = set()
    for layer in layers[:3]:
        sample_kinds.update(by_layer[layer].keys())
    print(f"Kind osservati (primi layer): {sorted(sample_kinds)}")

    # Per-esperto: shape tipica ha n_expert come una dimensione
    # GGUF MoE: ffn_gate_exps shape = [n_expert, intermediate, hidden] o simili
    print("\n### Breakdown per-layer (primi 3 + ultimo)\n")
    show_layers = layers[:3] + ([layers[-1]] if layers and layers[-1] not in layers[:3] else [])

    per_expert_bytes_per_layer = []  # lista di byte totali per 1 esperto (somma matrici)
    matrix_bytes_per_expert = defaultdict(list)  # kind -> [bytes_per_expert per layer]

    for layer in layers:
        kinds = by_layer[layer]
        layer_total_all_experts = 0  # solo *_exps (routed pack)
        layer_per_expert = 0         # byte di UN esperto routed (somma matrici)
        detail = []
        for kind, (i, t, shape, dtype, off, nb) in sorted(kinds.items()):
            is_shexp = "shexp" in kind
            # Dimensione esperti: SOLO sui tensori *_exps (pack di n_expert).
            # shexp e' un unico esperto shared: shape senza dim 256.
            n_exp_dim = None
            b_per = None
            if not is_shexp:
                if n_expert and n_expert in shape:
                    n_exp_dim = n_expert
                elif len(shape) >= 1 and shape[-1] >= 64:
                    # GGUF: ultima dim del reader = ne[n_dims-1] spesso = n_expert
                    n_exp_dim = int(shape[-1])
                if n_exp_dim:
                    b_per = nb // n_exp_dim
                    layer_total_all_experts += nb
                    layer_per_expert += b_per
                    matrix_bytes_per_expert[kind].append(b_per)
            else:
                # shared: il "per expert" e' l'intero tensore
                b_per = nb
                matrix_bytes_per_expert[kind].append(b_per)
            detail.append((kind, shape, dtype, nb, n_exp_dim, b_per, off))
        per_expert_bytes_per_layer.append(layer_per_expert)

        if layer in show_layers:
            print(f"--- layer {layer} ---")
            for kind, shape, dtype, nb, n_exp_dim, b_per, off in detail:
                print(
                    f"  {kind:<22} shape={shape} dtype={dtype} "
                    f"tensor={fmt_bytes(nb)} n_exp_dim={n_exp_dim} "
                    f"per_expert={fmt_bytes(b_per) if b_per else 'n/a'} off={off}"
                )
            print(f"  TOTALE layer (tutti gli esperti): {fmt_bytes(layer_total_all_experts)}")
            print(f"  TOTALE per 1 esperto (somma matrici): {fmt_bytes(layer_per_expert)}")

    # Uniformità
    if per_expert_bytes_per_layer:
        uniq = set(per_expert_bytes_per_layer)
        print(f"\nByte per 1 esperto per layer (somma matrici): min={min(per_expert_bytes_per_layer)} "
              f"max={max(per_expert_bytes_per_layer)} unique_values={len(uniq)}")
        if len(uniq) == 1:
            print(f"  Uniforme su tutti i {len(per_expert_bytes_per_layer)} layer: {fmt_bytes(per_expert_bytes_per_layer[0])}")
        else:
            # Mostra distribuzione
            from collections import Counter
            c = Counter(per_expert_bytes_per_layer)
            for val, cnt in sorted(c.items()):
                print(f"  {fmt_bytes(val)} → {cnt} layer")

    # Media matrici
    print("\n### Byte medi per-esperto per matrice (su tutti i layer)\n")
    for kind, vals in sorted(matrix_bytes_per_expert.items()):
        avg = sum(vals) / len(vals)
        print(f"  {kind:<22} n={len(vals)}  mean={avg:.1f} B ({avg/1e6:.4f} MB)  "
              f"min={min(vals)} max={max(vals)}")

    # --- Layout: contiguità e ordine ---
    print("\n## 4. Layout nel file (ordine e contiguità)\n")

    print("### Primi 30 tensori (ordine di file = ordine reader.tensors)\n")
    for i, t in enumerate(tensors[:30]):
        shape = tuple(int(x) for x in t.shape.tolist()) if hasattr(t.shape, "tolist") else tuple(t.shape)
        dtype = str(t.tensor_type).replace("GGMLQuantizationType.", "")
        print(f"  [{i:4d}] off={int(t.data_offset):12d}  {t.name}  shape={shape}  {dtype}")

    print("\n### Tensori esperti layer 0, 1, 2 e ultimo — indici e offset\n")
    for layer in show_layers:
        kinds = by_layer[layer]
        print(f"layer {layer}:")
        for kind, (i, t, shape, dtype, off, nb) in sorted(kinds.items(), key=lambda x: x[1][4]):
            print(f"  idx={i:4d} off={off:12d} end={off+nb:12d}  {kind}  bytes={nb}")

    # Contiguità: per ogni layer, i tensori esperti sono contigui tra loro?
    # (nessun tensore non-esperto intercalato tra il min e max offset degli esperti del layer)
    print("\n### Contiguita' per-layer degli esperti ROUTED (*_exps, no shexp)\n")
    print("Test A: i 3 tensori *_exps di un layer sono adiacenti tra loro (nessun tensore in mezzo)?")
    print("Test B: all'interno di ogni tensore, 1 esperto e' un blocco contiguo")
    print("        (assunzione: dim n_expert = ultima dim GGUF = ne[n-1] = outermost → SI).")
    contiguous_exps_count = 0
    for layer in layers:
        kinds = by_layer[layer]
        exps = [(off, off + nb, kind) for kind, (_, _, _, _, off, nb) in kinds.items() if "shexp" not in kind]
        exps.sort()
        if not exps:
            continue
        # Gap tra i 3 tensori exps?
        gaps = []
        for a, b in zip(exps, exps[1:]):
            gap = b[0] - a[1]
            if gap != 0:
                gaps.append((a[2], b[2], gap))
        # Cosa c'e' tra min e max offset degli exps?
        lo, hi = exps[0][0], exps[-1][1]
        intercalated = []
        for j, t in enumerate(tensors):
            toff = int(t.data_offset)
            if toff >= lo and toff < hi:
                # e' uno dei nostri exps?
                if not any(toff == e[0] for e in exps):
                    intercalated.append((j, t.name, toff))
        is_contig = len(intercalated) == 0 and len(gaps) == 0
        if is_contig:
            contiguous_exps_count += 1
        if layer in show_layers or (not is_contig and layer < 3):
            status = "CONTIGUI tra loro" if is_contig else f"NON contigui ({len(intercalated)} in mezzo)"
            print(f"  layer {layer}: exps range=[{lo},{hi}) span={hi-lo} -> {status}")
            for kind_a, kind_b, gap in gaps:
                print(f"    gap {kind_a} -> {kind_b}: {gap} B")
            for j, name, toff in intercalated[:6]:
                print(f"    in mezzo: idx={j} off={toff} {name}")

    print(f"\nLayer con i 3 *_exps mutuamente contigui: {contiguous_exps_count}/{len(layers)}")
    print("Nota: ordine tipico per layer = down_exps, down_shexp, gate_exps, gate_inp,")
    print("      gate_inp_shexp, gate_shexp, up_exps, up_shexp → shexp+router spezzano i 3 exps.")

    # Ordine globale: gli esperti sono ordinati per layer crescente?
    expert_layer_order = [layer for _, layer, _, _, _, _, _, _ in expert_tensors]
    is_layer_sorted = expert_layer_order == sorted(expert_layer_order)
    print(f"Tensori esperti in ordine di layer crescente (stabile): {is_layer_sorted}")

    # Interleaving con attention/dense: tra due layer esperti consecutivi c'è altro?
    print("\n### Pattern interleaving (tra esperti layer L e L+1)\n")
    if len(layers) >= 2:
        for layer in layers[:3]:
            next_layer = layer + 1 if (layer + 1) in by_layer else None
            if next_layer is None:
                continue
            hi_l = max(off + nb for _, _, _, _, off, nb in by_layer[layer].values())
            lo_n = min(off for _, _, _, _, off, _ in by_layer[next_layer].values())
            between = []
            for j, t in enumerate(tensors):
                toff = int(t.data_offset)
                if hi_l <= toff < lo_n:
                    between.append(t.name)
            print(f"  tra layer {layer} e {next_layer}: {len(between)} tensori "
                  f"(gap={lo_n - hi_l} B) → {between[:8]}{'...' if len(between) > 8 else ''}")

    # --- Sanity e traffico naive ---
    print("\n## 5. Numeri chiave: per-esperto, traffico naive, sanity\n")

    if not per_expert_bytes_per_layer:
        print("ERRORE: nessun tensore esperto misurato.")
        return 1

    # Usa la mediana (o il valore uniforme) come byte/esperto/layer
    bytes_per_expert_layer = sorted(per_expert_bytes_per_layer)[len(per_expert_bytes_per_layer) // 2]
    mb_per_expert = bytes_per_expert_layer / 1e6
    mib_per_expert = bytes_per_expert_layer / (1 << 20)

    # Routed experts per token: qwen35moe.expert_used_count = 8 (solo routed).
    # Shared expert (shexp) è ADDITIVO e residente — non conta nel traffico flash.
    # Piano: 9 attivi = 8 routed + 1 shared.
    n_used = n_expert_used or 8
    n_shared = None
    for p in (str(arch) if arch else "", "qwen3moe", "qwen3_5_moe", "qwen35moe"):
        if not p:
            continue
        n_shared = n_shared or get_int(f"{p}.expert_shared_count")
    has_shexp = any("shexp" in kind for kind, _ in matrix_bytes_per_expert.items())
    if n_shared is not None:
        # Se metadata conta lo shared dentro used, sottrai; altrimenti used=routed
        n_routed = n_used - n_shared if n_used > n_shared else n_used
    elif has_shexp:
        n_routed = n_used  # used = solo routed; shared a parte
        n_shared = 1
    else:
        n_routed = n_used
    n_layers_eff = len(layers) if layers else (n_layer or 40)

    naive_bytes = n_routed * n_layers_eff * bytes_per_expert_layer
    naive_mb = naive_bytes / 1e6

    print(f"  bytes / esperto / layer (misurato) = {bytes_per_expert_layer}  "
          f"({mb_per_expert:.4f} MB / {mib_per_expert:.4f} MiB)")
    print(f"  n_expert (metadata)                = {n_expert}")
    print(f"  n_expert_used (metadata)           = {n_used}")
    print(f"  n_shared (metadata)                = {n_shared}")
    print(f"  n_routed usati per traffico naive  = {n_routed}  "
          f"(= expert_used_count; shared e' additivo/residente)")
    print(f"  n_layers con esperti               = {n_layers_eff}")
    print(f"  Traffico naive / token (0% hit)    = {n_routed} × {n_layers_eff} × "
          f"{bytes_per_expert_layer} = {naive_bytes} B = {naive_mb:.2f} MB/token")

    # Breakdown matrici (media)
    print("\n  Breakdown matrici (byte per 1 esperto, media su layer):")
    matrix_sum = 0
    for kind, vals in sorted(matrix_bytes_per_expert.items()):
        if "shexp" in kind:
            continue  # shared non conta nel per-esperto routed
        avg = sum(vals) / len(vals)
        matrix_sum += avg
        print(f"    {kind:<22} {avg:.1f} B  ({avg/1e6:.4f} MB)")
    print(f"    SOMMA matrici routed           {matrix_sum:.1f} B  ({matrix_sum/1e6:.4f} MB)")

    # Sanity params
    if hidden and moe_ff:
        # 3 matrici dense: gate (H×I), up (H×I), down (I×H) → 3 * H * I
        # oppure fused gate_up (H×2I) + down (I×H) → 3 * H * I uguale
        params_per_expert = 3 * hidden * moe_ff
        print(f"\n  Sanity parametri (da metadata):")
        print(f"    hidden={hidden}  moe_ff={moe_ff}")
        print(f"    params/esperto/layer (3·H·I) = {params_per_expert:,}")
        if n_expert and n_layers_eff:
            total_expert_params = params_per_expert * n_expert * n_layers_eff
            print(f"    256×{n_layers_eff}×params               = {total_expert_params:,} "
                  f"({total_expert_params/1e9:.2f}B)")
            # bpw effettivo dagli esperti
            total_expert_bytes = sum(
                nb for _, _, kind, _, _, _, _, nb in expert_tensors if "shexp" not in kind
            )
            # oppure: n_expert * n_layers * bytes_per_expert
            total_expert_bytes_alt = n_expert * n_layers_eff * bytes_per_expert_layer
            bpw = (total_expert_bytes_alt * 8) / total_expert_params if total_expert_params else 0
            print(f"    byte totali esperti (n_exp×L×b)  = {fmt_bytes(total_expert_bytes_alt)}")
            print(f"    bpw effettivo esperti            = {bpw:.3f} bit/weight")

    # Shared expert size
    shexp_bytes_per_layer = []
    for layer in layers:
        s = 0
        for kind, (_, _, _, _, _, nb) in by_layer[layer].items():
            if "shexp" in kind:
                s += nb
        if s:
            shexp_bytes_per_layer.append(s)
    if shexp_bytes_per_layer:
        avg_shexp = sum(shexp_bytes_per_layer) / len(shexp_bytes_per_layer)
        print(f"\n  Shared expert (shexp) per layer: mean={fmt_bytes(int(avg_shexp))}  "
              f"× {len(shexp_bytes_per_layer)} layer = {fmt_bytes(int(avg_shexp * len(shexp_bytes_per_layer)))}")

    # Formula aggiornata
    print("\n## 6. Formula guida aggiornata\n")
    print(f"  t_token ≈ t_compute(3B attivi, CPU 8g2) + n_miss × t_load_esperto")
    print(f"  t_load_esperto ≈ tempo UFS per caricare {mb_per_expert:.3f} MB "
          f"({bytes_per_expert_layer} B) random")
    print(f"  n_miss = {n_routed} × {n_layers_eff} × (1 − hit_rate) = "
          f"{n_routed * n_layers_eff} × (1 − h)")
    print(f"  traffico_flash/token = n_miss × {mb_per_expert:.3f} MB")

    print("\n## DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
