# F0.6 — Download + gguf-dump UD-IQ2_M — 2026-08-03

## Cosa è stato fatto (vs piano)

1. **Download** di `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` da HF unsloth in `models/` (gitignored), con `curl -L -C - --retry` (resume dopo timeout a ~56%).
2. **Verifica size** byte-esatta vs atteso F0.1.
3. **Analisi tensori** con fallback Python `gguf.GGUFReader` (host Windows senza cmake/gcc/cl; `python3` = stub MS Store → `py -3` + venv `.venv/` + `pip install gguf`).
4. Script versionato: `analysis/gguf_dump_analyze.py` (commenti IT). Output grezzo: `results/gguf_ud-iq2m_dump.txt`.
5. Aggiornati PLAN.md §4 budget core e §5 fisica (stime [S] → [V]).

**Non fatto (fuori scope):** nessun altro GGUF (no Q2_K_XL, no MTP); no commit; no touch a `scripts/`.

## Numeri chiave

| Voce | Valore | Marca |
|---|---|---|
| Path | `models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf` | |
| Size file | **11 522 702 304** B (11.5227 GB) | **[V] match HF** |
| Arch | `qwen35moe` | [V] |
| Layers / experts / used | 40 / 256 / **8 routed** (+ 1 shared shexp) | [V] |
| hidden / moe_ff | 2048 / 512 | [V] |
| params/esperto/layer | 3 · 2048 · 512 = **3 145 728** | [V] |
| Tensori totali | 733 | [V] |
| Overhead metadata | file − Σ tensor = **10 990 048 B (0.095%)** | [V] |

### Per-esperto per-layer (routed, 1 esperto = slice di ciascun `*_exps`)

| Matrice | dtype (maggioranza) | Byte / esperto | MB |
|---|---|---:|---:|
| `ffn_gate_exps` | IQ2_XXS | 270 336 | 0.270 |
| `ffn_up_exps` | IQ2_XXS | 270 336 | 0.270 |
| `ffn_down_exps` | IQ3_XXS (37 layer) | 401 408 | 0.401 |
| `ffn_down_exps` | IQ4_XS (layer 34, 38, 39) | 557 056 | 0.557 |
| **Totale 1 esperto (37/40 L)** | | **942 080** | **0.942** |
| **Totale 1 esperto (3/40 L)** | | **1 097 728** | **1.098** |
| Media su 40 layer | | 953 754 | 0.954 |

Shared expert (`*_shexp`) per layer: **2 301 952 B ≈ 2.30 MB** × 40 = 92.1 MB totali — **residente**, non nel traffico flash.

### Traffico naive e formula

```
traffico_naive/token = 8 routed × 40 layer × 942080 B
                     = 301 465 600 B ≈ 301.5 MB/token   [V]

t_token ≈ t_compute(3B attivi, CPU 8g2)
        + n_miss × t_load_esperto(UFS 3.1, random ~0.942 MB)
n_miss  = 320 × (1 − hit_rate)
```

A 300 MB/s random [S] → ~1.0 s I/O/token ≈ **1.0 tok/s** di solo flash (muro). Con hit-rate 90% → ~30 MB/token flash.

### Sanity 35.95B

- 256 × 40 × 3 145 728 = **32.21B** params esperti routed
- + shared FFN (~0.03B) + attention/SSM/embed/lm_head ≈ resto → **~35.9B** totali ✓
- bpw esperti effettivo (mediana): 942080 · 8 / 3 145 728 ≈ **2.40 bit/w**

### Layout file

- **Non fused:** gate / up / down separati (no `ffn_gate_up_exps`).
- **Per layer, i 3 `*_exps` NON sono contigui tra loro:** in mezzo stanno `ffn_down_shexp`, `ffn_gate_inp` (router), `ffn_gate_inp_shexp`, `ffn_gate_shexp`. 0/40 layer con exps mutuamente adiacenti.
- **Dentro ogni tensore `*_exps`:** shape `(…, 256)` con 256 = n_expert outermost → **1 esperto = blocco contiguo** (assunzione GGUF ne[] standard; coerente con n_bytes/256 intero).
- **Ordine globale:** layer 0→39 crescente; tra un layer e il successivo: post-attn norm + blocchi SSM (o full-attn ogni 4) + attn del layer successivo.
- Implicazione streaming: 3 seek/read per esperto-layer (gate, up, down) se si carica per-matrice; oppure 1 read grande per tensore intero (tutti i 256) se si fa cache a grana tensore.

## Deviazioni / sorprese / bug

1. **python3 stub MS Store** su questo host → obbligatorio `py -3` + `.venv/`. Documentato anche in F0.1.
2. **gguf-dump C++ non buildabile** (no cmake/gcc/cl) → fallback `gguf` 0.19.0 OK; `ReaderTensor.data_offset` / `n_bytes` esposti (niente offset derivati).
3. **`expert_used_count=8`**, non 9: i 9 attivi del marketing = 8 routed + 1 shared. Traffico flash conta **8**, non 9.
4. **Quant mista per-layer sulla down:** 3 layer finali (34/38/39) a IQ4_XS (+16.5% byte/esperto). Headline = mediana 0.942 MB, non la media.
5. **Layout spezzato:** shexp+router intercalati tra i 3 exps → prefetch per-esperto deve fare 3 I/O (o leggere span ~245 MB che include shexp/router inutili per quel miss). Rilevante per H6 (reorder GGUF).
6. **§4 core budget:** 22.6 GB [S] → **30.7 GB [V]** se si tengono base+MTP; documentata alternativa swap-in-F6.
7. Stima pre-F0.6 ~1.0–1.3 MB/esperto e ~350 MB/token era **leggermente pessimista** (reale 0.942 / 301.5): il muro resta della stessa ordine di grandezza.

## Verdetto gate: PASS

- File scaricato e size match byte-esatto.
- Dump completo + numeri per-esperto/matrice/layer + traffico naive + layout + overhead.
- PLAN.md §4/§5 aggiornati con [V].

## Prossima azione proposta

1. Procedere F0 restanti / F1 (push modello sul telefono) usando **0.942 MB/esperto** e **301.5 MB/token** come costanti di design.
2. In F2.1 (fio): misurare random read a granularità **~256k–1M**, non 4K.
3. In design cache (F4/F7): valutare grana di caricamento (per-matrice 3 I/O vs span layer) alla luce del layout non contiguo.
4. F6: preferire **swap** del GGUF target con variante MTP piuttosto che tenere 11.52+11.37 GB affiancati.

DONE
