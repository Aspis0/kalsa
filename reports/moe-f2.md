# F2 — Baseline e caratterizzazione — 2026-08-05

## Cosa è stato fatto (vs piano)

### F2.1 fio su UFS 3.1 — **COMPLETATO**
- fio 3.42 su Termux (`~/bin/fio`), file test 2 GiB non-sparse materializzato.
- Protocollo: random read, direct=1, invalidate=1, bs∈{4k,16k,64k,256k,1m}, iodepth∈{1,4}, 3 rep, runtime 20s.
- CSV: `results/fio_runs.csv` (30 job + header).
- Mediane bandwidth (MiB/s, n=3 per cella):

| bs | qd=1 median | qd=4 median |
|---:|---:|---:|
| 4k | 21.172 | 55.243 |
| 16k | 30.045 | 33.411 |
| 64k | 83.151 | 89.177 |
| 256k | 213.890 | 88.720 |
| 1m | 413.219 | 446.480 |

Zona operativa esperti (~0.9–1.1 MB): ~80–220 MiB/s. Vincolo UFS 3.1 + FBE forte per streaming.

### F2.2c Baseline densa Qwen3.5-4B Q4_K_M — **COMPLETATO**
- Binary solo `build-safe/llama-cli` pin **67d5978**.
- Protocollo §8.2: cooldown ≥180 s, cool ≤30.0°C, majflt covariata, sentinella ≤15%.
- Griglia greedy threads→ctx→kv; 41 righe `F2.2c` in `runs.csv`.
- **Best: t=4, ctx=1024, kv=f16 → mediana eval 8.90 tok/s** (low-majflt preferred).
  - rep: `…-214012` 9.00; `…-214344` 8.90; `…-214717` 3.80; sentinella `…-220057` 8.90 (PASS).
- Soglia orientativa PLAN ~8–10 tok/s **raggiunta** sul device fresco.

### F2.3c LFM2-8B-A1B Q4_K_M (5 044 779 712 B) — **INVALIDO come baseline stabile**
- Griglia completa con protocollo §8.2; summary: best t=4 c=512 kv=q8_0, mediana 5.30.
- Sentinella kv **FAIL ×2** (drift ~0.95); majflt milionari; ~10 GB re-read per 128 token.
- **Non usabile come numero prodotto**: regime memory-bound (page-cache thrash), non in-RAM stabile.
- Checkpoint PLAN 2026-08-05: richiedere F2.3c-bis con Q4_0.

### F2.3c-bis LFM2-8B-A1B Q4_0 (4 733 893 312 B) — **COMPLETATO (con warning)**
- Modello: HF `LiquidAI/LFM2-8B-A1B-GGUF` → `LFM2-8B-A1B-Q4_0.gguf` size **MATCH** 4733893312 sul telefono.
- Cella fissa da best F2.3c: **t=4 c=512 kv=q8_0**; 3 rep + sentinella; redo una volta; cooldown 180 s; T≤30.0; majflt_gate=50000.
- Harness: `scripts/start_f2_3c_bis.sh` + `run_f2_grid.sh` phase `F2.3c-bis` (size gate + path ridotto + floor batteria 40% CHARGE_NEEDED).
- **8 righe CSV** `F2.3c-bis` (6 measure + 2 sentinelle), zero run_id duplicati.

| batch | eval_tok_s | mediana | majflt (tutti ≫50k) | read_bytes ~ |
|---|---|---:|---|---|
| attempt1 rep1–3 | 13.80, 6.10, 6.20 | **6.20** | 1.96M–2.44M | 9.5–9.6 GB |
| sentinel1 | 14.40 | drift **1.32** FAIL | 1.14M | 9.5 GB |
| attempt2 rep5–7 | 7.30, 7.60, 9.30 | **7.60** | 1.88M–2.62M | 8.6–9.6 GB |
| sentinel2 | 10.10 | drift **0.33** FAIL | 1.52M | 9.0 GB |

- **0/8** run in regime low-majflt (≤50k). Tutti high-pressure.
- Summary harness (ultimo batch, high-majflt only): mediana 9.30 — **non** un baseline in-RAM affidabile.
- **Conclusione:** anche Q4_0 (~4.73 GB) resta memory-bound su questo S23 (7 GB RAM): majflt milionari e ~9 GB flash re-read per 128 token. LFM2 **non** è un baseline in-RAM affidabile su questo device. Risultato valido e reportabile.

### F2.4 Termica 10 min — **COMPLETATO**
- Qwen3.5-4B Q4_K_M continuo, t=4 c=1024 kv=f16 (best F2.2c), blocchi n_gen=64, durata wall 600 s.
- CSV fresco: `results/thermal_f2.csv` (il parziale abortito ~80 s a 33.6°C è stato archiviato sul telefono come `thermal_f2.csv.partial_aborted_0803`).
- 5 blocchi (ogni blocco include load modello → wall per blocco >30 s nominali):

| block | elapsed_s | batt_temp | eval_tok_s |
|---:|---:|---:|---:|
| 1 | 78 | 28.5 | 5.5 |
| 2 | 230 | 28.6 | 3.2 |
| 3 | 382 | 28.7 | 3.2 |
| 4 | 517 | 29.0 | 4.5 |
| 5 | 601 | 30.2 | 7.0 |

