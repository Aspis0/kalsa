# moe-adopt-kexp

## Parte 1 — adozione formale ✅
- Commit: `5f03add adopt: KEXP as campaign model`
- Default MODEL → KEXP in 41 harness scripts
- Phone: `~/models/CAMPAIGN.gguf` → KEXP; IQ2_M non cancellato
- Baseline: `results/kexp_baseline/` (PPL 1.5249 / 1.5647, floor 2.0955)
- Provenienza Q8: possibile revisione pesi più nuova di IQ2_M 3/8 — a verbale

## Parte 2 — griglia PPL ✅ (floor ≤ 2.0955)
Corpus `corpus_subset_10k`, `--ppl-decode`, KEXP, bin 1ca51420…

| # | k | drop | PPL | Δ vs 1.5249 | verdetto | wall_s |
|---|---|---|---|---|---|---|
| 1 | 8 | 0.80 | **1.597** | +0.07 | **VIVA** | 2185 |
| 2 | 6 | 0.65 | **1.852** | +0.33 | **VIVA** | 2495 |
| 3 | 8 | 1.00 | **1.682** | +0.16 | **VIVA** | 2170 |
| 4 | 6 | 0.80 | **1.965** | +0.44 | **VIVA** | 2214 |
| 5 | 7 | 0.80 | — | — | SKIP (k=6 ha tenuto) | — |
| 6 | 6 | 1.00 | **2.136** | +0.61 | **MORTA** (> floor) | 1945 |

Default campagna attuale (riferimento, non in griglia): k=8 drop=0.65 → PPL **1.5647**.

### Sopravvissute (ordinate per aggressività compute attesa)
1. **k=6 drop=0.80** — PPL 1.965 (max pruning+drop vivo)
2. **k=6 drop=0.65** — PPL 1.852 (−25% GEMV top-k)
3. k=8 drop=1.00 — PPL 1.682 (max drop, top-8)
4. k=8 drop=0.80 — PPL 1.597 (mild)

## Parte 3 — velocità ✅ (STACCATO UNPLUGGED)

- Script: `results/kexp_grid/run_kexp_speed_grid.sh`
- Phone out: `~/experiments/results/kexp_grid/speed/` → host `results/kexp_grid/from_phone_speed/`
- Window: 2026-08-10 21:03–21:18 EDT · batt 98%→92% end-of-sos (host later 86%) · T~28–32°C · bin `1ca51420…` · model KEXP
- Protocollo: cold per cella · n=200 · 2 prompt (short, f45_1) × 2 rep · ordine ABBA-ish · vincitore = mediana tok/s; entro 2% → PPL migliore · poi sos n=512

### Celle n=200 (tok/s decode)

| label | cfg | k | drop | prompt | rep | tok/s | prefill | hit% | drop% | wall_s | n_gen | batt |
|-------|-----|---|------|--------|-----|-------|---------|------|-------|--------|-------|------|
| p1_c1_r1 | k6d080 | 6 | 0.80 | short | 1 | **7.531** | 12.5 | 78.8 | 11.0 | 46 | 200 | 98 |
| p1_c2_r1 | k6d065 | 6 | 0.65 | short | 1 | 6.426 | 12.7 | 75.9 | 5.1 | 51 | 199 | 97 |
| p1_ctrl_r1 | k8d065 | 8 | 0.65 | short | 1 | 5.323 | 10.3 | 75.7 | 7.2 | 61 | 200 | 97 |
| p1_ctrl_r2 | k8d065 | 8 | 0.65 | short | 2 | 5.207 | 10.0 | 75.7 | 7.2 | 63 | 200 | 96 |
| p1_c2_r2 | k6d065 | 6 | 0.65 | short | 2 | 5.922 | 11.0 | 75.9 | 5.1 | 56 | 199 | 95 |
| p1_c1_r2 | k6d080 | 6 | 0.80 | short | 2 | 6.127 | 10.6 | 78.8 | 11.0 | 56 | 200 | 95 |
| p2_c1_r1 | k6d080 | 6 | 0.80 | f45_1 | 1 | 5.612 | 10.9 | 82.7 | 9.9 | 59 | 200 | 95 |
| p2_c2_r1 | k6d065 | 6 | 0.65 | f45_1 | 1 | 5.413 | 10.3 | 79.7 | 4.6 | 61 | 200 | 94 |
| p2_ctrl_r1 | k8d065 | 8 | 0.65 | f45_1 | 1 | 4.847 | 8.8 | 79.0 | 7.3 | 68 | 200 | 94 |
| p2_ctrl_r2 | k8d065 | 8 | 0.65 | f45_1 | 2 | 5.111 | 9.0 | 79.0 | 7.3 | 66 | 200 | 93 |
| p2_c2_r2 | k6d065 | 6 | 0.65 | f45_1 | 2 | 5.799 | 10.0 | 79.7 | 4.6 | 60 | 200 | 93 |
| p2_c1_r2 | k6d080 | 6 | 0.80 | f45_1 | 2 | 5.435 | 10.1 | 82.7 | 9.9 | 61 | 200 | 92 |

