# M5b - Bake-off politiche cache (F4.8/notte)

Solo PC. Stesse trace di M5. C=2000 MiB. Finestra decode-only per i delta.

## Gate del simulatore

- LRU@2000 cum simulato: **48.054%** (misurato 48.1)
- gap: **-0.046 pp** - PASS
- LRU decode short_bench: **72.236%**
- Belady decode short_bench: **90.029%**
- Belady-LRU: **17.793 pp**

## Dichiarazioni di fedelta

- **ARC-2L**: T1/T2 + ghost size-aware (budget in byte). NON l ARC a pagine unitarie di Megiddo & Modha 2003.
- **LIRS-HIR**: LIR/HIR size-aware, lir_frac=0.99. NON la LIRS stack-distance esatta di Jiang & Zhang 2002.
- **SCORE-***: colonna weight del route-trace. SCORE-ADMIT soglie = q10/q25/q50 osservati.
- **BUDGET-LAYER**: LRU per layer, budget fissi che sommano a C.

## Regola di decisione (dichiarata)

- delta_dec vs LRU >= +5.9 pp -> IMPLEMENTA
- delta_dec vs LRU < +2.0 pp -> ARCHIVIA
- in mezzo -> REPORT + costo implementazione

## Classifica short_bench (hit decode @ C=2000)

| policy | hit dec % | d vs LRU | frazione gap Belady | verdetto |
|---|---:|---:|---:|---|
| lru (baseline) | 72.236 | 0 | 0 | - |
| belady (oracolo) | 90.029 | +17.793 | 1.0 | oracolo |
| layer_equal | 76.084 | +3.848 | 0.216 | **IN_MEZZO** |
| layer_prop_top8 | 75.156 | +2.920 | 0.164 | **IN_MEZZO** |
| layer_prop_invH | 75.029 | +2.793 | 0.157 | **IN_MEZZO** |
| arc2l | 72.197 | -0.039 | -0.002 | **ARCHIVIA** |
| lfu | 72.119 | -0.117 | -0.007 | **ARCHIVIA** |
| score_admit_q10 | 70.928 | -1.308 | -0.074 | **ARCHIVIA** |
| score_admit_q25 | 69.453 | -2.783 | -0.156 | **ARCHIVIA** |
| score_admit_q50 | 67.598 | -4.638 | -0.261 | **ARCHIVIA** |
| score_evict | 63.633 | -8.603 | -0.484 | **ARCHIVIA** |
| lirs_hir | 42.031 | -30.205 | -1.698 | **ARCHIVIA** |

## Media su 6 trace (d decode vs LRU)

| policy | mean d | min | max | verdetto media |
|---|---:|---:|---:|---|
| layer_equal | +4.624 | +3.282 | +6.631 | IN_MEZZO |
| layer_prop_top8 | +3.737 | +2.305 | +6.094 | IN_MEZZO |
| layer_prop_invH | +3.706 | +2.110 | +6.084 | IN_MEZZO |
| arc2l | +0.262 | -0.157 | +0.976 | ARCHIVIA |
| lfu | +0.135 | -0.117 | +0.566 | ARCHIVIA |
| score_admit_q10 | -1.105 | -1.562 | -0.333 | ARCHIVIA |
| score_admit_q25 | -2.301 | -2.783 | -1.163 | ARCHIVIA |
| score_admit_q50 | -4.543 | -6.944 | -2.276 | ARCHIVIA |
| score_evict | -9.886 | -15.098 | -7.452 | ARCHIVIA |
| lirs_hir | -29.416 | -31.514 | -27.470 | ARCHIVIA |

## Meccanismo

### Distanza di riuso (decode, short_bench)
- n: 9627
- median: 80.0
- p90: 680.0
- p99: 1240.0
- frac_reuse_le_40: 0.4066687441570583
- frac_reuse_le_200: 0.6661472940687649
- frac_reuse_le_800: 0.9175236314532045
- frac_reuse_gt_2000: 0.0

### Score router vs distanza di riuso
- n: 2800
- pearson_score_vs_med_reuse: -0.2224
- med_reuse_high_score: 160.0
- med_reuse_low_score: 380.0
- note: negative pearson => high score -> short reuse

Belady vede la distanza di riuso futura. SCORE usa il weight del router come proxy; ARC/LIRS usano frequenza/IRR passati; BUDGET-LAYER scommette sui layer concentrati.

## Partizionamento per-layer (short_bench, estratto)

### mode=equal (somma=2000.0 MiB)
| layer | budget MiB | resident |
|---:|---:|---:|
| L0 | 50.0 | 55 |
| L1 | 50.0 | 55 |
| L2 | 50.0 | 55 |
| L3 | 50.0 | 55 |
| L4 | 50.0 | 55 |
| L18 | 50.0 | 55 |
| L19 | 50.0 | 55 |
| L20 | 50.0 | 55 |
| L21 | 50.0 | 55 |
| L35 | 50.0 | 55 |
| L36 | 50.0 | 55 |
| L37 | 50.0 | 55 |
| L38 | 50.0 | 47 |
| L39 | 50.0 | 47 |

### mode=prop_invH (somma=2000.0 MiB)
| layer | budget MiB | resident |
|---:|---:|---:|
| L0 | 16.264 | 18 |
| L1 | 20.195 | 22 |
| L2 | 19.479 | 21 |
| L3 | 49.535 | 55 |
| L4 | 42.675 | 47 |
| L18 | 46.237 | 51 |
| L19 | 48.389 | 53 |
| L20 | 58.067 | 64 |
| L21 | 63.933 | 71 |
| L35 | 59.305 | 66 |
| L36 | 70.686 | 78 |
| L37 | 73.333 | 81 |
| L38 | 85.05 | 81 |
| L39 | 72.042 | 68 |

### mode=prop_top8 (somma=2000.0 MiB)
| layer | budget MiB | resident |
|---:|---:|---:|
| L0 | 29.243 | 32 |
| L1 | 25.361 | 28 |
| L2 | 26.794 | 29 |
| L3 | 59.918 | 66 |
| L4 | 41.56 | 46 |
| L18 | 44.971 | 50 |
| L19 | 42.721 | 47 |
| L20 | 52.844 | 58 |
| L21 | 62.948 | 70 |
| L35 | 59.574 | 66 |
| L36 | 76.39 | 85 |
| L37 | 77.206 | 85 |
| L38 | 91.356 | 87 |
| L39 | 85.932 | 82 |

## Costi implementazione (IN_MEZZO)

| policy | effort | note |
|---|---|---|
| arc2l | 2-4 gg | T1/T2+ghost size-aware in IExpertSource |
| lirs_hir | 3-5 gg | stack S + Q HIR |
| score_evict | 0.5-1 gg | max-weight per entry |
| score_admit_* | 0.5 gg | soglia su weight; vicino a drop-cold |
| layer_* | 1-2 gg | budget per layer |

## Cosa non dice

- Non misura qualita (PPL).
- Simulatore offline, non telefono.
- ARC/LIRS sono varianti size-aware dichiarate.
- Trace brevi (32 tok gen); vedi C3 per 512 tok.
