# F4.9 — Regime valido, scollegato — 2026-08-07

## Cosa è stato fatto (vs piano)

- **Cella A `F4.9-batt-control`**: controllo ad alta carica del gate F4.3-bis (prompt `short.txt`, `n_gen=64`, `t=4 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4`). 1 cold + 2 warm + 1 sentinella. Batteria ≥90% su tutte. UNPLUGGED, top-app, cold=fadv sul cold.
- **Cella B `F4.9-real-workload`**: carico conversazionale IT (`long_conversational_it.txt`), `n_gen=512`, stessa config gate ma **`n_ctx=2048`** (come long_512 storico; con 512 il prompt non entra). 2 measure + 1 sentinella validi. Campionamento 500 ms su `/proc/<pid>/io`, VmRSS, max zone `cpu-*`/`cpuss-*`.
- Host: SM-S911U, `bmoe-cli` `b0c4e5b`, modello size gate `11522702304`, `LD_LIBRARY_PATH` = dir binario.
- Artefatti: `results/f4.9/`, righe in `results/runs.csv`.

## Deviazioni / sorprese / bug

1. **Gate termico batteria 31.5°C solo cella B** (steering gualt mid-run). Il gate 30.0 è calibrato su burst ~13 s; il carico 512 tok scalda la batteria di ~6–7°C/rep e in ambiente caldo non ridiscendeva sotto 30.0 (stallo osservato ~660 s). **Cella A resta a 30.0.**
2. **`n_ctx=2048` su B** (non 512 del gate). Con `n_ctx=512` + `n_gen=512` il binario fallisce: `prompt + n_predict exceeds the session n_ctx`. Due FAIL CSV (`…-084455`, `…-084900`) restano marcati FAIL, non interpretabili. Allineato a `long_512_run.sh` storico (`-c 2048`).
3. **Sampler**: su Android `pgrep -x bmoe-cli` non vede il processo (comm troncato). Fix path-based `ps -A -o pid,args`. Sample rep1 parziale (attach tardivo); rep2 e sentinella più coperti.
4. **Deriva sentinella B**: warm measure 6.07 / 5.40, sentinella 4.59 → drift ~15–24% vs mediana measure. Segnalata sotto.

## Numeri chiave

### Cella A — `F4.9-batt-control` (short, n=64, batt≥90%)

| run_id | type | eval tok/s | batt% start→end | T_start→end °C | nproc | mask |
|---|---|---:|---:|---:|---:|---|
| …-082535 | cold | **5.02** | 100→100 | 27.4→30.9 | 8 | ff |
| …-082921 | warm | **5.06** | 100→99 | 29.3→30.4 | 8 | ff |
| …-083307 | warm | **4.87** | 99→98 | 29.6→32.6 | 7 | df |
| …-083655 | sentinel | **5.01** | 98→98 | 29.9→31.5 | 8 | ff |

- Mediana warm measure (rep2, rep3; n=2): **(5.06+4.87)/2 = 4.965 ≈ 4.97**
- Mediana warm incl. sentinella (3 valori: 5.06, 4.87, 5.01): **5.01**
- Sentinella vs mediana measure: |5.01−4.97|/4.97 ≈ **0.8%** — anti-drift **OK** (≤15%)
- Range vs ~5.02 gate: 4.87–5.06 → entro ±3% di 5.02 (banda 4.87–5.17)

**Regola di decisione A (dichiarata):**
| mediana warm | verdetto |
|---|---|
| ~5.02 (±3%) | scalino F4.7 sotto 13% **REALE** (batteria) |
| ~4.87 o meno | **DERIVA** di sessione; curva F4.7 non interpretabile |
| in mezzo | riporta |

**Verdetto A: BATTERIA REALE (effetto carica sotto ~13% confermato).**  
Mediana warm **5.01** ≈ 5.02 (entro ±3%). Ad alta carica (98–100%) si ottiene lo stesso plateau del gate; la curva F4.7 (4.64–4.69 a 10–13% vs 4.84–5.00 a 17–32%) resta valida e non è spiegata da sola deriva di sessione.

### Cella B — `F4.9-real-workload` (long IT, n=512, n_ctx=2048)

