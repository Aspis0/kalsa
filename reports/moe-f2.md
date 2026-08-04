# F2 — Baseline e caratterizzazione — 2026-08-04

## Cosa è stato fatto (vs piano)

### F2.1 fio su UFS 3.1 — **COMPLETATO**
- **fio 3.42** buildato da sorgente su Termux (`~/experiments/fio-src/fio-fio-3.42`).
  - Pacchetto assente nei mirror; tarball `fio.tar.gz` da PC.
  - `./configure --disable-native --disable-shm` obbligatorio: SysV shm e `/dev/ashmem` non utilizzabili da Termux (Permission denied) → `CONFIG_NO_SHM`.
  - Binario: `~/bin/fio` (fio-3.42).
- File test **2 GiB non-sparse** in `~/experiments/fio/fio_randread.bin` (dd zeros + fsync).  
  **Nota critica:** `fallocate`/sparse dà bande false multi-GB/s (zero pages); marker `.materialized` richiesto.
- Protocollo: random read, `direct=1`, `invalidate=1`, bs ∈ {4k,16k,64k,256k,1m}, iodepth ∈ {1,4}, 3 rep, runtime 20s.
  - `ioengine=psync` (qd=1); tentativo `io_uring` per qd=4 → fallito spesso, fallback psync (depth effettivo 1).
- Schema dedicato: `scripts/fio.schema.md`, harness `scripts/run_fio_bench.sh`, reparse `scripts/reparse_fio_json.py`  
  (JSON fio prefissato da warning `clock setaffinity failed` → strip fino a `{`).
- CSV: `results/fio_runs.csv` (30 job + header), telefono `~/experiments/results/fio_runs.csv`.

#### Mediane bandwidth (MiB/s) — da JSON riparsati

| bs | qd=1 median (n=3) | qd=4 median (n=3) | note |
|---:|---:|---:|---|
| 4k | **21.172** (21.13, 21.17, 22.20) | **55.243** (7.94, 55.24, 65.75) | qd4 rumoroso (1 outlier) |
| 16k | **30.045** (7.91, 30.05, 30.70) | **33.411** (32.10, 33.41, 33.79) | |
| 64k | **83.151** (76.71, 83.15, 84.42) | **89.177** (85.83, 89.18, 91.16) | |
| 256k | **213.890** (209.96, 213.89, 233.92) | **88.720** (86.83, 88.72, 191.00) | qd4 ≈ psync fallback |
| 1m | **413.219** (393.58, 413.22, 462.13) | **446.480** (411.86, 446.48, 462.53) | |

Interpretazione operativa (esperti ~0.9–1.1 MB): banda random ~**80–220 MiB/s** nella zona 64k–256k; 4k ~21 MiB/s.  
Lontano dai 1686 MB/s sequenziali di datasheet; UFS 3.1 + FBE + filesystem app = vincolo forte per streaming esperti.

Gate temp/carica rispettati durante i job (UNPLUGGED, temp tipica 28–31 °C).

### F2.2 Baseline densa Qwen3.5-4B — **PARZIALE (interrotto)**
- Binary **solo** `~/src/llama.cpp/build-safe/bin/llama-cli` (pin 67d5978 / b10244).
- Harness aggiornato: timeout 12s su `termux-battery-status` (hang post-run osservato: termux-api BatteryStatus bloccato >25 min dopo llama exit).
- Griglia greedy avviata: start t=5,c=1024,kv=q8_0; n_gen=128; warm; short; 3 rep.

#### Stage threads {4,5,6} @ c=1024 kv=q8_0 — **COMPLETATO** (9/9 CSV sul telefono)

| threads | eval_tok_s (3 rep) | mediana |
|---:|---|---:|
| 4 | 5.40, 5.30, 3.60 | **5.30** |
| 5 | 4.30, 5.30, 4.70 | **4.70** |
| 6 | 4.20, 4.20, 3.90 | **4.20** |

**BEST threads = 4** (non 5 del default dichiarato).

#### Stage ctx {512,1024,4096} @ t=4 kv=q8_0 — **1/9**
- rep1 c=512: prompt=20.50 eval=**5.90** (run_id `…-032226`), poi hang battery; sblocco kill termux-api; CSV scritta (batt_temp_end vuota).
- Grid ripartita con skip rows già presenti; proseguiva su c=512 rep2+.

#### Stage kv — **NON ESEGUITO**

**Connettività persa** durante ripresa F2.2 (~04:00+):
- ping 192.168.1.152 OK
- SSH :8022 **Connection refused**
- `adb devices` **vuoto** (wireless debug assente / sessione morta)
- Impossibile pull CSV F2.2 completo né continuare griglia

