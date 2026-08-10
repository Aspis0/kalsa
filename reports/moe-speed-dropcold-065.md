# Report — velocità da STACCATO: F=0.65 vs default 0.50 (gate di SOSTITUZIONE)

Data: 2026-08-09 · Device: Galaxy S23 (SM-S911U) **UNPLUGGED**  
Binario CAMPAIGN: `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`  
PREFAULT intatto · Artefatti: `results/dropcold/speed065/` (PC mirror) + `~/experiments/results/dropcold/speed065/` (telefono)  
Mandato: `mandates/speed-dropcold-065.md` · Script: `scripts/run_speed_dropcold_065.sh`  
**Stato mandato: COMPLETE (STOP al report — sostituzione di gualt)**

## Disegno (dichiarato prima dei numeri)

| | |
|---|---|
| **A** | `--drop-cold-experts 0.50` (default campagna attuale) |
| **B** | `--drop-cold-experts 0.65` (override esplicito) |
| **Celle** | 2 prompt (short + f45_1) × 2 rep × 2 bracci, n=200 |
| **Ordine** | **ABBA per prompt** (A,B,B,A) |
| **Cold** | `fadvise` DONTNEED **prima di ogni run** |
| **Config** | `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 --drop-cold-experts <F>` |
| **Prompt sha** | short `197480d9…`, f45_1 `bc5c1e58…` (verificati) |
| **Batteria** | start **76%** UNPLUGGED 28.2°C → end **68%** UNPLUGGED 37.9°C · floor 30% non toccato |
| **Screen** | `screen_off_timeout` 7200000 durante sessione (ripristino 1800000 a fine sessione S1) |
| **Gate** | non-regressione: mediana decode B ≥ A − **2%** → SOSTITUZIONE RACCOMANDATA |
| **Banda B attesa (knee, twin f45)** | MiB/tok ≈ 28.6 ±10%, hit ≈ 82.4, drop ≈ 6.1% |

## Tabella A/B (run per run)

Ordine di esecuzione = ABBA short, poi ABBA f45_1.

| run | arm | prompt | eval tok/s | prefill tok/s | hit% | MiB/tok | drop% | memfree_min | die max | VmHWM | wall s | batt | rc |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| A-short-r1 | A | short | **5.004** | 11.0 | 74.8 | 53.67 | 2.0 | 22 | 92.0 | 3870 | 61 | 76→75 | 0 |
| B-short-r1 | B | short | **5.119** | 10.5 | 78.4 | 39.19 | **6.5** | 50 | 92.4 | 3873 | 60 | 75→74 | 0 |
| B-short-r2 | B | short | **4.928** | 10.5 | 78.4 | 39.19 | **6.5** | 19 | 91.2 | 3875 | 62 | 74→73 | 0 |
| A-short-r2 | A | short | **4.135** | 10.0 | 74.8 | 53.67 | 2.0 | 46 | 84.3 | 3874 | 71 | 73→72 | 0 |
| A-f45_1-r1 | A | f45_1 | **4.500** | 10.0 | **79.0** | **41.23** | 2.2 | 25 | 82.2 | 3875 | 68 | 72→72 | 0 |
| B-f45_1-r1 | B | f45_1 | **4.466** | 10.4 | **82.4** | **28.59** | **6.1** | 26 | 89.1 | 3876 | 68 | 71→71 | 0 |
| B-f45_1-r2 | B | f45_1 | **4.404** | 9.7 | **82.4** | **28.59** | **6.1** | 55 | 83.5 | 3877 | 69 | 71→70 | 0 |
| A-f45_1-r2 | A | f45_1 | **4.288** | 10.4 | **79.0** | **41.23** | 2.2 | 17 | 89.5 | 3876 | 70 | 70→69 | 0 |

`bin_sha256` identico su tutti i run: `1ca51420…`. lmkd_delta = **0** su tutti.

## Mediane pooled e per-prompt

### Pooled (4 run A vs 4 run B)

