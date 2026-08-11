# moe-trial-marco-it-v2

**Data:** 2026-08-11  
**Scope:** PC only · fix del buco "italiano di Marco NON MISURATO" (PLAN).  
**Corpus:** `corpus/multi5/it.txt` v2 = Wikipedia IT "Caffè" · 45747 B · sha `498a5f3b…`  
**Non usare** it_v1 letterario (Dante) per confronti cross-model.

## Risultati bpb (lower = better)

| model | IT v2 bpb | PPL | n_tok | wall_s |
|-------|----------:|----:|------:|-------:|
| **KEXP k6d065** | **0.7066** | 7.56 | 11079 | 1781 |
| **Marco** | **0.7501** | 5.68 | 13696 | 7867 |
| Qwen3.5-4B | 0.7686 | 9.03 | 11079 | 1217 |

Δ Marco−Qwen = **−0.018** (Marco vince su prosa moderna IT)  
Δ Marco−KEXP = **+0.043** (atteso: tier sotto il 35B)

## Confronto con it_v1 letterario (invalidato)

| | KEXP | Marco | nota |
|--|-----:|------:|------|
| it_v1 Dante bpb | 0.384 | **1.638** | memorizzazione / mismatch |
| it_v2 moderno | 0.707 | 0.750 | **valido** |

## Gate T2c ricalcolati (IT = v2)

`results/trial_marco/quality_gates.json` aggiornato 2026-08-11.

| gate | esito |
|------|--------|
| T2c macro Marco < Qwen−0.03 | **PASS** (macro5 0.728 vs 0.763, Δ=**−0.036**) |
| win/tie ≥4/5 vs Qwen | **PASS 5/5** |
| no loss >0.10 vs Qwen | **PASS** |
| **T2c_pass** | **TRUE** |
| T2b vs KEXP (+0.05 macro, +0.15/lang) | **PASS** |

Macro-4 (EN/ES/FR/ZH, no IT): allineato al verbale PLAN T2c storico.

## Conseguenza

- **Italiano Marco: MISURATO** su prosa moderna — non è un buco.
- **MarcoKEXP download Q8 (~18 GB) + recipe già pronta:** sblocco formale confermato; esecuzione quantize **solo al GO gualt**.
- Artifact: `results/trial_marco/ppl_it_v2/`, commit pipeline preesistente + questo report.

**STOP** su quantize / device.
