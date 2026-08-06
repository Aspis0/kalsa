# Anomalia binario llama-cli — chiusura (2026-08-06)

Referto di partenza: PLAN.md Registro checkpoint, voce «2026-08-06 notte — ANOMALIA APERTA».
Esecutore: unico agente (reviewer allowance esaurita). HEAD partenza campagna: `c28a2e0`; lavoro su main post-gate F3.

## 1. Test decisivo A — rebuild `build-safe2`

| Voce | Valore |
|------|--------|
| Script | `scripts/build_llama_termux.sh` |
| `BUILD_DIR` | `build-safe2` (non sovrascrive `build-safe`) |
| Pin | `67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc` (b10244) |
| Flag | `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` |
| Esito build | PREFLIGHT ISA OK; `llama-cli --version` → `version: 1 (67d5978)` |
| Durata | ~20 min (cmake+ninja 315 target, JOBS=3) |

### A1 — build-safe2 **senza** `--load-mode` (4B, -n 4)

```
RC_NOMODE=0
[ Prompt: 3.6 t/s | Generation: 2.3 t/s ]
Exiting...
```

### A2 — build-safe (vecchio, mtime 2026-08-03) **senza** `--load-mode`

```
RC_OLD_NOMODE=0
[ Prompt: 3.6 t/s | Generation: 2.2 t/s ]
Exiting...
```

### A3 — build-safe **con** `--load-mode mmap`

```
RC_OLD_MMAP=0
[ Prompt: 3.6 t/s | Generation: 2.3 t/s ]
Exiting...
```

**Conclusione A:** il pin 67d5978 **non** è rotto in sé (il rebuild pulito carica e genera senza flag).
Il binario vecchio, che la notte/mattina abortiva in `load_tensors` / `llama_load_mode_from_str`, **ora** funziona uguale.
Quindi **non** è corruzione permanente del file su disco (stesso mtime/path; SHA diversi solo perché build-safe2 è un link/packaging fresco — `llama-cli` stub 6088 B in entrambi i casi, `libllama.so.0.0.1` ha hash diversi ma stesso size 3629488).

## 2. Riproduzione B — ambiente di invocazione F3

**Non** rilanciato `start_f3.sh --variant numa` (4 righe CSV già complete; vietato duplicare misure).

Sostituito con diagnostica equivalente, stesso env di `start_f3.sh`:

- `ssh BatchMode`, `LD_LIBRARY_PATH=build-safe2/bin`, `TMPDIR=$PREFIX/tmp`
- residual PIDs: nessuno
- batteria: UNPLUGGED 92%, 29–30.5°C
- `run_bench.sh --print-cmd` → include `--load-mode mmap`
- run reale 4B via harness (`phase=F3-diag`, `n_gen=4`, `--classic-perf`, binary=build-safe2)

Esito harness (CSV `results/diag/diag_anomaly.csv`):

| Campo | Valore |
|-------|--------|
| rc | 0 |
| flags | `--load-mode mmap` |
| prompt_tok_s / eval_tok_s | 6.20 / 1.80 |
| ttft_ms | 40919 (wall-clock stream, `ttft_wall=1`) |
| load_s | 40 |
| ttft ≥ load | sì (40919 ms ≥ 40 s) |
| spinner | `[spinner suppressed: Loading model...]` (log 2106 B, non centinaia di MB) |
| exit | clean `Exiting...` |

Preflight 4B stile `start_f3` (timeout 30s, `--load-mode mmap`): **rc=0**, timing presenti.

## 3. Diagnosi

| Ipotesi | Verdetto |
|---------|----------|
| Codice pin 67d5978 sempre abort senza `--load-mode` | **FALSA** — rebuild e old binary caricano senza flag *ora* |
| Corruzione permanente di `build-safe` su disco | **FALSA** — stesso binario ora ok |
| Ambiente di invocazione (ssh BatchMode / no TTY) | **FALSA** oggi — stessa via funziona |
| Stato ambiente **transiente** (RAM/fragmentation/page-cache/thermal/lmkd residual) | **PIÙ PLAUSIBILE** — anomalia riprodotta ~15× da Claude, poi sparita dopo boot 05:17 + rebuild 20′ + MemAvailable ~5.1 GiB |
| Default implicito di load-mode fragile sotto stress | **APERTA ma mitigata** — `--load-mode mmap` esplicito elimina la dipendenza dal default |

