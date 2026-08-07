# F5.4 — IN CARICA, METRICA INVARIANTE — 2026-08-07 (finale)

**Stato:** DONE_PARTIAL — runner `start_f5_4_resume2.sh` (PID 2472) morto a metà **C-cache3500-r2** (prefill, stdout 0 B).  
**Device:** Samsung S23 (SM-S911U), **PLUGGED_AC / CHARGING**, top-app.  
**Runtime:** `bmoe-cli` commit `b0c4e5b`, modello Qwen3.6-35B-A3B-UD-IQ2_M.  
**Harness:** `scripts/start_f5_4.sh` → resume → `scripts/start_f5_4_resume2.sh --run` (detached, ppid=1).  
**HEAD al monitor:** `dddc1b0`.  
**Marca:** tutte le righe **F5.4 IN-CARICA** — non entrano nelle mediane del gate.  
**Stop:** processo harness + bmoe spariti durante C-cache3500-r2 (prefill: sampler fino ~34 GB read_bytes, RSS ~1.9 GiB, die ~90 °C, stdout/metrics vuoti). Memoria post-crash libera (~4.1 GiB available) → compatibile con kill/OOM/lmk. SSH/adb wireless caduti a tratti; ripristinati via adb + `sshd -p 8022`.

## Ordine previsto vs eseguito

| fase | piano | esito |
|---|---|---|
| **C** cache-mb 2000/2500/3000/3500 ×2 | hit% vs sim M5 | **quasi completo:** 2000/2500/3000 ×2 ok; 3500-r1 ok (hit 76.1); **3500-r2 crash mid-prefill** |
| **D1** ubatch 512 vs 2048, temp 0, stesso file | equivalenza output | **non eseguita** |
| **B** Q4_0 vs Q4_K_M A/B×3 + work | ramo ri-quant | **non eseguita** |
| **D2** ubatch 256/512/1024/2048 | prefill_tps + decode | **non eseguita** |

Config base C: `-t 4 --cache-mb … --dense-weights anon --overlap --io-threads 4 --moe-stream --ubatch 512 -c 4096 -n 256 --chatml --no-think --temp 0`.  
Prompt lungo IT: file espanso da `long_conversational_it.txt`. cold_model.sh prima di ogni cella.  
Soglie termiche harness: **STOP ≥95 °C**, avvio/respiro ≤80–85 °C (attive; nessun hard-stop termico osservato).

## Metrica invariante

`work = compute_s_tok × cur_freq_prime` (freq in kHz sysfs; sampler 500 ms su cpu0/3/5/7; `cur_freq_prime` = max(avg cpu3, avg cpu5)).

## C — punti misurati (F5.4 IN-CARICA)

Fonte: `cells.csv` + `=== perf ===` / meta. Marca **F5.4 IN-CARICA**.

| cella | C_mib | hit% | mib/tok | read MiB | compute s/tok | cur_freq_prime | work | tok/s | prefill_tps | RSS peak | die max °C | batt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F5.4-C-cache2000-r1 | 2000 | **71.1** | 32.93 | 8430 | 0.154 | 2.036 GHz | 313481 | 5.130 | 11.39* | 4.36 GiB | **90.8** | 29→28 |
| F5.4-C-cache2000-r2 | 2000 | **71.1** | 32.93 | 8430 | 0.179 | 1.542 GHz | 275996 | 4.332 | 9.62* | 4.40 GiB | 89.5 | 28→28 |
| F5.4-C-cache2500-r1 | 2500 | **73.3** | 24.80 | 6350 | 0.153 | 2.126 GHz | 325290 | 4.673 | 11.6 | 4.45 GiB | 90.3 | 31→31 |
| F5.4-C-cache2500-r2 | 2500 | **73.3** | 24.80 | 6350 | 0.159 | 2.085 GHz | 331534 | 4.339 | 11.53 | 4.45 GiB | 90.3 | 34→33 |
| F5.4-C-cache3000-r1 | 3000 | **75.1** | 18.35 | 4698 | 0.394 | 1.628 GHz | 641495 | 2.143 | 6.13 | 4.56 GiB | 89.9 | 33→33 |
| F5.4-C-cache3000-r2 | 3000 | **75.1** | 18.35 | 4698 | 0.231 | 1.608 GHz | 371374 | 3.339 | 7.61 | 4.60 GiB | 89.5 | 33→33 |
| F5.4-C-cache3500-r1 | 3500 | **76.1** | 14.63 | 3746 | 0.842 | 2.593 GHz | 2183542 | 1.064 | 7.17 | 4.54 GiB | **90.8** | 33→31 |
| F5.4-C-cache3500-r2 | 3500 | — | — | — | — | — | — | — | — | — | ~90.3† | 31→? |