- Start 28.2°C UNPLUGGED; end 30.2°C; **nessun blocco >33°C**; mean eval **4.68 tok/s**.
- Throttling termico hard non osservato in 10 min a carico 4B; le variazioni tok/s sono più coerenti con pressure/cache che con thermal cliff.

### Harness / protocollo (durante F2 chiusura)
| Item | Stato |
|---|---|
| `start_f2_3c_bis.sh` fail-closed | DONE |
| `run_f2_grid` phase F2.3c-bis + size 4733893312 | DONE |
| Floor batteria 40% CHARGE_NEEDED in gate_ok | DONE |
| test_f2_grid offline | 28/28 PASS |
| Binary build-safe 67d5978 | pin rispettato |
| UNPLUGGED per tutte le misure | sì |

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | Valore | run_id / artefatto |
|---|---|---|
| fio 4k qd1 median | 21.172 MiB/s | `results/fio_runs.csv` |
| fio 64k qd1 median | 83.151 MiB/s | idem |
| fio 256k qd1 median | 213.890 MiB/s | idem |
| 4B best (F2.2c) | **8.90 tok/s** t4/c1024/f16 | `Qwen3.5-4B-Q4_K_M-20260804-214344` (+ sentinel `…-220057`) |
| LFM2 Q4_K_M | INVALID (sentinel FAIL×2, majflt M) | phase F2.3c summary median 5.30 non usabile |
| LFM2 Q4_0 attempt1 med | 6.20 (high-majflt) | `…-144444`/`…-145424`/`…-150652` |
| LFM2 Q4_0 sentinel1 | 14.40, drift 132% FAIL | `…-151955` |
| LFM2 Q4_0 attempt2 med | 7.60 (high-majflt) | `…-153259`/`…-154440`/`…-155752` |
| LFM2 Q4_0 sentinel2 | 10.10, drift 33% FAIL | `…-161118` |
| LFM2 low-majflt rows | **0** | — |
| Thermal max temp | 30.2°C @ block5 | `results/thermal_f2.csv` |
| Thermal mean eval | 4.68 tok/s (5 blocks) | idem |
| First temp >33°C | **nessuno** in 10 min | — |
| Batteria fine F2 | 93% UNPLUGGED ~30°C | termux-battery-status |

## Deviazioni / sorprese / bug
1. LFM2 Q4_0 riduce la footprint file ma **non** elimina thrash: 0 low-majflt su 8, ~9 GB re-read/rep — stesso regime di Q4_K_M.
2. Drift sentinella LFM2 rimane >>15% anche a cella fissa e cooldown 180 s → baseline non riproducibile.
3. `sleep 180` su Termux/Android a volte si allunga (~8–10 min wall) — protocollo rispettato lato script, wall-clock allungato da scheduler.
4. Thermal: solo 5 blocchi in 600 s wall perché ogni blocco ricarica il 4B; temp resta ≤30.2°C (run parziale abortito a 33.6°C era incompleto/invalido).
5. Floor 40% implementato nel grid ora; F2.3c-bis partito a 100% e finito a 95% senza toccare il floor.
6. Mediana summary 9.30 sull’ultimo batch high-majflt **non** va usata come “numero prodotto” LFM2.

## Verdetto gate: **PASS-CONDIZIONATO**

### Checklist gate F2
| Requisito | Stato |
|---|---|
| fio curve random-read | **DONE** (30 job) |
| 4B griglia greedy completa §8.2 | **DONE** (F2.2c, 8.90 tok/s) |
| 4B ≥ ~8–10 tok/s stabili [S] | **RAGGIUNTO** (F2.2c best) |
| LFM2 misurato | **DONE** ma **non baseline in-RAM** (Q4_K_M invalid; Q4_0 sentinel FAIL×2, 0 low-majflt) |
| Termica 10 min | **DONE** (max 30.2°C, mean 4.68 tok/s) |

**PASS-CONDIZIONATO** perché: fio + F2.2c + F2.4 chiusi; LFM2 documentato come **non** affidabile in-RAM su S23 (risultato negativo valido). Il numero prodotto dense-path è **Qwen3.5-4B @ 8.90 tok/s**. Non aprire F3 finché batteria ≥80% (regola §8.2 tra fasi).

## Prossima azione proposta
1. **Ricarica telefono a ≥80% UNPLUGGED-ready** prima di F3 (ora ~93% ok se si parte presto; altrimenti charge between phases).
2. F3 = muro 35B MoE (misura, non ottimizzazione): solo dopo gate F2 accettato e batteria ok.
3. Non trattare LFM2 come binario prodotto A su questo device senza runtime streaming (BigMoeOnEdge / F4+).
4. Opzionale harness: documentare sleep stretch Android; non abbassare cooldown.

## Artefatti PC
- `results/runs.csv` (119+ righe; F2.3c-bis = 8)
- `results/fio_runs.csv`, `results/thermal_f2.csv`
- `results/f2/f2_3c_bis_console.txt`, `f2_4_console.txt`
- `results/f2/f2_grid_state/F2.3c-bis.{state,summary.md,runner.log}`
- `scripts/start_f2_3c_bis.sh`, `run_f2_grid.sh`, `test_f2_grid.sh`
- Report: `reports/moe-f2.md` (questo file)

DONE