### Mediane tok/s (4 celle/cfg, n=200)

| cfg | k | drop | med tok/s | PPL (parte 2) | vs ctrl |
|-----|---|------|-----------|---------------|---------|
| **k6d080** | 6 | 0.80 | **5.870** | 1.965 | **+13.8%** |
| **k6d065** | 6 | 0.65 | **5.861** | **1.852** | **+13.6%** |
| k8d065 (ctrl) | 8 | 0.65 | 5.159 | 1.565 | — |

Regola tie: k6d080 ed k6d065 entro **2%** (Δ med ~0.15%) → preferisci PPL → **winner = k6d065**.

### Sostenuto winner

| label | cfg | n_req | n_gen | tok/s | prefill | hit% | drop% | wall_s | batt | note |
|-------|-----|-------|-------|-------|---------|------|-------|--------|------|------|
| sos_k6d065_n512 | k6d065 | 512 | **199** | 5.471 | 10.0 | 75.9 | 5.1 | 60 | 92 | **EOS early** su short — non full 512 |

Sostenuto non ha raggiunto n=512 (stop naturale ~199 token su `short.txt`). Decode rate comunque allineata alle celle n=200 della stessa cfg.

### Default adottato (gualt 2026-08-10) — **OPZIONE A**

| opzione | k | drop | PPL | med tok/s | stato |
|---------|---|------|-----|-----------|--------|
| **A** | **6** | **0.65** | **1.852** | **5.86** | **ADOTTATO** |
| B | 6 | 0.80 | 1.965 | 5.87 | scartata (speed pari, PPL peggiore) |
| C | 8 | 0.65 | 1.565 | 5.16 | scartata (status quo più lento) |

**Propagazione harness (2026-08-10):**
- `scripts/f55a_ppl_baseline.sh`
- `scripts/run_staccato.sh`, `run_staccato2.sh`
- `scripts/start_f4_5_quality.sh`, `start_f4_7_batt_curve.sh` (+ `--n-expert-used 6 --ubatch 512`)
- `scripts/fix_smoke_and_sostenuto.sh`, `retry_adopt_aborted.sh`
- rewrite list: `results/kexp_baseline/campaign_k6d065_rewrite_list.txt`
- `PLAN.md` scheda prodotto aggiornata

**Non toccati (di proposito):** A/B storici (`run_speed_dropcold*`, `run_f4` celle k, `start_f5_2` sweep, `f56_*`); orchestrator trial Marco (run in corsa con KEXP a k=8 — non contaminare il trial mid-flight).

## Deliverable paths
- `results/kexp_baseline/`
- `results/kexp_grid/from_phone/` (PPL)
- `results/kexp_grid/from_phone_speed/` (speed)
- `results/kexp_grid/run_kexp_speed_grid.sh`
- `reports/moe-adopt-kexp.md` (this file)
