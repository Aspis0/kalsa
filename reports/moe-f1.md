# F1 — Setup telefono — 2026-08-04

## Cosa è stato fatto (vs piano)

### Checklist device (pre-F1 + F1)
| Voce | Stato | Note |
|---|---|---|
| ≥40GB liberi su `/data` | OK | 78–93GB free durante campagna |
| Batteria >50% | OK | setup 50–56%; gate F1 a 74% UNPLUGGED |
| Device vergine dedicato | OK | SM-S911U (S23 US), Android 16 |
| Nessun blocco schermo | OK | `locksettings get-disabled=true` |
| Termux SENZA storage permission | OK | mai `termux-setup-storage` |
| RAM Plus OFF | OK | `ram_expand_size=0` |
| Termux da F-Droid/GitHub (mai Play) | OK | GitHub releases v0.118.3 github-debug arm64-v8a |
| Ottimizzazione batteria disattivata | OK | `deviceidle whitelist +com.termux`; appops background/WAKE_LOCK allow |
| `termux-wake-lock` | OK | termux-api + boot script |
| Phantom process killer workaround | OK | `settings_enable_monitor_phantom_procs=false`, `max_phantom_processes=2147483647` |
| Modelli in `~/models/` (mai `/sdcard`) | OK | path home Termux only |
| Misure non sotto carica / ≤32°C | OK al gate | gate F1: `plugged=UNPLUGGED`, start 29.8°C → end 31.4°C |

### Phase A — Install Termux + addons
- **termux-app** v0.118.3 `+github-debug_arm64-v8a.apk` (debuggable → `run-as com.termux`). Install via push+`pm install` (stream adb falliva con `INSTALL_FAILED_VERIFICATION_FAILURE`).
- **termux-api** v0.53.0, **termux-boot** v0.8.1 — installati.
- Primo avvio: crash se display asleep; fix wake screen + bootstrap.

### Phase B — Controllo remoto SSH
- Keypair PC: `~/.ssh/moe_s23` (ed25519).
- `sshd` su **8022**, user `u0_a344`.
- Boot script `~/.termux/boot/start-sshd.sh`: `termux-wake-lock` + `sshd`.
- Accesso verificato pre e post gate F1: `ssh -p 8022 … 'echo OK'`.

### Phase C — Pacchetti, build, modelli, harness

**Pacchetti:** git, cmake, ninja, clang, make, python, curl, jq, openssh, termux-api, llama-cpp (pkg `b10092`, smoke-only).  
**fio:** assente nei mirror Termux al setup → rimandato a F2 (build da sorgente).

#### Build mainline — tree NON sicuro (storico, non usare)
- Clone tag **b10244**, commit `67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc`
- Configure iniziale con `GGML_NATIVE` default **ON** → probe `-mcpu=native+sve/+sme` → SIGILL tombstone in CMakeScratch.
- Binario in `~/src/llama.cpp/build/bin/` (flag finali `-mcpu=native+dotprod+i8mm+nosve+nosme`).
- **Vietato** per misure F1–F4. Dettaglio: `reports/moe-f1-sigill.md`.

#### Build mainline — tree SAFE (gate F1)
- Script: `scripts/build_llama_termux.sh` → `BUILD_DIR=build-safe`
- Pin: tag **b10244** / `67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc`
- CMake: `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `CMAKE_EXPORT_COMPILE_COMMANDS=ON`, CURL/OPENCL OFF, Release
- Binario: `~/src/llama.cpp/build-safe/bin/llama-cli` (+ `llama-bench`, shared libs)
- **Preflight ISA** (`scripts/preflight_llama_isa.sh`): **EXIT 0**
  - cache: `GGML_NATIVE=OFF`, arch esplicita
  - compile_commands: solo `-march=armv8.2-a+dotprod+i8mm+fp16`
  - CPU features: asimddp/i8mm/fp16 presenti; no sve/sme
  - `llama-cli --version` → `version: 1 (67d5978)`
- Tree vecchio `build/` **conservato ma non usato** nelle misure.

#### Harness aggiornamenti F1 (repo)
- `run_bench.sh`: preflight ISA obbligatorio su F1–F4; flag long-form `--no-conversation --single-turn --simple-io` (evita hang chat interattivo); parser timings b10244 `[ Prompt: X t/s | Generation: Y t/s ]`; TMPDIR Termux-safe.
- `lib_isa_safe.sh`, `preflight_llama_isa.sh`, `build_llama_termux.sh`, `f1_gate_run.sh`, test suite ISA/bench.
- Script sincronizzati su telefono: `~/experiments/scripts/`.

#### Modelli (`~/models/`, size byte-esatti)
| File | Atteso (B) | Ottenuto (B) | Metodo | Verdetto |
|---|---:|---:|---|---|
| `Qwen3.5-4B-Q4_K_M.gguf` | 2 740 937 888 | 2 740 937 888 | curl HF su telefono | MATCH |
| `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` | 11 522 702 304 | 11 522 702 304 | scp da PC | MATCH |
| `LFM2-8B-A1B-Q4_K_M.gguf` | 5 044 779 712 | parziale sul telefono (792 133 632); su PC file errato 5 431 528 128 poi re-download HF in corso | PENDING F2 | **PENDING** |

Prompt fissi in `~/experiments/prompts/`: `short.txt`, `medium.txt`, `code.txt`.

### Gate F1 — run scientifico (VALID)

```bash
# UNPLUGGED, temp start 29.8°C; binary SAFE only
bash ~/experiments/scripts/run_bench.sh \
  --binary ~/src/llama.cpp/build-safe/bin/llama-cli \
  -m ~/models/Qwen3.5-4B-Q4_K_M.gguf \
  -p ~/experiments/prompts/short.txt \
  --phase F1 --runtime mainline --run-type warm -n 128 \
  --notes "F1 gate safe binary --no-conversation"