| metrica | A (n=4) | B (n=4) | Δ B vs A |
|---|---:|---:|---:|
| **mediana decode tok/s** | **4.394** | **4.697** | **+6.90%** |
| valori decode | 4.135, 4.288, 4.500, 5.004 | 4.404, 4.466, 4.928, 5.119 | — |
| mediana prefill tok/s | 10.2 | 10.45 | +2.5% |
| mediana hit% | 76.9 | 80.4 | +3.5 pp |
| mediana MiB/tok | 47.45 | 33.89 | −28.6% |
| mediana drop% | 2.1 | **6.3** | — |

### Per-prompt (lezione A/B precedente: il pooling gonfia i Δ)

| prompt | med A | med B | Δ B vs A |
|---|---:|---:|---:|
| **short** | 4.5695 | 5.0235 | **+9.94%** |
| **f45_1** | 4.394 | 4.435 | **+0.93%** |

Entrambe le viste per-prompt sono ≥ A − 2%. La pooled +6.90% è spinta da short; f45_1 è quasi parità (+0.93%).

## Coerenza banda B (knee twin f45)

Il mandato e `moe-knee-dropcold.md` fissano la banda su **twin f45**, non sul pooled short+f45.

| check | atteso (knee f45) | misurato B f45 (n=2) | esito |
|---|---|---|---|
| MiB/tok | 28.6 ±10% → [25.74, 31.46] | **28.59** | **match** |
| hit% | ≈ 82.4 | **82.4** | **match** |
| drop% | ≈ 6.1 | **6.1** | **match** |

B short: MiB/tok=39.19, hit=78.4, drop=6.5 (traffico short diverso; non è la banda knee).  
A f45: MiB/tok=41.23, hit=79.0, drop=2.2 (coerente con `moe-speed-dropcold.md` / adozione 0.50).

**Nota sul verdetto automatico dello script:** `verdict.json` ha emesso `STOP_INCOHERENT_BANDA` perché ha confrontato la **mediana pooled** MiB/tok B (33.89 = media di 39.19 short + 28.59 f45) con la banda knee 28.6±10%. Quella banda è dichiarata sul twin f45; sul f45 i numeri sono identici al knee. Il verdetto umano sotto usa la regola di coerenza del mandato (f45), non il pooled.

## Smoke KV con B (F=0.65)

Due turni `--session`, n=32, input `gk1_in.jsonl`, `--drop-cold-experts 0.65`.

| turno | n_prompt | n_past |
|---:|---:|---:|
| 1 (`clear_kv=true`) | 39 | **71** |
| 2 (`clear_kv=false`) | **41** | 144 |

**PASS** — `n_past(t1)=71` invariato (stesso baseline post-pin). Drop decode-only, KV history intatta.

## Sostenuto n=512 (arm B)

Batteria a celle chiuse **69% ≥ 38%** → eseguito.

| metrica | valore |
|---|---:|
| eval tok/s | 4.230 |
| prefill tok/s | 8.9 |
| hit% | 78.4 |
| MiB/tok | 39.19 |
| drop% | 6.5 |
| die max | **76.6 °C** |
| die mediano (sampler) | **68.9 °C** |
| die p90 | 75.3 °C |
| VmHWM | 3875 MiB |
| memfree_min | 52 MiB |
| wall | 71 s (EOS anticipato probabile; citare `eval_tok_s`) |
| batt | 69→68% |
| rc | 0 |

### Confronto termico (ipotesi: −42% I/O → scalda MENO)

| riferimento | die |
|---|---|
| Cella 4 storico (campagna) | ~**68 °C** |
| Giro finale adozione 0.50 | **79.8 °C** |
| Questo sostenuto B=0.65 (mediana sampler) | **68.9 °C** |
| Questo sostenuto B=0.65 (max) | **76.6 °C** |

Picco sostenuto 76.6 °C è **sotto** il 79.8 del giro finale a 0.50; mediana 68.9 ≈ storico Cella 4. Ipotesi “scalda meno” **compatibile** su questo singolo run (n=1, non A/B termico formale).