**F3 resta valida:** i run notturni hanno caricato, generato, `rc=0`, numeri coerenti. L’anomalia non li riscrive.

**Perché non è «risolta alla radice»:** non abbiamo un trigger deterministico per far tornare il SIGABRT. Chiudere la campagna F4 senza harden l’harness sarebbe irresponsabile: un ambiente che flippa in silenzio invalida i delta BigMoeOnEdge.

## 4. Modifiche harness (fatte a prescindere)

Commit `c9768f4` — *Harness: --load-mode mmap, preflight 4B, anti-REPL, wall-clock TTFT*

| ID | Dove | Cosa |
|----|------|------|
| C1 | `run_bench.sh` `build_run_cmdline` + `build_flags_csv` | sempre `--load-mode mmap` (skip se EXTRA già ha `--load-mode`, es. `dio`); colonna `flags` CSV esplicita |
| C2 | `start_f3.sh` | preflight 30s su 4B (`-n 4`, mmap); fail → exit 10, blocco non parte |
| C3 | `run_bench.sh` | watchdog anti-REPL: timing summary senza `Exiting` + processo vivo → kill, notes `INVALID/repl`, exit 9 |
| C4 | `run_bench.sh` | gate batteria **dopo** `--print-cmd` |
| C5 | `run_bench.sh` | stream filter: `\r`→NL, strip BS, collassa spinner «Loading model...» |
| D | `run_bench.sh` | `ttft_ms` = wall-clock primo marker stream (`[Start thinking]` / `=== answer ===`); notes `ttft_wall=1`; check vs `load_s` |
| — | `run_f3.sh` / `start_f3.sh` | accettano `build-safe2`; `LD_LIBRARY_PATH` dalla dir del binario; gestiscono exit 9 |

## 5. Test offline

```
bash scripts/test_run_bench.sh  →  54 PASS, 0 FAIL
bash scripts/test_f3.sh         →  47 PASS, 0 FAIL
bash -n run_bench/start_f3/run_f3 → OK
```

Copertura nuova: `--load-mode mmap` in flags, override `dio`, preflight start_f3, gate dopo print-cmd, anti-REPL, spinner, ttft≥load fixture, exit 9.

## 6. Binario per F4

| Candidato | Stato | Uso |
|-----------|-------|-----|
| `build-safe2` | rebuild 2026-08-06 06:22, ISA preflight OK, smoke 4B ok | **Raccomandato per F4** (build fresco, log di configure/build conservati) |
| `build-safe` | mtime 2026-08-03, ora funziona di nuovo | accettabile; meno preferibile (storia anomalia) |
| `build/` (NATIVE) | vietato | mai in misura |

Default script resta `build-safe`; per F4 passare esplicitamente:

```bash
BINARY=$HOME/src/llama.cpp/build-safe2/bin/llama-cli
export LD_LIBRARY_PATH=$(dirname "$BINARY")
```

`--load-mode mmap` è comunque forzato dall’harness: F4 è comparabile con F3 (default dichiarato del binario).

## 7. Raccomandazione

1. **Chiudere l’anomalia come «mitigata, non root-caused»**: trigger transiente non riprodotto al momento del rebuild; pin e file non sono la causa permanente.
2. **F4 solo con harness post-`c9768f4`**: load-mode esplicito + preflight 4B + anti-REPL + ttft wall-clock.
3. **Binary F4 = build-safe2**.
4. Se il preflight 4B fallisce (exit 10): **STOP blocco**, non «provare il 35B». Raccogliere `preflight_*.log`, `free`, `MemAvailable`, temperatura; non aprire F4 su ambiente degradato.
5. Esperimento collaterale già notato da Claude: `--load-mode dio` è disponibile e va in F4 accanto a mmap (non in questo task).

## 8. Artefatti

- `results/diag/diag_anomaly.csv` — riga harness 4B post-fix
- `results/diag/Qwen3.5-4B-Q4_K_M-20260806-062635.log`
- `results/diag/testA_safe2_nomode.log` / `testA_safe_nomode.log`
- Phone: `~/experiments/logs/build-safe2.log`, `~/src/llama.cpp/build-safe2/`

## 9. Non fatto (vincoli task)

- Nessun `complete_goal`, nessun goal file toccato, F4 non aperta.
- Nessun `start_f3.sh numa` completo (evitati duplicati CSV).
- Nessun pkill broad, nessun setting change, nessun reboot comandato da qui (boot 05:17 già presente).
