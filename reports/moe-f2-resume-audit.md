# F2 resume audit — offline PC artifacts only — 2026-08-04

Source: `results/runs.csv` (32 data rows), `results/f2/**`, `scripts/run_f2_*.sh`,
`scripts/start_f2_*.sh`, `reports/moe-f2.md`, `PLAN.md` F2 + §8.2 + revision note.
No phone access. No inferred CSV rows.

## Protocol rules applied (PLAN §8.2 + 2026-08-04 revision)

| Rule | Compliant value |
|---|---|
| Declared start config | t=5, ctx=1024, kv=q8_0 |
| Cooldown idle | ≥180 s before every rep |
| Sentinel cool start | batt temp ≤30.0°C before every rep |
| Absolute reject | batt temp >32.0°C / plugged ≠ UNPLUGGED |
| Reps | 3 per cell; median; one variable at a time |
| majflt | >50k = high-majflt (pressure); baseline median prefers low-majflt |
| Sentinel | re-run stage winner; drift >15% → stage invalid, redo |
| Phase tags for valid work | **F2.2c** / **F2.3c** only |
| Binary | `…/build-safe/bin/llama-cli` only |
| Every run | CSV row + raw log |

## Inventory (`results/runs.csv`)

| phase | n rows | model | compliant for gate medians? |
|---|---:|---|---|
| F1 | 1 | Qwen3.5-4B-Q4_K_M | n/a (F1 gate) |
| F2.2 | 18 | Qwen3.5-4B-Q4_K_M | **NO — all legacy/noncompliant** |
| F2.3 | 13 | LFM2-8B-A1B-Q4_K_M | **NO — all legacy/noncompliant** |
| F2.2c | **0** | — | none yet |
| F2.3c | **0** | — | none yet |

`flags` empty on all 31 F2.2/F2.3 rows; `ttft_ms` empty on all 31 (harness nit; not fabricated).

See also: `results/f2/LEGACY_NONCOMPLIANT.md`.

---

## F2.2 cell matrix (phase=F2.2 only — present rows)

Declared start for **compliant** redo is t=5/c=1024; legacy grid measured t=4 first and
finished claiming best t=4 c=512 kv=q8_0 median 8.70 (invalid).

| cell (t,c,kv) | reps present | eval_tok_s | majflt_delta | T_start | cool≤30 | notes |
|---|---:|---|---|---|---|---|
| 4,1024,q8_0 | 3 | 5.40, 5.30, 3.60 | 71228, 381129, 301418 | 28.4–29.5 | 3/3 | all HIGH majflt |
| 5,1024,q8_0 | 3 | 4.30, 5.30, 4.70 | 179578, 450140, 314714 | 29.9–30.4 | 1/3 | hot starts |
| 6,1024,q8_0 | 3 | 4.20, 4.20, 3.90 | 251437, 282210, 242693 | 29.9–30.9 | 1/3 | hot starts |
| 4,512,q8_0 | 3 | 5.90, 8.90, 8.70 | 522, 11707, 191837 | 28.0–31.0 | 1/3 | mixed rest/hot; 2 LOW majflt |
| 4,4096,q8_0 | 3 | 8.50, 5.50, 4.90 | 111751, 202741, 218054 | 31.2–31.7 | 0/3 | progressive thermal drop |
| 4,512,f16 | 3 | 4.80, 5.50, 5.30 | 254468, 342419, 155984 | 31.0–31.2 | 0/3 | |

**Valid under updated rules: 0 / 18.**

Why every F2.2 row is noncompliant (any one is enough):

1. **Cooldown**: runner used ~15–25 s idle (resume script `--cooldown 20`). Start-to-start gap
   08:33:19→08:34:13 = **54 s** proves idle ≪ 180 s. Early morning gaps ≥180 s are mostly
   *run duration*, not documented idle cooldown (runner log shows no 180 s sleep).
2. **Cool gate**: only ≤32°C; 12/18 starts at T>30.0.
3. **No sentinel** after stages (runner log ends without sentinel).
4. **majflt**: 16/18 HIGH (>50k); legacy medians mixed regimes.
5. **Phase tag** F2.2 ≠ F2.2c; protocol not the 2026-08-04 ruleset.
6. **Declared start** not respected as measurement seed discipline (grid began at t=4).

Missing for **F2.2c** (nothing present):

| stage | cells × reps | status |
|---|---|---|
| threads @ c=1024 kv=q8_0 | {4,5,6} × 3 + 1 sentinel | **0/9 + sentinel** |
| ctx @ best_t kv=q8_0 | {512,1024,4096} × 3 + sentinel | **0** (c=1024 may skip if already filled by threads) |
| kv @ best_t best_c | {f16,q8_0} × 3 + sentinel | **0** |

---

## F2.3 cell matrix (phase=F2.3 only)