I ~10 run F2.2 restano **solo sul telefono** (`~/experiments/results/runs.csv`); su PC `results/runs.csv` ha ancora solo la riga F1.

**Osservazione gate orientativa:** tutte le mediane 4B osservate sono **~3.6–5.9 eval tok/s**, sotto la soglia orientativa PLAN F2 (~8–10 tok/s [S]). Non è un FAIL formale finché la griglia non è completa, ma è un segnale di setup/runtime da affrontare prima del 35B.

### F2.3 LFM2-8B-A1B — **NON ESEGUITO (modello OK)**
- PC re-download HF LiquidAI: size **5 044 779 712** B MATCH (file precedente 5 431 528 128 scartato).
- scp telefono: **5 044 779 712** B MATCH (`stat -c %s`).
- Griglia non avviata (connessione caduta prima di chiudere F2.2).

### F2.4 Termica 10 min — **NON ESEGUITO**
- Script pronto: `scripts/run_f2_thermal.sh` (blocchi 30s, CSV dedicato, safe binary only).

### Fix harness durante F2
| Issue | Fix |
|---|---|
| fio shmget Permission denied | configure `--disable-shm` |
| banda fake multi-GB/s | file non-sparse + marker |
| JSON parse fail (setaffinity warning) | strip fino a `{` + reparse script |
| termux-battery-status hang post-run | `timeout 12` in run_bench / grid / thermal |
| notes fio accumulate fallback | per-run `_run_notes` |

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | Valore |
|---|---|
| fio 4k qd1 median | 21.172 MiB/s (n=3) |
| fio 64k qd1 median | 83.151 MiB/s (n=3) |
| fio 256k qd1 median | 213.890 MiB/s (n=3) |
| fio 1m qd1 median | 413.219 MiB/s (n=3) |
| 4B best threads (parziale) | t=4, median eval 5.30 tok/s @ c=1024 kv=q8_0 |
| 4B ctx512 rep1 | eval 5.90 tok/s (`…-032226`) |
| LFM2 size telefono | 5 044 779 712 MATCH |
| Device reboot | **non verificabile** post-drop (SSH refused; adb assente). Ping IP ancora OK → più probabile sshd/Termux/wireless-debug morti che reboot hard, ma **boot_id non leggibile**. |
| Batteria ultima nota | ~62%, UNPLUGGED, ~28 °C (pre-drop) |

## Deviazioni / sorprese / bug
1. fio richiede `--disable-shm` + file materializzato; senza, numeri inutilizzabili.
2. io_uring non affidabile per qd=4 su questo Termux → curve qd=4 spesso = psync.
3. **termux-battery-status hang** = blocco silent di intere griglie; timeout obbligatorio.
4. eval tok/s 4B ~4–6, non ~8–10: possibile thrashing (vmrss_peak ~4.2–4.6 GB su 7 GB RAM, memfree_min spesso <100 MB), thermal soft, o build/flags; da investigare a ripristino.
5. Drop connettività mid-F2.2: SSH refused, adb offline, IP pingable.

## Verdetto gate: **BLOCKED(connettività persa mid-F2.2; F2.2 incompleta; F2.3/F2.4 non eseguiti; 4B ancora <8–10 tok/s sulle misure parziali)**

### Checklist gate F2
| Requisito | Stato |
|---|---|
| fio curve random-read | **DONE** (30 job, mediane tabulate) |
| 4B griglia greedy completa | **MISSING** (threads OK; ctx 1/9; kv 0/2) |
| 4B ≥ ~8–10 tok/s stabili [S] | **NON raggiunto** sui dati parziali (~5.3–5.9) |
| LFM2 misurato | **MISSING** (file OK, griglia no) |
| Termica 10 min | **MISSING** |

## Prossima azione proposta
1. **gualt:** riattivare Wireless debugging / Termux+sshd (porta 8022); verificare se reboot (boot_id / uptime).
2. Pull `~/experiments/results/runs.csv` + logs F2.2 sul PC.
3. Riprendere `run_f2_grid.sh --phase F2.2` (skip automatico righe già presenti) → poi F2.3 LFM2 → F2.4 thermal.
4. Se 4B resta <8 tok/s dopo griglia completa: diagnostica (RAM pressure, thread affinity, quant, prompt overhead thinking) **prima** di F3 35B.
5. Non aprire F3 finché questo report non passa a DONE o gualt decide esplicitamente.

## Artefatti PC
- `results/fio_runs.csv`
- `scripts/run_fio_bench.sh`, `fio.schema.md`, `reparse_fio_json.py`
- `scripts/run_f2_grid.sh`, `run_f2_thermal.sh`
- `scripts/run_bench.sh` (timeout battery)
- Report F1: `reports/moe-f1.md` PASS (commit `d8f33ab`)

DONE
