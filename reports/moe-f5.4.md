# F5.4 — IN CARICA, METRICA INVARIANTE — 2026-08-07

**Stato:** DONE_PARTIAL — harness morto a metà C (cache2500-r1).  
**Device:** Samsung S23 (SM-S911U), **PLUGGED_AC / CHARGING**, top-app.  
**Runtime:** `bmoe-cli` commit `b0c4e5b`, modello Qwen3.6-35B-A3B-UD-IQ2_M.  
**Harness:** `scripts/start_f5_4.sh --detach` (PID 10430).  
**HEAD al launch:** 3709888.  
**Marca:** tutte le righe **F5.4 IN-CARICA** — non entrano nelle mediane del gate.  
**Stop:** processo harness + bmoe spariti ~13:26 durante C-cache2500-r1 (prefill); stdout 0 B, no DONE. SSH caduto (sshd morto con l’albero di processi); ripristinato via adb `sshd -p 8022`. Memoria post-crash libera (~4.0 GiB available) → compatibile con kill del processo (OOM/lmk sospetto, non loggato in chiaro in dmesg/logcat accessibile).

## Ordine previsto vs eseguito

| fase | piano | esito |
|---|---|---|
| **C** cache-mb 2000/2500/3000/3500 ×2 | hit% vs sim M5 | **parziale:** solo 2000×2 ok; 2500-r1 crash mid-prefill; 3000/3500 non partite |
| **D1** ubatch 512 vs 2048, temp 0, stesso file | equivalenza output | **non eseguita** |
| **B** Q4_0 vs Q4_K_M A/B×3 + work | ramo ri-quant | **non eseguita** |
| **D2** ubatch 256/512/1024/2048 | prefill_tps + decode | **non eseguita** |

Config base: `-t 4 --cache-mb … --dense-weights anon --overlap --io-threads 4 --moe-stream --ubatch 512 -c 4096 -n 256 --chatml --no-think --temp 0`.  
Prompt lungo IT: stesso file espanso da `long_conversational_it.txt` (sha src `b74f0748…`), cold_model.sh prima di ogni cella.

## Metrica invariante

`work = compute_s_tok × cur_freq_prime` (freq in kHz sysfs; % relative invarianti se si usa GHz).  
Sampler 500 ms su cpu0/3/5/7; `cur_freq_prime` = max(avg cpu3, avg cpu5).

## C — punti misurati (solo C=2000)

Fonte: `=== perf ===` + sampler + meta. Marca **F5.4 IN-CARICA**.

| cella | C_mib | hit% | mib/tok | read MiB | compute s/tok | cur_freq_prime | work | tok/s | prefill_tps | RSS peak | die max °C | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F5.4-C-cache2000-r1 | 2000 | **71.1** | 32.93 | 8430 | 0.154 | 2.036 GHz | 313481 | 5.130 | 11.39 | 4.36 GiB | **90.8** | 29→28 |
| F5.4-C-cache2000-r2 | 2000 | **71.1** | 32.93 | 8430 | 0.179 | 1.542 GHz | 275996 | 4.332 | 9.62 | 4.40 GiB | 89.5 | 28→28 |

- hit% **identico** r1/r2 (71.1) → conteggio deterministico ok in carica.  
- work scende con la freq (313k → 276k): normalizzazione non chiude al 100% su 2 soli punti (carica + thermal ramp); comunque la direzione è quella attesa (freq↓ → compute_s_tok↑).  
- sched_reserve (ubatch 512, n_ctx 4096): **501.02 MiB** (dichiarato, indipendente da carica).  
- resident cache: 1999.9 / 2000 MiB (piena).

### Simulatore M5 vs misura (solo C=2000)

Rif. `results/f4.8/m5/pass2_curve.tsv` colonna `lru_hit_req_dec`:

