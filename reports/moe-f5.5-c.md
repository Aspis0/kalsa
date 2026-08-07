# F5.5-C — Diagnosi del simulatore di cache esperti M5

**Data:** 2026-08-07  
**Scope:** solo PC. Nessun telefono, nessun ssh.  
**Python:** `Python312` (3.12.10).  
**Script:** `scripts/analysis/f55c_sim_diagnosis.py` (copia di lavoro; **non** modifica `m5_route_trace_analysis.py`).  
**Artefatti:** `results/f5.5-c/{diary.txt,results.json,comparison.tsv,run.log}`.

## 1. Contesto

Due strumenti misurano l'hit-rate della cache esperti MoE:

| strumento | cosa misura | numeri @ 2000/2500/3000/3500 MiB |
|---|---|---|
| **Runtime F5.4-C** (S23, in carica) | `moe-cache % hit` **cumulativo** (unique-prefill + decode), prompt IT lungo **1138+256**, ubatch 512 | **71.1 / 73.3 / 75.1 / 76.1** (Δ +5.0) |
| **Simulatore M5** (`pass2_curve.tsv`) | `lru_hit_req_dec` **decode-only**, trace `short_bench` **102+32** | **72.2 / 76.3 / 80.0 / 84.1** (Δ +11.8) |

F5.4 ha messo queste due colonne nella stessa tabella e ha concluso che M5 «sovrastima la pendenza di 2.4×». Qui si verifica se il simulatore è sbagliato o se il confronto era apples-to-oranges.

## 2. Riproduzione (H0)

Rieseguito `CacheSim` LRU sulle stesse batch di M5 (`short_bench`, ebytes per-layer dal preamble):

| C MiB | sim cum | sim dec | report M5 dec | Δ vs report |
|---:|---:|---:|---:|---:|
| 2000 | 48.054 | **72.236** | 72.236 | **0.000** |
| 2500 | 50.737 | **76.270** | 76.27 | **0.000** |
| 3000 | 53.251 | **80.049** | 80.049 | **0.000** |
| 3500 | 55.935 | **84.082** | 84.082 | **0.000** |

**H0 PASS.** Il simulatore riproduce i numeri del report al millesimo. Non c'è drift di codice.

Gate same-trace (già in M5, riconfermato):

| trace | sim cum @2000 | runtime hit | gap |
|---|---:|---:|---:|
| short_bench | 48.054 | 48.1 | −0.05 pp |
| long_512 | 86.582 | 86.6 | **−0.018 pp** |

## 3. Tabella scarti F5.4 (come pubblicata)

Scarto = misura − sim (come in `reports/moe-f5.4.md`).

| C MiB | sim dec (M5) | misura cum (F5.4) | scarto | note |
|---:|---:|---:|---:|---|
| 2000 | 72.236 | 71.1 | **−1.14** | metriche diverse |
| 2500 | 76.270 | 73.3 | **−2.97** | + traccia diversa |
| 3000 | 80.049 | 75.1 | **−4.95** | |
| 3500 | 84.082 | 76.1 | **−7.98** | |
| Δ 2000→3500 | **+11.85** | **+5.0** | sim «2.4×» | artefatto del confronto |

Se si confrontasse **cum vs cum** sulla stessa short_bench, lo scarto sarebbe **+23 → +20 pt** (misura sopra il sim): segno opposto, perché F5.4 non è short_bench.

## 4. Ipotesi testate

### H1 — Mismatch di metrica (decode-only vs cumulativo)

| metrica | slope 2000→3500 short_bench |
|---|---:|
| sim decode-only | **+11.8** |
| sim cumulativo | **+7.9** |
| misura F5.4 cum | **+5.0** |

**Confermato:** F5.4 ha citato `lru_hit_req_dec` contro `moe-cache % hit` cumulativo.  
**Non sufficiente:** anche cum-vs-cum su short lascia un gap di ~20 pt → serve anche la traccia/prompt.

### H2 — Mismatch di traccia / prompt

| traccia | pref+dec | sim cum @2000..3500 | slope cum |
|---|---|---|---:|
| short_bench | 102+32 | 48.1 → 55.9 | +7.9 |
| long_512 | 143+512 | 86.6 → 93.3 | **+6.7** |
| F5.4 misura | 1138+256 | 71.1 → 76.1 | **+5.0** |

