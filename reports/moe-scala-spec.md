# moe-scala-spec — N2 (PC) results 2026-08-10

## Predictions (pre-numbers)
See `results/spec_ladder/n2/predictions.txt`. Threshold α≥60% VERDE.

## N2 acceptance table

| mechanism | α / stats | method | verdict |
|---|---|---|---|
| **draft-mtp** | **α=0.60** (33/55 draft tokens), mean accept len **3.36** | live `llama-server` `--spec-type draft-mtp`, target IQ1_M + mtp-Q4_0 head, IT prompt n=48 | **VERDE** (soglia) |
| draft-simple 0.8B | α=0.444, e_acc_k4=1.71, mean_run=1.99 | offline teacher-forcing on f5.5/b gens (1548 pos), tokenizer MATCH | **ROSSO** |
| draft-simple 2B | α=0.495, e_acc_k4=1.85, mean_run=2.13 | offline same | **GIALLO** |
| draft-simple 4B | α=0.545, e_acc_k4=1.96, mean_run=2.43 | offline same | **GIALLO** |
| draft-simple live | FAIL | GGML_ASSERT `n_outputs_max` even with `-np 1` | **non misurabile live** |
| draft-dflash | FAIL | GGUF manca metadata `target_layers` | **NON USABILE** (GGUF incompleto) |
| ngram-mod | ran ready, no draft accept fields in timings/stderr | live floor | **α non riportata** (strumentazione) |

## Winner for cantiere signal
**draft-mtp** is the only mechanism that hits VERDE on live acceptance (exactly 60%). Caveat: measured on **IQ1_M** (poor quant) → acceptance is a **conservative lower bound** (addendum).

Draft-simple denser drafts improve offline α but stay &lt;60% on campaign IT gens (4B = 54.5% GIALLO).

## Tokenizer gate
Target/MTP/DFlash/Qwen3.5: tok sha16 `49930cc8a75188cf` n=248320 MATCH.  
Qwen3 0.6/1.7B excluded (different tokenizer).

## N1 / N3
Not run (device / Adreno). N3 changes nature if MTP wins (head cost on CPU, not separate GPU draft).

## Crash / recovery note
Nothing measured lost in PC crash. Q8 clean redownload + KEXP Phase A VERIFY_OK completed before N2.

## Artefacts
- `results/spec_ladder/n2/mtp/` live MTP
- `results/spec_ladder/n2/offline_{0.8b,2b,4b}/summary.json`
- `results/spec_ladder/n2/summary_parsed.json`
- `results/requant1c/` Phase A

## STOP
N2 numbers on the table. GO cantiere is gualt's call. N1 still needed for C(k) e2e formula.

## N1 — batch-verify cost (device S23, staccato) 2026-08-10

| k (label) | n_prompt measured | C_med (driver t_decode1=0.154s) | C_med (t1 tok/s=4.75) | note |
|---|---|---|---|---|
| 2 | **15** | 12.2 | 8.9 | calib failed: not true k=2 |
| 4 | **15** | **14.0 ROSSO** | **10.2 ROSSO** | gate metric |
| 8 | **15** | 14.4 | 10.5 | |
| 16 | **16** | 14.3 | 10.4 | closest to intended k |

**Verdetto N1: ROSSO** (C(4) ≫ 3.0). Prefill corto ~2s vs decode ~0.15–0.21s → zero ammortamento GEMM a k≤16 sul path campagna.

Caveat: overhead chatml fa sì che k=2/4/8 misurino n_prompt=15; non cambia il ROSSO (anche C(16)≈10).