| C_mib | sim hit% | misura hit% (media 2 rep) | scarto (misura − sim) |
|---:|---:|---:|---:|
| 2000 | 72.236 | **71.1** | **−1.14 pt** |
| 2500 | 76.27 | — | **non misurato** |
| 3000 | 80.049 | — | **non misurato** |
| 3500 | 84.082 | — | **non misurato** |
| Δ 2000→3500 (sim) | +11.8 pt | — | **non verificabile** |

**Verdetto C (parziale):** a C=2000 il simulatore è **vicino** (−1.1 pt). La regola ≥+3 pt / <+1.5 pt su 2000→3500 **non si può applicare**: manca la curva. **Non** promuovere cache grande in config di prodotto su questa base; **non** invalidare M5 su un solo punto.

**C-cache2500-r1:** cold_ok, load dens/anon 1664 MiB, cache=2500, prefill in corso (read_bytes ~35 GB in sampler), RSS sceso ~1.6–2.1 GiB prima dello stop, stdout vuoto, no meta. Cella **incompleta** — non usare.

## D1 / B / D2

**Non eseguiti.** Nessun file in `results/f5.4/d1|b|d2` utili.

| fase | verdetto |
|---|---|
| D1 ubatch output | **NON DECISO** |
| B Q4_0 vs K-quant (work) | **NON DECISO** |
| D2 sweep ubatch | **NON DECISO** |

## Sicurezza

- die max osservato **90.8 °C** (C-2000-r1), mai ≥98.  
- batteria start 29% PLUGGED_AC → fine pull 29% CHARGING (current a tratti negativo in lettura termux ma status CHARGING). Floor 30% **non applicato** (mandato in carica).  
- nessuno scollegamento caricatore, no broad pkill, no reboot.  
- ssh caduta ≠ fail: detached era il design; processo comunque morto (non solo link). sshd riavviato via adb.

## Deviazioni / bug harness

1. **Crash mid-C a cache-mb 2500** con 35B + dense anon 1664 + cache 2500 + ubatch buffer 501 MiB: footprint alto; sospetto pressure/OOM senza riga DONE.  
2. Parser live `tok_s`/`mib_tok` nel master log **corrotto** (concat multi-match grep); numeri affidabili da `=== perf ===` e `# summary` CSV (usati in questo report).  
3. `prefill_tps` non popolato nel CSV harness live (0); recuperato offline da perf (11.39 / 9.62).  
4. nproc fluttuante 6↔7 al preflight; cpuset `/top-app` al launch, `/` post-crash via adb run-as.

## Cosa non dice

- Non dice se cache 2500–3500 paga ≥+3 pt hit (curva incompleta).  
- Non dice se ubatch cambia l’output (D1).  
- Non dice se Q4_0 riduce il work del kernel vs Q4_K_M (B).  
- Non dice se prefill ha un ubatch ottimo ≥+15% vs 512 (D2).  
- Non produce numeri da mettere in mediane gate (tutto IN-CARICA + parziale).  
- work r1/r2 a C fisso non è ancora la validazione piena della metrica invariante su 6+ turni (quella resta F5.3-A).

## Artefatti

- `results/f5.4/` pull completo di quanto presente sul telefono  
- `scripts/start_f5_4.sh`, `scripts/reparse_f54.py`  
- celle complete: `F5.4-C-cache2000-r{1,2}`  
- cella crash: `F5.4-C-cache2500-r1` (stderr load only)

## Follow-up (non eseguito qui)

1. Resume C da 2500 con più headroom (es. chiudere watcher/sshd extra, o cache 2500 con cool più lungo / free check pre-run).  
2. Completare C 2500/3000/3500 ×2 → scarto sim vs misura su tutta la curva.  
3. Poi D1 → B → D2 come da ordine mandato.  
4. Fix parser tok_s multi-grep in start_f5_4.sh prima del resume.

## Verdetto gate

**BLOCKED / DONE_PARTIAL.** Nessuna decisione di prodotto su cache grande, ubatch, o ri-quant da questa run.