- Same-trace: sim ≈ runtime (gate −0.02 pp).
- long_512 è decode-dominated (hit alto); F5.4 è prefill-heavy (1138 token, ubatch 512 → ~3 chunk) → cum più basso.
- **Il gap di pendenza nasce dal confronto cross-trace + cross-metric, non da un LRU simulato «troppo ottimista» sulla sua traccia.**

### H3 — Capacità effettiva < nominale — **ESCLUSA**

Sconto del budget su short_bench decode-only:

| frazione | slope dec | MAE vs misura (dec) | hit @2000..3500 |
|---:|---:|---:|---|
| 1.00 | +11.8 | 4.26 | 72.2 / 76.3 / 80.0 / 84.1 |
| 0.95 | +11.5 | 3.13 | 71.2 / 75.4 / 78.9 / 82.7 |
| 0.90 | +11.1 | 2.42 | 70.3 / 74.3 / 77.7 / 81.4 |
| 0.85 | +10.3 | 1.73 | 69.6 / 73.2 / 76.7 / 79.9 |
| 0.80 | +9.5 | 1.50 | 69.0 / 72.2 / 75.5 / 78.5 |

Log F5.4: `resident 1999.9 / 2499.6 / 2999.5 / 3499.9 MiB` ≈ budget nominale. Uno sconto 15–20% contraddice i log e non porta la pendenza a +5.

### H4 — Prefill multi-ubatch / granularità eviction

Su trace F4.8 (`pref` 102 e 143 **<** ubatch 512) multi-chunk ≡ single-pass (numeri identici).  
Il runtime evince a granularità entry (layer,expert) dopo ogni `load_layer`, con pin della generazione corrente (`cstamp_ == cgen_`) — già modellato da M5 (`evict_to_budget(protected=touched)`).

Multi-ubatch **conta** solo per `n_prompt > ubatch` (F5.4 = 1138). M5 single-pass è fedele alle run F4.8 da cui deriva.

### H5 — Taglia voce uniforme vs per-layer — **ESCLUSA**

M5 usa già `expert_bytes` per-layer dal preamble (L0–33/35–37: 942080; L34/L38/L39: 1097728).  
Uniforme 942080 sposta decode-hit di **~+0.5 pp**, non la pendenza.

### H6a — Envelope I/O F5.4 (decode-attributed)

`moe-stream` F5.4 è **decode-attributed**. Con theo cold ≈ 291.1 MiB/tok (M5 short):

| C | mib/tok F5.4 | byte-hit dec approx |
|---:|---:|---:|
| 2000 | 32.93 | **88.7%** |
| 2500 | 24.80 | **91.5%** |
| 3000 | 18.35 | **93.7%** |
| 3500 | 14.63 | **95.0%** |

Allineato a long_512 decode-hit sim (**89.2 → 96.2**), **non** a short_bench (**72 → 84**).  
La pendenza shallow di F5.4 è del **cumulativo prefill-heavy**, non di un decode «peggio del sim».

### H6b — Synth 1138+256 (sensibilità, non predizione)

Traccia sintetica i.i.d. dalle marginali di long_512 (non cattura dipendenza temporale del router):

| regime | cum @2000..3500 | slope | MAE vs misura |
|---|---|---:|---:|
| single-pass prefill | 70.9 / 76.9 / 81.4 / 84.5 | +13.7 | 4.67 |
| ubatch 512 (3 chunk) | 63.5 / 69.0 / 73.2 / 76.2 | +12.7 | 3.49 |

Ubatch abbassa il cum (eviction tra chunk prefill) e avvicina il livello a 3500 (76.2 ≈ 76.1), ma la pendenza resta troppo ripida: senza la route-trace reale di F5.4 non si chiude lo scarto al punto.  
**Non è una correzione del sim M5 sulle sue trace; è un proxy di popolazione diversa.**

### Prefetch / retain / overlap

Config F5.4-C: `--overlap --io-threads 4`, **senza** `--prefetch`.  
`--overlap` riorganizza l'I/O (stall vs wall) ma non cambia l'accounting di residency.  
`retain()` promuove MRU senza leggere — assente in F5.4 senza predittore.  
**Non modellare prefetch non spiega il gap.**

