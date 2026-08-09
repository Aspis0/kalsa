# Report — test velocità da STACCATO `--drop-cold-experts 0.50`

Data: 2026-08-09 · Device: Galaxy S23 (SM-S911U) **UNPLUGGED**  
Binario CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`  
PREFAULT intatto · Artefatti: `results/dropcold/speed/` (PC mirror) + `~/experiments/results/dropcold/speed/` (telefono)  
Mandato: `mandates/speed-dropcold.md` · Script: `scripts/run_speed_dropcold.sh`  
**Stato mandato: COMPLETE (STOP al report — adozione di gualt)**

## Disegno (dichiarato prima dei numeri)

| | |
|---|---|
| **A** | F=0, flag assente |
| **B** | `--drop-cold-experts 0.50` (thr=F/k=0.0625) |
| **Celle** | 2 prompt (short + f45_1) × 2 rep × 2 bracci, n=200 |
| **Ordine** | **ABBA per prompt** (A,B,B,A) |
| **Cold** | `fadvise` DONTNEED **prima di ogni run** |
| **Config** | `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8` |
| **Prompt sha** | short `197480d9…`, f45_1 `bc5c1e58…` (verificati) |
| **Batteria** | start **100%** UNPLUGGED 27.0°C → end **93%** UNPLUGGED 38.7°C · floor 30% non toccato |
| **Screen** | `screen_off_timeout` 7200000 durante sessione → **ripristinato 1800000** a fine |

## Tabella A/B (run per run)

Ordine di esecuzione = ABBA short, poi ABBA f45_1.

| run | arm | prompt | eval tok/s | prefill tok/s | hit% | MiB/tok | drop% | memfree_min | die max | VmHWM | wall s | batt | rc |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| A-short-r1 | A | short | **4.910** | 12.3 | 74.1 | 57.15 | 0 | 35 | 91.6 | 3875 | 60 | 100→100 | 0 |
| B-short-r1 | B | short | **4.884** | 11.0 | 74.8 | 53.67 | **2.0** | 34 | 91.6 | 3876 | 61 | 100→100 | 0 |
| B-short-r2 | B | short | **4.638** | 10.8 | 74.8 | 53.67 | **2.0** | 42 | 91.2 | 3877 | 64 | 99→99 | 0 |
| A-short-r2 | A | short | **4.257** | 10.1 | 74.1 | 57.15 | 0 | 48 | 89.9 | 3875 | 69 | 98→98 | 0 |
| A-f45_1-r1 | A | f45_1 | **4.380** | 10.8 | **77.0** | **49.05** | 0 | 29 | 89.5 | 3875 | 69 | 97→97 | 0 |
| B-f45_1-r1 | B | f45_1 | **4.562** | 9.8 | **79.0** | **41.23** | **2.2** | 52 | 80.2 | 3875 | 67 | 97→96 | 0 |
| B-f45_1-r2 | B | f45_1 | **4.234** | 9.5 | **79.0** | **41.23** | **2.2** | 13 | 81.0 | 3877 | 72 | 96→95 | 0 |
| A-f45_1-r2 | A | f45_1 | **4.206** | 10.1 | **77.0** | **49.05** | 0 | 45 | 89.9 | 3878 | 71 | 95→95 | 0 |

`bin_sha256` identico su tutti i run: `1ca51420…`. lmkd_delta = **0** su tutti.

## Mediane e Δ%

| metrica | A (n=4) | B (n=4) | Δ B vs A |
|---|---:|---:|---:|
| **mediana decode tok/s** | **4.3185** | **4.600** | **+6.52%** |
| valori decode | 4.206, 4.257, 4.380, 4.910 | 4.234, 4.562, 4.638, 4.884 | — |
| mediana prefill tok/s | 10.45 | 10.3 | −1.4% (non decisivo) |
| mediana hit% | 75.55 | 76.9 | +1.4 pp |
| mediana MiB/tok | 53.10 | 47.45 | −10.6% |
| mediana drop% B | — | **2.1** | atteso qualità ~2.2 |

## Coerenza col report qualità (`moe-dropcold.md`)

| check | qualità (PLUGGED) | questo test (UNPLUGGED) | esito |
|---|---|---|---|
| A f45 MiB/tok | 49.05 | 49.05 | match |
| A f45 hit% | 77.0 | 77.0 | match |
| B f45 MiB/tok | 41.23 (−15.9%) | 41.23 | match |
| B f45 hit% | 79.0 | 79.0 | match |
| B drop% | 2.2 | 2.0–2.2 (med 2.1) | **coerente** (banda 0.5–6.0) |

Nessun STOP per incoerenza hit/drop.

## Smoke KV con flag ON

Due turni `--session`, n=32, input `gk1_in.jsonl`, `--drop-cold-experts 0.50`.

| turno | n_prompt | n_past |
|---:|---:|---:|
| 1 (`clear_kv=true`) | 39 | **71** |
| 2 (`clear_kv=false`) | **41** | 144 |

**PASS** — `n_past(t1)=71` identico al baseline post-pin (report qualità: n_common=71).  
Nota: il binario emette `n_past` su `BMOE_DONE`, non un campo letterale `n_common`; il significato operativo è lo stesso (prefisso KV riusato). Il drop è decode-only e non ha toccato il prefill della history.

## Sostenuto n=512 (arm B)

Batteria a celle chiuse **94% ≥ 38%** → eseguito (non SKIPPED).

| metrica | valore |
|---|---:|
| eval tok/s | 4.882 |
| prefill tok/s | 10.8 |
| hit% | 74.9 |
| MiB/tok | 53.94 |
| drop% | 2.0 |
| die max | 91.6 °C |
| VmHWM | 3875 MiB |
| memfree_min | 32 MiB |
| wall | 62 s (possibile EOS anticipato; tok/s da contatore generazione) |
| batt | 94→93% |
| rc | 0 |

Die di plateau con drop attivo: picco 91.6 °C, nessun HARD STOP 98 °C, nessun ABORT_MEM.

## Guardrail e lmkd

| evento | conteggio |
|---|---:|
| lmkd delta (somma run) | **0** |
| THERMAL_PAUSE (88 °C/60 s) | 0 |
| ABORT_MEM (MemFree&lt;100 MiB/10 s) | 0 |
| HARD_STOP die 98 °C | 0 |
| PLUGGED mid-run | 0 |
| batt &lt; 30% | 0 |

Flight recorder: `results/dropcold/speed/flight.log` (telefono + mirror).  
Die di picco run-level fino a 91.6 °C (sotto 98; guardrail 88/60s non ha scattato).

## Verdetto (regole del mandato)

Confronto: **mediana decode tok/s dei 4 run B vs 4 run A**.

| soglia | esito misurato |
|---|---|
| B ≥ **+5%** vs A, lmkd 0, guardrail 0 | **+6.52%**, lmkd 0, guardrail 0 |
| hit/drop coerenti | sì (drop med 2.1 ≈ 2.2) |
| smoke KV n_common/n_past=71 | PASS |

→ **CANDIDATO ADOZIONE** — proposta a gualt.

Costo qualità a verbale (da `moe-dropcold.md`, non rimisurato qui): **ΔPPL +0.051** su subset 10k, byte/token −15.9% su twin f45_1.

**L'adozione è di gualt.** Questo report non attiva flag di default, non tocca PREFAULT, non tocca `../ai-chat`, non modifica `PLAN.md`.

## Artefatti

Telefono `~/experiments/results/dropcold/speed/`:
- `runs.csv`, `VERDICT.txt`, `verdict.json`, `STATUS.txt`
- `A/*.summary.txt`, `B/*.summary.txt` (+ sampler/stdout/stderr per run)
- `smoke_kv/{STATUS_SMOKE.txt,smoke_meta.json,smoke.stdout,smoke.stderr}`
- `sostenuto/{STATUS.txt,B-short-n512.summary.txt,…}`
- `flight.log`, `SPEED_DROPCOLD.master.log`, `batt_{start,end}.json`, `prompt_sha256.txt`

PC mirror leggero: `results/dropcold/speed/` (summary + csv + verdict + flight + smoke meta; no GGUF).

Script: `scripts/run_speed_dropcold.sh`, `scripts/fix_smoke_and_sostenuto.sh` (ripresa smoke-parser + sostenuto).

## Note

1. Parser smoke iniziale cercava solo `n_common=` e ha prodotto un falso FAIL; i log `BMOE_DONE` contenevano già `n_past=71` / `n_prompt=41`. Corretto offline sui log senza re-run ABBA.
2. Wall 62 s sul sostenuto n=512 è corto rispetto a 512/4.88≈105 s: sospetto stop EOS; la metrica citabile resta `eval_tok_s` del binario.
3. Prefill B leggermente più lento della mediana A (−1.4%): atteso (cold ogni run; drop non agisce sul prefill di default).