| run_id | type | eval | decode | compute | flash_io | stall | stall/decode | mib_tok | hit | batt% s→e | T_s→e °C | nproc |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| …-085439 | warm1 | **6.07** | 0.165 | **0.124** | 0.139 | 0.034 | **20.6%** | 33.96 | 86.1% | 96→94 | 29.9→36.5 | 8 |
| …-091224 | warm2 | **5.40** | 0.185 | **0.141** | 0.148 | 0.038 | **20.5%** | 33.96 | 86.1% | 93→91 | 29.3→36.4 | 8 |
| …-092439 | sentinel | **4.59** | 0.218 | **0.166** | 0.170 | 0.045 | **20.6%** | 33.96 | 86.1% | 90→88 | 31.4→38.2 | 8 |

FAIL n_ctx=512 (scartati): `…-084455`, `…-084900`.

- Mediana measure (2 rep, n=2): **(6.07+5.40)/2 = 5.735 tok/s**
- Mediana 3 warm (incl. sentinella): **5.40**
- Sentinella vs mediana measure: |4.59−5.735|/5.735 ≈ **20%** → **anti-drift FAIL (>15%)**. La sentinella è più lenta (T_start 31.4, fine sessione, batt 90%). Si riporta; decisione kernel basata su mediana measure + coerenza stall/decode su tutte e 3.

**Regola di decisione B (dichiarata, mediana rep valide measure):**
| condizione | verdetto |
|---|---|
| stall/decode ≤25% **e** compute ≥0.11 s/tok | **COMPUTE-BOUND CONFERMATO** |
| stall/decode ≥45% | ramo I/O si riapre |
| in mezzo | riporta |

Su entrambe le measure: stall/decode ≈ **20.6%** ≤25%; compute **0.124 / 0.141** ≥0.11.  
Sentinella: stesso stall/decode **20.6%**, compute 0.166 (ancora ≥0.11).

**Verdetto B: COMPUTE-BOUND CONFERMATO.**  
Kernel IQ2 = priorità; ramo I/O si chiude su questo regime scollegato.  
**Tok/s prodotto (carico reale, mediana measure): ~5.74 tok/s** (non il 5.02 del gate short).  
MiB/token scollegato: **33.96** (fisso; vs 84.73 sul short del gate — packing/hit diversi sul long).

### Temperatura die (max zone cpu-*/cpuss-*, campioni 500 ms)

| rep | n campioni con T | max die °C | note |
|---|---:|---:|---|
| B1 | 6 (parziale, attach tardivo) | **79.4** | solo coda run |
| B2 | 66 | **92.0** | curva intera |
| B sent | 83 | **90.3** | curva intera |

Sulla rep2 (miglior coverage): die sale da ~54°C a inizio attach fino a picco ~92°C durante decode continuo ~90 s, poi scende verso ~71°C a fine. Autoriscaldamento batteria +6.5–6.8°C per rep lunghe.

### Validazione indipendente contatore stall

Traffico deterministico: **33.96 MiB/token** su tutte e 3 le rep valide (identico).  
`read_bytes` campionato cresce in parallelo al decode (es. sentinella last ~45.3 GiB cumulati).  
Stall ratio stabile ~20.6% su 3 rep → il contatore `moe-overlap:stall` è coerente scollegato (non artefatto da carica).

## Verdetto gate

| cella | verdetto |
|---|---|
| A batt-control | **PASS** — mediana warm 5.01 ≈ 5.02; effetto batteria F4.7 **confermato** |
| B real-workload | **PASS-CONDIZIONATO** — compute-bound confermato (stall/decode ~21%, compute ≥0.11); sentinella drift ~20% (annotata); gate termico B alzato a 31.5; n_ctx=2048 |

## Cosa non dice

- Non confrontare tok/s di B (long, n_ctx=2048, hit 86%) con il gate short (n_ctx=512, hit 57%, mib_tok 84.73).
- Non usa i due FAIL n_ctx=512 come dati di throughput.
- Non dimostra che la sentinella lenta sia solo termica vs solo batteria 90% vs solo deriva di sessione: le tre si muovono insieme.
- Non misura F5 sostenuto multi-minuto; la curva die su ~90 s di decode è il proxy gratis.
- Non riapre il ramo cache policy (chiuso in M5b/notte).

## Prossima azione proposta

1. Priorità piano: **kernel IQ2 / compute path** (ramo I/O chiuso in regime valido scollegato).
2. Annotare le 8 righe F4.7 come **interpretabili** (effetto batteria reale sotto ~13%).
3. Opzionale: 1 rep B di conferma a T_start≤30 se l’ambiente lo consente, solo per chiudere il drift sentinella; non bloccante per il verdetto compute-bound.

DONE
