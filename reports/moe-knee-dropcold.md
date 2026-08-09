# Report — ricalibrazione guardrail ABORT_MEM + ginocchio drop-cold F ∈ {0.65, 0.80}

Data: 2026-08-09 · Device: Galaxy S23 (SM-S911U) **UNPLUGGED**  
Binario CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` (verificato, nessun rebuild)  
PREFAULT intatto · Mandato: `mandates/knee-dropcold.md`  
Artefatti: `results/dropcold/knee/` (telefono + mirror PC leggero)  
**Stato mandato: COMPLETE (STOP al report — mai `complete_goal`; sostituzione 0.50 = gualt)**

---

## Parte 1 — ABORT_MEM condizione COMBINATA

### Diff (sintesi)

File: `scripts/lib_guardrails.sh` (commit `74bbb4d`).

| prima | dopo |
|---|---|
| `MemFree < 100 MiB` hold 10 s → `ABORT_MEM` | **ENTRAMBE** hold 10 s: `MemFree < 100 MiB` **E** `die > 85 °C` → `ABORT_MEM` |
| — | Mem bassa + die freddo → solo log flight `MEM_LOW` (una volta per streak), **nessun kill** |
| log `ABORT_MEM` | log `ABORT_MEM_COMBINED` (mf_kb + die_mc nel detail) |
| THERMAL_PAUSE 88 °C / 60 s | **invariato** |
| HARD_STOP 98 °C | **invariato** |

Nuove variabili: `DIE_MEM_COMBINED_MC=85000`, `GR_MEM_COMBINED_S`, `GR_MEM_LOW_LOGGED`, `GR_DRY_RUN`.

### Verifica

- `bash -n scripts/lib_guardrails.sh` → OK (PC + telefono).
- Dry-run harness `scripts/test_guardrails_combined.sh` (GR_DRY_RUN=1, dt=0.5 s, hold=10 s → 22 tick):

| caso | input sintetici | esito atteso | esito |
|---|---|---|---|
| **A** | mf=13 MiB (13312 kB), die=29 °C (29000 mc), 11 s | CONTINUE + log MEM_LOW | **PASS** (`GR_ACTION=CONTINUE`, `GR_MEM_LOW_LOGGED=1`) |
| **B** | mf=13 MiB, die=86 °C (86000 mc), 11 s | ABORT_MEM | **PASS** (`combined_s=11.0`, detail con die+mf) |
| C (extra) | mf=500 MiB, die=86 °C | CONTINUE | PASS |
| D (extra) | mf=13 MiB, die=86 °C, solo 5 s | CONTINUE | PASS |

Log apply path: `GUARDRAIL,…,ABORT_MEM_COMBINED,mf_kb=13312 die_mc=86000 …`.  
Push telefono: `~/experiments/scripts/lib_guardrails.sh` · `PHONE_bash_n_OK`.

---

## Parte 2 — ginocchio F ∈ {0.65, 0.80}

### Condizioni

| | inizio | fine |
|---|---|---|
| plugged | UNPLUGGED | UNPLUGGED |
| batteria % | 69 | **29** (floor toccato a fine F=0.80 twin; sweep **completato** prima dello stop poller) |
| die start | ~42 °C | ~57 °C peak run |
| nproc | 6–8 (ri-promozione adb) | 6–8 |
| pin | `1ca51420…` | invariato |
| screen_off_timeout | 1800000 → 7200000 | **ripristinato 1800000** |
| corpus | `corpus_subset_10k.txt` sha `46efe834…` | n_scored=10098 |
| prompt twin | f45_1 sha `bc5c1e58…` | n=200 |
| baseline PPL | **2.095450** (G2 decode-path) | |
| baseline byte | **49.05 MiB/tok** (twin F=0 storico) | |

Config G-A (flag drop **sovrascritto** esplicitamente per punto):  
`-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 --drop-cold-experts <F>`

Script: `results/dropcold/run_knee_dropcold.sh` (OUTROOT=knee; regole −25%).

### Tabella curva completa 0.25 → 1.00

Punti 0.25 / 0.50 / 1.00 da sweep precedente (`results/dropcold/sweep/`); 0.65 / 0.80 = questo mandato.

| F | thr=F/8 | ppl | ΔPPL vs 2.095450 | MiB/tok | Δbyte% vs 49.05 | hit% | drop% | n_scored | verdetto (regola knee) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 (baseline) | — | 2.0955 | — | 49.05 | — | 77.0 | — | — | baseline |
| 0.25 | 0.03125 | 2.1062 | **+0.0107** | 47.05 | **−4.1%** | 77.6 | ~0 | 10098 | archiviato (storico, −10% rule) |
| **0.50** | 0.0625 | 2.1466 | **+0.0512** | 41.23 | **−15.9%** | 79.0 | 2.2 | 10098 | **ADOTTATO** (default campagna) |
| **0.65** | 0.08125 | **2.19992** | **+0.10447** | **28.59** | **−41.71%** | **82.4** | **6.1** | 10098 | **CANDIDATO_SOSTITUZIONE** |
| **0.80** | 0.10 | **2.26964** | **+0.17419** | **18.54** | **−62.20%** | **85.0** | **11.6** | 10098 | **ARCHIVED_PPL** |
| 1.00 | 0.125 | 2.3568 | **+0.2613** | 10.39 | **−78.8%** | 87.1 | 17.0 | 10098 | archiviato (storico) |

### Dettaglio punti nuovi

**F=0.65** (rc_ppl=0, rc_twin=0, 2226 s ppl):  
ΔPPL **+0.10447 ≤ 0.15** e byte **−41.7% ≤ −25%** → **CANDIDATO SOSTITUZIONE** di 0.50.  
Twin: 28.59 MiB/tok, hit 82.4%, drop 6.1% (3929/64000). tok/s 4.771 **non citabile** (conteggi sì; UNPLUGGED ma non è il gate velocità).

**F=0.80** (rc_ppl=0, rc_twin=0, 2197 s ppl):  
ΔPPL **+0.17419 > 0.15** → **ARCHIVED_PPL** (soglia cumulativa).  
Byte −62.2% sarebbero stati ampi, ma la qualità esce dal budget. Twin: 18.54 MiB/tok, hit 85.0%, drop 11.6% (7419/64000).

### Regole applicate (dichiarate, fisse)

| esito | conclusione | F |
|---|---|---|
| ΔPPL ≤ 0.15 **e** byte ≤ **−25%** | **CANDIDATO SOSTITUZIONE** (velocità da staccato = mandato a parte) | **0.65** |
| ΔPPL ≤ 0.15 ma byte > −25% | archiviato — 0.50 resta | (nessuno in questo knee) |
| ΔPPL > 0.15 | archiviato | **0.80** |

La soglia −25% è più dura del −10% dello sweep originale: qui si cerca un motivo per **spostare** un default già adottato. F=0.65 lo fornisce sui conteggi; la decisione di adozione resta di **gualt** dopo eventuale test velocità da staccato.

### Curva a verbale

```
F     ΔPPL     Δbyte%
0.25  +0.011   −4%
0.50  +0.051   −16%   ← default attuale
0.65  +0.104   −42%   ← CANDIDATO (budget PPL ancora ok)
0.80  +0.174   −62%   ← fuori budget PPL
1.00  +0.261   −79%   ← morto
```

Il ginocchio qualità sta **tra 0.65 e 0.80**: a 0.65 si sta ancora sotto 0.15; a 0.80 si sfora di ~0.024.

---

## Commit / artefatti

| | |
|---|---|
| Parte 1 commit | `74bbb4d` `fix(guardrails): ABORT_MEM becomes combined mem+die` |
| Parte 2 | report + mirror `results/dropcold/knee/` (meta/json/tsv/log; no GGUF/build) |
| Telefono | `~/experiments/results/dropcold/knee/` (full: csv ppl, stdout/stderr) |
| screen_off_timeout | **1800000** ripristinato |

## Blocker / note

- Batteria fine **29%** (floor 30% toccato durante twin F=0.80; **entrambi i punti completati** rc=0).
- Phone poller ha loggato `BATTERY_FLOOR 29` dopo DONE del knee (non ha killato i run).
- Timing tok/s **non citabili** in questo mandato (solo PPL + conteggi).
- **Non** si tocca il default 0.50 senza decisione gualt + eventuale staccato.
- Non toccati: `../ai-chat`, `PLAN.md`, PREFAULT, binario.

**STOP al report.**