```

| Campo | Valore |
|---|---|
| run_id | `Qwen3.5-4B-Q4_K_M-20260804-011324` |
| date | `2026-08-04T01:13:24-04:00` |
| EXIT | **0** |
| phase / runtime | F1 / mainline |
| threads / n_ctx / kv / n_gen | 4 / 512 / q8_0 / 128 |
| run_type / prompt_id | warm / short |
| prompt_tok_s | **17.00** |
| eval_tok_s | **4.30** |
| ttft_ms | (vuoto — summary chat b10244 senza proxy ms) |
| majflt_delta | 9131 |
| minflt_delta | 918550 |
| read_bytes_delta | 3 697 500 160 |
| vmrss_peak_mb | 4512 |
| memfree_min_mb | 15 |
| batt_temp_start → end | **29.8 → 31.4** °C |
| plugged | UNPLUGGED (pre/post) |
| notes | F1 gate safe binary --no-conversation |
| log | `results/f1/Qwen3.5-4B-Q4_K_M-20260804-011324.log` (copia PC) |
| console | `results/f1/f1_gate_console.txt` — testo generato + `Exiting...` + CSV row |

**Riga CSV (header + data):**
```
run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes
Qwen3.5-4B-Q4_K_M-20260804-011324,2026-08-04T01:13:24-04:00,F1,Qwen3.5-4B-Q4_K_M.gguf,Q4_K_M,,mainline,,,4,512,q8_0,128,warm,short,17.00,4.30,,9131,918550,3697500160,4512,15,29.8,31.4,,F1 gate safe binary --no-conversation
```

### Evidenza no-reboot / stabilità sessione
- Boot id sessione gate: `4ddc2054-0498-444b-9fd7-114498b497ff` (stabile post-gate).
- Uptime monotono durante sessione safe-build + F1 (daily log: ~2900s → ~6500s+ pre-drop precedente; post reconnect sessione continua senza reboot durante gate).
- Smoke diagnostico precedente (conversation hang senza `--single-turn`): kill forzato, **nessun reboot**; non conteggiato come misura scientifica.
- Gate F1: processo esce clean (`Exiting...`, rc=0), `no_llama` residuale assente post-run.
- SSH + adb wireless restano vivi dopo il gate.

### Smoke interattivo (non scientifico)
Prima del gate, load modello OK su safe binary ma hang UI chat senza `--no-conversation/--single-turn`. Documentato in `results/f1/f1_smoke_note.txt`. Fix harness applicato; solo il run con EXIT 0 + CSV conta per il gate.

## Numeri chiave (tabella, riferimenti a run_id)

| Voce | Valore |
|---|---|
| Device | SM-S911U, Android 16, IP 192.168.1.152 |
| Termux | 0.118.3 github-debug arm64, `com.termux` / uid `u0_a344` |
| SSH | porta 8022, key `~/.ssh/moe_s23` |
| llama.cpp SAFE | b10244 / `67d5978` · `build-safe` · NATIVE=OFF · arch armv8.2-a+dotprod+i8mm+fp16 |
| Preflight ISA | EXIT 0 |
| 4B size | 2 740 937 888 B MATCH |
| 35B size | 11 522 702 304 B MATCH |
| LFM2 size | **PENDING** (F2.1/F2.3: re-download PC size esatto 5 044 779 712 + scp) |
| Gate run_id | `Qwen3.5-4B-Q4_K_M-20260804-011324` |
| prompt/eval tok/s | 17.00 / 4.30 |
| Batteria gate | UNPLUGGED 74%, 29.8→31.4°C |

## Deviazioni / sorprese / bug
1. Build iniziale `GGML_NATIVE=ON` → SIGILL probe SVE/SME; rebuild safe obbligatorio (`build-safe`).
2. `llama-cli` b10244 in conversation mode hang senza `--no-conversation --single-turn --simple-io`; short `-no-cnv` ambiguo con `-n`.
3. Parser timings: serve summary `[ Prompt: … | Generation: … ]` oltre a `llama_perf_context_print`.
4. Termux: `/tmp` Permission denied → harness usa `TMPDIR`/`PREFIX/tmp`.
5. **eval_tok_s=4.30** sul gate F1 (t=4, ctx=512, warm short) è sotto la soglia orientativa F2 (~8–10 tok/s [S]); non invalida F1 (gate = genera + CSV). Da ottimizzare in F2.2 (sweep thread/ctx/KV).
6. fio assente → F2.1.
7. LFM2 incompleto/errato size → F2 (non bloccante per gate F1: gate usa 4B).
8. Drop connettività mid-setup storico (wireless debug off); ripristinato; gate eseguito dopo restore.

## Verdetto gate: **PASS**

Criteri PLAN F1 soddisfatti:
1. llama.cpp buildato (safe) gira → preflight EXIT 0 + `--version` 67d5978.
2. Qwen3.5-4B genera testo → log/console gate con output e `Exiting...`.
3. Harness produce riga CSV valida con majflt/read_bytes/temperatura → `runs.csv` + pull PC `results/runs.csv`.

Pending **non-gate** (non bloccano F1): LFM2 size-exact su telefono; fio; sweep F2.

## Prossima azione proposta
1. F2.1: fio UFS random-read curve (build fio da sorgente se serve).
2. Completare LFM2 PC → scp, verify **5 044 779 712** B.
3. F2.2 griglia greedy 4B; F2.3 LFM2; F2.4 termica 10 min.
4. **Non** usare `~/src/llama.cpp/build`; solo `build-safe`.
5. Non aprire F3 finché F2 non ha report.

DONE