## Guardrail e lmkd

| evento | conteggio |
|---|---:|
| lmkd delta (somma run) | **0** |
| THERMAL_PAUSE (88 °C/60 s) | 0 |
| ABORT_MEM (MemFree&lt;100 MiB/10 s) | **0** |
| HARD_STOP die 98 °C | 0 |
| PLUGGED mid-run | 0 |
| batt &lt; 30% | 0 |

Flight recorder: 117 tick, **sempre UNPLUGGED**, die max flight 90.8 °C, batt 76→68.

### Nota ABORT_MEM combinato (lib `74bbb4d`)

- `memfree_min` run-level: 17–55 MiB (tutti &lt; 100 MiB).
- Flight: **54/117 tick** con MemFree &lt; 100 MiB.
- Il guardrail combinato **non ha abortito** nessun run (tutti rc=0).
- Interpretazione: la soglia “&lt;100 MiB per 10 s continui” o la logica combinata **tace sui memfree bassi normali** di questo workload (cache 2000 MiB + stream), oppure il sampler/flight e il tick del guardrail non coincidono al secondo. In ogni caso: **nessun falso positivo distruttivo** in questa sessione; i memfree bassi sono lo stato di crociera, non un OOM in corso (lmkd=0, VmHWM stabile ~3875).

## Verdetto (regole del mandato)

Confronto: **mediana decode tok/s dei 4 run B vs 4 run A**, con vista per-prompt a verbale.

| soglia | esito misurato |
|---|---|
| B ≥ A − **2%** | pooled **+6.90%**; short **+9.94%**; f45_1 **+0.93%** — tutte ≥ −2% |
| B > A + 3% | pooled sì (+6.90%); f45_1 no (+0.93%) — annotare velocità in più sul pooled/short |
| Banda MiB/tok B f45 ≉ 28.6±10% | **NO** — f45 = 28.59 esatto |
| smoke KV n_past=71 | **PASS** |
| lmkd / guardrail hard | 0 |

→ **SOSTITUZIONE RACCOMANDATA** (con velocità in più sulla pooled e su short; f45_1 ≈ parità).  
Costo qualità a verbale (da knee, non rimisurato qui): **ΔPPL +0.104** su budget 0.15, byte −41.7% su twin f45.  
**La decisione finale (budget PPL) resta a gualt.**

## Artefatti

Telefono `~/experiments/results/dropcold/speed065/`:
- `runs.csv`, `VERDICT.txt`, `verdict.json`, `STATUS.txt`, `SPEED_DROPCOLD065.master.log`
- `A/*.summary.txt`, `B/*.summary.txt` (+ sampler/stdout/stderr)
- `smoke_kv/{STATUS_SMOKE.txt,smoke_meta.json,smoke.stdout,smoke.stderr}`
- `sostenuto/{STATUS.txt,B-short-n512.summary.txt,B-short-n512.sampler.csv,…}`
- `flight.log`, `batt_{start,end}.json`, `prompt_sha256.txt`

PC mirror leggero: `results/dropcold/speed065/` (summary + csv + verdict + flight + smoke meta; no GGUF).

Script: `scripts/run_speed_dropcold_065.sh` (A=0.50 vs B=0.65, gate non-regressione).

## Note

1. Auto-verdict script `STOP_INCOHERENT_BANDA` è un falso positivo di disegno: banda knee applicata al pooled invece che al twin f45. Numeri f45 = knee. Verdetto umano = SOSTITUZIONE RACCOMANDATA.
2. Wall 71 s sul sostenuto n=512 corto vs 512/4.23≈121 s: sospetto stop EOS; metrica citabile = `eval_tok_s`.
3. Non toccato: PREFAULT, fork, `../ai-chat`, `PLAN.md`. Nessun rebuild.

## STOP

Report ends here per mandate. **Sostituzione 0.65 è di gualt.**
