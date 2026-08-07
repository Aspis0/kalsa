# F5.4 — IN CARICA, METRICA INVARIANTE — 2026-08-07 (finale)

**Stato:** DONE_PARTIAL — C quasi completo (crash 3500-r2) + **D1 DONE** (ubatch output IDENTICAL). B/D2 non eseguiti.  
**Device:** Samsung S23 (SM-S911U), **PLUGGED_AC / CHARGING**.  
**Runtime:** `bmoe-cli` commit `b0c4e5b`, modello Qwen3.6-35B-A3B-UD-IQ2_M (size gate 11522702304 B).  
**Harness C:** `scripts/start_f5_4.sh` → resume → `scripts/start_f5_4_resume2.sh --run` (detached).  
**Harness D1:** `results/f5.4/d1/run_d1_only.sh` (detached setsid/nohup, PID 22856) — solo cella D1.  
**Marca:** tutte le righe **F5.4 IN-CARICA** — non entrano nelle mediane del gate.  
**Stop C:** runner morto a metà C-cache3500-r2 (prefill, stdout 0 B). D1 rilanciato separato dopo ripristino sshd + PREFIX/PATH.

## Ordine previsto vs eseguito

| fase | piano | esito |
|---|---|---|
| **C** cache-mb 2000/2500/3000/3500 ×2 | hit% vs sim M5 | **quasi completo:** 2000/2500/3000 ×2 ok; 3500-r1 ok (hit 76.1); **3500-r2 crash mid-prefill** |
| **D1** ubatch 512 vs 2048, temp 0, stesso file | equivalenza output | **DONE — IDENTICAL** (n_prompt=1318) |
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

## D1 — ubatch cambia l'output? (F5.4 IN-CARICA)

**Eseguito** 2026-08-07T14:46–14:54 EDT via `run_d1_only.sh` (gates batt+die attivi; `termux-battery-status` dopo `export PREFIX/PATH`).  
**Config:** `-t 4 -c 2048 -n 256 --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --moe-stream --chatml --no-think --temp 0`.  
**Prompt:** `~/experiments/prompts/d1_long.txt` (copia stabile di `results/f5.4/prompts/d1_prompt.txt`, sha256 `96629f53…e37650`, 5210 B) — **stesso file byte-identico** per entrambe le run.  
**n_prompt:** **1318** (confermato `prefill: 1318 tokens` in entrambi i log; **>512** → i due ubatch processano in blocchi multipli).

| cella | ubatch | n_prompt | tokens | tok/s | prefill_tps | die max °C | batt | rc |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| F5.4-D1-ubatch512 | 512 | **1318** | 256 | 4.824 | 12.0 | **90.3** | 39→38 | 0 |
| F5.4-D1-ubatch2048 | 2048 | **1318** | 256 | 4.393 | 10.9 | **89.9** | 38→38 | 0 |

**Confronto carattere-per-carattere** (`compare.txt` + `diff` locale):

- `len_512=1006` = `len_2048=1006` (gen strip); raw 1007 = 1007.
- `VERDICT=IDENTICAL` · `first_diff_at=-1`.
- head (primi ~50 char, entrambi):
  `L'orologio digitale sul muro della carrozza 7 segn`
- sha256 gen (entrambi): `d335145116b93eb5…` (identico).

**Verdetto D1:** output **identici** a temp 0 con prompt byte-identico e n_prompt=1318>512. **ubatch è trasparente** sul testo generato — questione chiusa. Il confronto F5.1 vs F5.3 resta invalidato **solo dall'accento** nel prompt, non da ubatch. Nessun sospetto bug nel percorso a blocchi da questi dati. Marca **F5.4 IN-CARICA** (non entra nelle mediane gate).

Artefatti: `results/f5.4/d1/ubatch512.out`, `ubatch2048.out`, `*.gen.txt`, `compare.txt`, `D1.master.log`, `run_d1_only.sh`.

## B / D2

**Non eseguiti** (mandati separati; runner C morto prima; D1 solo rilanciato).

| fase | verdetto |
|---|---|
| D1 ubatch 512 vs 2048 output | **IDENTICAL — ubatch trasparente** |
| B Q4_0 vs Q4_K_M (work) | **NON DECISO** |
| D2 sweep ubatch prefill_tps | **NON DECISO** |

## Sicurezza

- die max osservato **90.8 °C** (C-2000-r1 e C-3500-r1); D1 max **90.3 °C** (ubatch512); mai ≥95 (soglia STOP).  
- batteria C: start ~29% PLUGGED_AC; D1: **39→38% PLUGGED_AC** (termux-battery-status OK dopo fix PREFIX/PATH). Floor 30% non applicato (mandato in carica).  
- nessuno scollegamento caricatore, no broad pkill, no reboot.  
- Gate D1: `termux-battery-status` + die thermal (STOP ≥95, wait_cool ≤80) attivi preflight e pre-cella.  
- ssh/adb caduta ≠ fail del design detached; processo C comunque morto su 3500-r2 (non solo link).

## Deviazioni / bug harness

1. **Crash mid-C a cache-mb 3500-r2** (e storico 2500 al primo launch): footprint 35B + dense anon 1664 + cache 3500 + ubatch buffer 501 MiB; stdout 0, no DONE.  
2. Parser live `tok_s`/`mib_tok` multi-grep corrotto su C=2000 (numeri affidabili da hit/compute/work/meta).  
3. `prefill_tps` CSV a 0 su alcune celle early; recuperabile da perf/meta.  
4. Monitor PC ha visto runner assente → pull parziale corretto; STATUS telefono marcato `DONE_PARTIAL`.

## Cosa non dice

- D1: **deciso** — ubatch non cambia l'output a temp 0 (identici).  
- Non decide B (work Q4_0 vs Q4_K_M).  
- Non decide D2 (ubatch ottimo prefill — D1 non misura speed, solo equivalenza testo).  
- Non produce numeri da mediane gate (tutto IN-CARICA + C parziale).  
- Non valida la metrica invariante work su 6+ turni stabili (outlier a 3500-r1).  
- 3500 ha un solo rep valido — hit 76.1 non ha replica.

## Artefatti

- `results/f5.4/` pull completo (cells, master, c/*, prompts, STATUS DONE_PARTIAL)  
- `results/f5.4/d1/` pull completo (ubatch512/2048 .out/.gen, compare, meta, sampler, metrics, master, run_d1_only.sh)  
- `scripts/start_f5_4.sh`, `start_f5_4_resume.sh`, `start_f5_4_resume2.sh`, `reparse_f54.py`, `_mk_resume_f54.py`  
- celle complete: C 2000/2500/3000 ×2 + 3500-r1; **D1 ubatch512 + ubatch2048**  
- cella crash: `F5.4-C-cache3500-r2` (stderr load only)

## Verdetto gate

**BLOCKED / DONE_PARTIAL** (B/D2 aperti; C parziale).  
C: cache grande **non** da promuovere (M5 sovrastima; crash a 3500; +5 pt reali ma costo alto).  
**D1: CHIUSO — ubatch trasparente** (output IDENTICAL a temp 0, n_prompt=1318).  
B/D2: **non decisi**.