## 5. Causa identificata

**Il simulatore M5 non è rotto.** Il «gap» F5.4-C è un confronto **apples-to-oranges**:

1. **Metrica:** M5 in tabella = decode-only; runtime = cumulativo (unique-prefill + decode).
2. **Popolazione:** M5 = `short_bench` 102+32; F5.4 = prompt IT 1138+256, ubatch 512.
3. **Fedeltà same-trace:** gap < 0.05 pp su short e su long_512.
4. **I/O decode F5.4** implica hit decode ~89–95% (long-like), coerente col sim su trace lunghe.

Ipotesi di bug del sim **escluse** come causa primaria: capacità scontata (H3), taglia voce (H5), prefetch non modellato, granularità eviction diversa da M5 sulle trace F4.8.

## 6. Ricalcolo Belady-vs-LRU e bake-off

Non serve «correggere» il sim e rifare tutto: la fedeltà same-trace regge. Si ricalcolano i delta su metriche/trace alternative per vedere se i **verdetti** si rovesciano.

### Belady − LRU @ C=2000

| config | LRU | Belady | Δ | verdetto (soglia M5: ≥8 VIVO) |
|---|---:|---:|---:|---|
| short_dec (M5 originale) | 72.24 | 90.03 | **+17.79** | **VIVO** (invariato) |
| short_cum | 48.05 | 59.89 | **+11.84** | **VIVO** |
| long_dec | 89.25 | 95.62 | **+6.37** | **IN_MEZZO** |
| long_cum | 86.58 | 92.76 | **+6.18** | **IN_MEZZO** |

Su short_bench il verdetto M5 **VIVO** resta. Su long il gap scende sotto 8 ma resta ≥6: politica migliore di LRU ancora plausibile, non un ribaltamento a «MORTO».

### Bake-off ridotto @2000 (LRU / LFU / W-TinyLFU)

| config | LRU | LFU | W-TinyLFU |
|---|---:|---:|---:|
| short_dec | 72.24 | 72.12 (−0.12) | 59.45 (−12.8) |
| long_cum | 86.58 | 87.32 (+0.74) | 77.36 (−9.2) |

LFU ≈ LRU (ARCHIVIA). W-TinyLFU peggiore (ARCHIVIA).  
Allineato a M5b: nessuna policy semplice batte LRU di ≥5.9 pp su short; layer-partition restava IN_MEZZO. **Nessun verdetto M5b da rovesciare** per un «bug» del sim.

## 7. Policy di confronto (raccomandazione)

Per confronti futuri sim ↔ runtime:

1. **Stessa traccia** (idealmente route-trace della run misurata).
2. **Stessa metrica**, dichiarata: `cum` (= unique-prefill + decode, = `moe-cache % hit`) **oppure** `dec` (solo decode).
3. Se si vuole predire F5.4-C: raccogliere route-trace a ubatch 512, n_prompt≈1138, n_dec=256, e simulare multi-chunk prefill.
4. Non citare `lru_hit_req_dec` short_bench contro hit cumulativo di un altro prompt.

Correzione del codice M5: **non necessaria** per fedeltà. Opzionale: esporre esplicitamente entrambe le metriche nel report di curva e rifiutare confronti cross-metric in CI.

## 8. Artefatti

| path | contenuto |
|---|---|
| `scripts/analysis/f55c_sim_diagnosis.py` | script diagnosi (H0–H7), non tocca M5 originale |
| `results/f5.5-c/diary.txt` | diario ipotesi + numeri |
| `results/f5.5-c/results.json` | JSON strutturato |
| `results/f5.5-c/comparison.tsv` | short/long vs misura |
| `results/f5.5-c/run.log` | log completo run |

Trace usate (già in repo): `results/f4.8/traces/{short_bench,long_512}.route.tsv`.  
Misure F5.4: `reports/moe-f5.4.md` §C; log `results/f5.4/c/`.

## 9. Blocker

- **Nessun blocker** sulla diagnosi del sim.
- Per chiudere quantitativamente cum@F5.4 al punto: serve **route-trace della run F5.4-C** (non presente in `results/f5.4/`). Fino ad allora il sim resta validato solo same-trace F4.8.
