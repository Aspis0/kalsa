# F4.9 — Regime valido, scollegato

**Data:** 2026-08-07  
**Host:** Samsung S23 (SM-S911U), Termux SSH `u0_a344@192.168.1.152:8022`  
**Stato alimentazione:** **UNPLUGGED** per tutto il mandato (inizio cella A 100% / 27.4°C → fine cella B 88% / 38.2°C)  
**Runtime:** `bmoe-cli` 0.19.0, commit build **`b0c4e5b`**, binario `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli`  
**Modello:** `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size gate **11522702304 B**  
**Config gate (fissa):** `-t 4 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4` + `--moe-stream`  
**LD_LIBRARY_PATH:** dir del binario (`…/build-bmoe/cli` + parent)  
**Artefatti grezzi:** `results/f4.9/` (mirror da `~/experiments/results/f4.9/`) + `results/runs.csv`  
**HEAD repo al resume:** `379d851` (mandato citava `98a27b6` = antenato M5b; non rifatto rebase)

---

## 1. Cella A — F4.9-batt-control (verifica completezza)

### Setup
- Prompt short (benchmark gate), `n_gen=64`, `n_ctx=512`, config gate.
- 3 rep (1 cold fadv + 2 warm) + sentinella warm.
- Gate termico **T≤30.0°C**, cooldown 180 s, batteria **≥90%**, top-app (`nproc≥6`).
- Phase tag: `F4.9-batt-control`.

### Regola di decisione (dichiarata prima)
| mediana warm | verdetto |
|---|---|
| ~5.02 (±3%) | scalino sotto 13% in F4.7 era **REALE** (curva batteria valida) |
| ~4.87 o più bassa | era **DERIVA** (curva F4.7 da buttare) |
| in mezzo | riportare |

### Tabella grezza (4/4 valide, eval non vuoto)

| run_id (suffix) | tipo | eval tok/s | batt% | T_start→end °C | nproc | mask | note |
|---|---|---:|---:|---|---:|---|---|
| …-082535 | cold | **5.02** | 100 | 27.4→30.9 | 8 | ff | cold=fadv |
| …-082921 | warm | **5.06** | 100 | 29.3→30.4 | 8 | ff | |
| …-083307 | warm | **4.87** | 99 | 29.6→32.6 | 7 | df | |
| …-083655 | sentinel warm | **5.01** | 98 | 29.9→31.5 | 8 | ff | |

- Warm (incl. sentinel): 5.06, 4.87, 5.01 → **mediana 5.01**.  
- Δ vs 5.02: +0.8%, −3.0%, −0.2% (tutte entro ±3%).  
- Anti-drift sentinella vs mediana misure (4.965): |5.01−4.965|/4.965 ≈ **0.9%** ≤15% → OK.  
- Batteria A: 100% → 98% (sempre ≥90%).

### Verdetto A
**SCALINO SOTTO 13% ERA REALE** (curva F4.7 **valida**, non deriva di sessione).  
Mediana warm **5.01 tok/s** ≈ 5.02 (±3%). Cella A **COMPLETA** (nessuna rep rifatta in questo turno).

---

## 2. Cella B — F4.9-real-workload

### Setup
- Prompt: `prompts/long_conversational_it.txt`, `n_gen=512`, config gate.  
- **`n_ctx=2048`** (deviazione dichiarata: prompt lungo; n_ctx=512 → FAIL rc=1 senza timings).  
- Target: 2 rep measure + 1 sentinella.  
- Gate termico **T≤31.5°C SOLO cella B** (steering gualt; carico lungo ~+6.6°C/rep).  
- Sampler 500 ms: `/proc/<pid>/io` (read_bytes, rchar) + max thermal_zone `cpu-*` + VmRSS.

### Regola di decisione (dichiarata prima, mediana rep valide)
| condizione | verdetto |
|---|---|
| stall/decode ≤25% **e** compute ≥0.11 s/tok | **COMPUTE-BOUND CONFERMATO** (kernel IQ2 = priorità; ramo I/O chiuso) |
| stall/decode ≥45% | ramo I/O si **RIAPRE** |
| in mezzo | riportare scomposizione completa |

### Righe scartate (eval mancante = non valide)
| run_id | motivo | n_ctx |
|---|---|---|
| …-084455 | FAIL rc=1; no timings in log (`n_ctx=512` insufficiente) | 512 |
| …-084900 | FAIL rc=1; no timings in log (`n_ctx=512`) | 512 |

Restano in `runs.csv` come FAIL storici; **non** entrano in mediana né in verdetto.

### Tabella grezza rep valide (+ batt_temp obbligatorio)

| run_id | rep | eval tok/s | decode s/tok | compute | stall | stall/decode | flash_io | mib_tok | MiB/s | batt% | T_batt start→end | load_s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| …-085439 | 1 (cold fadv) | **6.07** | 0.165 | **0.124** | 0.034 | **20.6%** | 0.139 | 33.96 | 245 | 96→94 | **29.9→36.5** | 115 |
| …-091224 | 2 warm | **5.40** | 0.185 | **0.141** | 0.038 | **20.5%** | 0.148 | 33.96 | 229 | 93→91 | **29.3→36.4** | 126 |
| …-092439 | sentinel warm | **4.59** | 0.218 | **0.166** | 0.045 | **20.6%** | 0.170 | 33.96 | 200 | 90→88 | **31.4→38.2** | 144 |

- Mediana eval (3 valide): **5.40 tok/s** (misure 6.07 / 5.40 → med **5.735**; sentinella 4.59).  
- **Anti-drift sentinella:** |4.59 − 5.735| / 5.735 ≈ **20.0% > 15%** → **FAIL anti-drift** (dichiarato; non nascosto).  
  - Contesto: sentinella partita a T_batt=31.4 (gate 31.5), fine 38.2; load_s 144 vs 115–126; compute sale 0.124→0.166 (stesso stall/decode ~20.6%).  
- Mediana stall/decode: **20.6% ≤ 25%**.  
- Mediana compute: **0.141 ≥ 0.11 s/tok**.  
- `mib_tok` costante **33.96** (scollegato, ~34 MiB/token di expert traffic dichiarato dal binario).  
- `read_bytes_delta` ~42.1–42.3 GiB per rep n_ctx=2048 (coerente con load+decode stream).

### Curva temperatura die (max cpu-* thermal, 500 ms)

**Rep 2** (`sample_F4.9-real-workload_2_warm.csv`, n=66, cover load→fine):

| t (s) | die °C | note |
|---:|---:|---|
| 0 | 53.9 | attach |
| 6.5 | 77.8 | load |
| 23–50 | 89–**92.0** | picco a t≈40 s |
| 70–90 | 78–86 | decode |
| 125 | 70.9 | fine |

**Sentinel** (`sample_…_sentinel_warm.csv`, n=83; attach nativo su pid transitorio 16303 + sampler esterno su 16442 — campioni parzialmente raddoppiati/gap su io, **temp die usabile**):

| t (s) | die °C |
|---:|---:|
| 0 | 55.1 |
| ~47–53 | 88.7–**90.3** picco |
| 100–140 | 67–75 |

**Rep 1 sample** solo 6 punti (sampler attach tardi, post-load): die 71–79°C — **non** usabile per curva completa; metriche tok da CSV restano valide.

### Correlazione T_batt ↔ tok/s (verificabile a posteriori)

| rep | T_start | T_end | ΔT | eval |
|---|---:|---:|---:|---:|
| 1 | 29.9 | 36.5 | +6.6 | 6.07 |
| 2 | 29.3 | 36.4 | +7.1 | 5.40 |
| sentinel | 31.4 | 38.2 | +6.8 | 4.59 |

Autoriscaldamento ~6.6–7.1°C/rep domina; la sentinella parte già più calda (31.4) e chiude a 38.2 con eval più basso. stall/decode resta piatto ~20.6% → il calo tok/s è sul **compute** (0.124→0.166), non su stall I/O.

### Verdetto B
**COMPUTE-BOUND CONFERMATO.**  
stall/decode mediana **20.6% ≤ 25%** e compute mediana **0.141 ≥ 0.11 s/tok**.  
→ priorità **kernel IQ2**; **ramo I/O chiuso** per questo regime.  
Tok/s carico reale (prodotto): mediana misure **5.74** / mediana 3-valide **5.40** (gate short era ~5.02 su n_gen=64).  
**Caveat metrologico:** anti-drift sentinella **FAIL (20% > 15%)** — la terza rep non replica la mediana; scomposizione stall/decode resta stabile, il drift è sul compute termico.

---

## 3. Cosa NON dice questo mandato

- Non misura qualità del testo generato (solo throughput e scomposizione tempo).  
- Non confronta quantizzazioni diverse né policy cache (già chiuse in M5/M5b).  
- Non stabilisce se il FAIL anti-drift B sia solo termico o anche cpuset/mask (nproc 7–8, mask variabile df/bf/ff).  
- Sample rep1 incompleto; sample sentinel con doppio writer (script nativo + residual `f49_sampler.sh` da sessione precedente) → curve die OK, serie io con gap.  
- Non ricalibra la curva F4.7 punto-per-punto: solo il test di non-deriva a batteria alta sul gate short.

---

## 4. Deviazioni (dichiarate)

1. **Gate termico 31.5°C solo cella B** (carico lungo; A resta 30.0). Sentinella B partita a 31.4 ≤ 31.5.  
2. **`n_ctx=2048`** su B (prompt long_conversational_it; n_ctx=512 → due FAIL scartati).  
3. **2 righe B scartate** (…-084455, …-084900): eval mancante / FAIL rc=1.  
4. HEAD lavoro `379d851` (non `98a27b6` del brief); binario e size gate invariati.  
5. Sampler sentinel: attach nativo su pid 16303 (effimero) + sampler esterno già presente su 16442 — dichiarato, non “aggiustato”.  
6. Anti-drift B sentinella **fuori soglia 15%** — riportato, non scartato a posteriori.

---

## 5. Ambiente fine mandato

| grandezza | valore |
|---|---|
| plugged | UNPLUGGED |
| battery_pct | **88%** |
| T_batt | **38.2°C** |
| nproc | 7 (top-app) |
| processi residuali bmoe/run_bench | **clean** |
| DONE_B | `2026-08-07T09:27:09-04:00 valid=3` |

---

## 6. Gate / stop

- Cella A completa e verificata; verdetto **REALE**.  
- Cella B: 2 measure + 1 sentinel valide; verdetto **COMPUTE-BOUND**; anti-drift FAIL dichiarato.  
- Log/campionamenti pullati in `results/f4.9/`.  
- **STOP** al gate F4.9 (nessun complete_goal, PLAN.md non toccato).