\*prefill_tps C=2000 recuperato offline da perf (CSV harness live a 0 per r1/r2).  
†sampler mid-crash; cella **incompleta** — non usare.

- hit% **identico** r1/r2 a 2000/2500/3000 → conteggio deterministico ok in carica.  
- hit sale con C ma **sub-lineare**: 71.1 → 73.3 → 75.1 → 76.1 (+5.0 pt su 2000→3500).  
- mib/tok e read MiB scendono come atteso (32.9 → 14.6; 8430 → 3746).  
- work **non** stabilizza a C=3500-r1 (freq_prime alta + compute_s_tok 0.842 → work outlier); normalizzazione incompleta su pochi punti termici.  
- sched_reserve (ubatch 512, n_ctx 4096): **501.02 MiB** costante.

### Simulatore M5 vs misura (lru_hit_req_dec)

Rif. `results/f4.8/m5/pass2_curve.tsv`:

| C_mib | sim hit% | misura hit% | scarto (misura − sim) |
|---:|---:|---:|---:|
| 2000 | 72.236 | **71.1** (×2) | **−1.14 pt** |
| 2500 | 76.27 | **73.3** (×2) | **−2.97 pt** |
| 3000 | 80.049 | **75.1** (×2) | **−4.95 pt** |
| 3500 | 84.082 | **76.1** (×1) | **−7.98 pt** |
| Δ 2000→3500 | +11.85 pt (sim) | **+5.0 pt** (misura) | sim **sovrastima** il beneficio |

**Verdetto C:** M5 ha ragione sulla **direzione** (hit↑ con cache) ma **sbaglia la pendenza**: scarto monotono −1.1 → −8.0 pt; guadagno reale 2000→3500 ≈ **+5 pt**, non +12. Regola prodotto ≥+3 pt su 2000→3500: **sì numericamente (+5)**, ma il costo RSS/termico a 3500 (crash r2, work outlier, die 90.8 °C) e lo scarto sim crescente **non** supportano promuovere cache grande in config di prodotto. **Non** promuovere cache 3000–3500; M5 **non** è affidabile come predittore quantitativo oltre ~2000–2500 MiB.

## D1 / B / D2

**Non eseguiti** (runner morto prima di uscire da C). Nessun file utile in `results/f5.4/d1|b|d2`.

| fase | verdetto |
|---|---|
| D1 ubatch 512 vs 2048 output | **NON DECISO** |
| B Q4_0 vs Q4_K_M (work) | **NON DECISO** |
| D2 sweep ubatch prefill_tps | **NON DECISO** |

## Sicurezza

- die max osservato **90.8 °C** (C-2000-r1 e C-3500-r1); mai ≥95 (soglia STOP).  
- batteria start ~29% PLUGGED_AC → fine pull **30% CHARGING** (ac:true). Floor 30% non applicato (mandato in carica).  
- nessuno scollegamento caricatore, no broad pkill, no reboot.  
- ssh/adb caduta ≠ fail del design detached; processo comunque morto su 3500-r2 (non solo link).

## Deviazioni / bug harness

1. **Crash mid-C a cache-mb 3500-r2** (e storico 2500 al primo launch): footprint 35B + dense anon 1664 + cache 3500 + ubatch buffer 501 MiB; stdout 0, no DONE.  
2. Parser live `tok_s`/`mib_tok` multi-grep corrotto su C=2000 (numeri affidabili da hit/compute/work/meta).  
3. `prefill_tps` CSV a 0 su alcune celle early; recuperabile da perf/meta.  
4. Monitor PC ha visto runner assente → pull parziale corretto; STATUS telefono marcato `DONE_PARTIAL`.

## Cosa non dice

- Non decide D1 (output ubatch-equivalenza).  
- Non decide B (work Q4_0 vs Q4_K_M).  
- Non decide D2 (ubatch ottimo prefill).  
- Non produce numeri da mediane gate (tutto IN-CARICA + parziale).  
- Non valida la metrica invariante work su 6+ turni stabili (outlier a 3500-r1).  
- 3500 ha un solo rep valido — hit 76.1 non ha replica.

## Artefatti

- `results/f5.4/` pull completo (cells, master, c/*, prompts, STATUS DONE_PARTIAL)  
- `scripts/start_f5_4.sh`, `start_f5_4_resume.sh`, `start_f5_4_resume2.sh`, `reparse_f54.py`, `_mk_resume_f54.py`  
- celle complete: C 2000/2500/3000 ×2 + 3500-r1  
- cella crash: `F5.4-C-cache3500-r2` (stderr load only)

## Verdetto gate

**BLOCKED / DONE_PARTIAL.**  
C: cache grande **non** da promuovere (M5 sovrastima; crash a 3500; +5 pt reali ma costo alto).  
D1/B/D2: **non decisi**.