| cell (t,c,kv) | reps | eval_tok_s | majflt | T_start | cool≤30 |
|---|---:|---|---|---|---|
| 4,1024,q8_0 | 3 | 5.50, 5.20, 7.00 | ~2.8–2.9M HIGH | 31.2–31.8 | 0/3 |
| 5,1024,q8_0 | 3 | 1.20, 4.20, 5.10 | high / 0 / high | 31.5–32.0 | 0/3 |
| 6,1024,q8_0 | 3 | 1.50, 3.70, 5.90 | ~2.6–3.4M HIGH | 31.5–31.8 | 0/3 |
| 4,512,q8_0 | 3 | 21.90, 0.90, 4.30 | multi-M HIGH | 31.2–32.0 | 0/3 unstable |
| 4,4096,q8_0 | **1** | 6.20 | 3388295 HIGH | 31.3 | 0/1 |
| kv stage | 0 | — | — | — | — |

**Valid under updated rules: 0 / 13.** Incomplete (ctx 4096 1/3; kv not run). Protocol:
cooldown 25 s, no ≤30 gate, no sentinel, majflt multi-million (page-cache pressure).

Missing for **F2.3c**: full grid (same shape as F2.2c), phase tag F2.3c, size gate
5044779712 (PC local GGUF matches; phone re-check at run time).

---

## F2.1 / F2.4

| subphase | status on PC |
|---|---|
| F2.1 fio | DONE (`results/fio_runs.csv`, report numbers) |
| F2.4 thermal | NOT RUN; script `scripts/run_f2_thermal.sh` ready (build-safe, cool start ≤30, no download) |

---

## Explicit next-run order (when phone UNPLUGGED and cool)

Do **not** resume legacy `F2.2` / `F2.3` phases. Do **not** use
`start_f2_2_resume.sh` or `start_f2_3.sh` (now hard-refuse).

1. **Preflight (operator)**  
   - Cable unplugged; wireless debug / ssh ready.  
   - `termux-battery-status` → UNPLUGGED, temp ≤30.0°C preferred (≤32 hard).  
   - Binary: `$HOME/src/llama.cpp/build-safe/bin/llama-cli` pin 67d5978.  
   - No residual `run_f2_grid` / `run_bench` / `llama-cli` PIDs (stop by exact PID, no broad pkill).  
   - Models on phone: Qwen3.5-4B Q4_K_M; LFM2 size **5044779712**.

2. **F2.2c first (mandatory thread redo under compliant cooldown)**  
   ```bash
   bash $HOME/experiments/scripts/start_f2_2c.sh
   ```
   - Phase **F2.2c**, cooldown **180**, cool **≤30.0**, start seed **t=5 c=1024 kv=q8_0**.  
   - Order: threads {4,5,6} → ctx {512,1024,4096} → kv {f16,q8_0}; 3 reps; sentinel each stage.  
   - Skip only counts phase=F2.2c rows → legacy F2.2 never blocks / never duplicates valid cells.  
   - Every rep: CSV + raw log under `results/logs/`.

3. **F2.3c** (only after F2.2c grid complete or operator explicitly prioritizes product baseline)  
   ```bash
   bash $HOME/experiments/scripts/start_f2_3c.sh
   ```
   - Size gate 5044779712; same protocol; **no network download**.

4. **F2.4 thermal** (after F2.2c best known; defaults t=4 c=512 until best promoted)  
   ```bash
   bash $HOME/experiments/scripts/run_f2_thermal.sh
   ```

5. **Pull to PC** after each stage: `runs.csv`, `results/logs/*`, `f2_grid_state/F2.2c.*`.

6. **Gate F2** remains open until: F2.1 (done) + F2.2c complete + F2.3c measured + F2.4 curve.
   Legacy 8.70 tok/s claim is **not** a gate input.

---

## Script safety findings (pre-patch → post-patch)

| Issue | File | Fix |
|---|---|---|
| Broad `pkill -f`, cooldown 20, phase F2.2 | `start_f2_2_resume.sh` | Hard refuse → use `start_f2_2c.sh` |
| Broad `pkill -f`, cooldown 25, phase F2.3 | `start_f2_3.sh` | Hard refuse → use `start_f2_3c.sh` |
| Legacy phases accepted; cooldown could be lowered | `run_f2_grid.sh` | Refuse F2.2/F2.3; floor cooldown≥180; cool ceiling≤30 |
| Sentinel redo skipped existing rows | `run_f2_grid.sh` | need=REPS×attempt; median last REPS |
| Cooldown after run only | `run_f2_grid.sh` | idle **before** every rep + cool gate |
| Starters weak on charge/API | `start_f2_2c.sh`, `start_f2_3c.sh` | fail-closed charge / missing battery / >32°C |
| LFM2 size | `start_f2_3c.sh` + grid F2.3c | exact 5044779712; no download |
| Old build tree | grid + thermal | refuse `build/bin`; require `build-safe` |

## What is intentionally not done here

- No adb/ssh/phone execution.  
- No fabricated measurements or CSV edits inventing runs.  
- No PLAN.md / goal file edits.  
- No commit.

DONE
