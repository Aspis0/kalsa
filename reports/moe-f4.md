# F4 — BigMoeOnEdge 35B su S23 — 2026-08-06

## Cosa è stato fatto (vs piano)

- **F4.1 Build**: trasferito monorepo pinnato `b0c4e5b` + submodule `5236140e5` via tar (no clone rete). Build `build-bmoe` on-device: `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_CURL=OFF`, `GGML_OPENCL=OFF`. Preflight ISA OK. Smoke 4B dense OK (`bmoe-cli` 0.19.0, rc=0).
- **Fix Termux AHardwareBuffer**: raise globale `__ANDROID_API__=28` rompeva libc++ (`strtof_l`). Soluzione: wrapper CXX che compila solo `platform_io.cpp` con `-U__ANDROID__` (stub ahwb). Nessuna patch al monorepo. Headline F4 usa `--dense-weights anon`.
- **Harness**: `run_bench.sh` esporta `LD_LIBRARY_PATH` dalla dir del binario (root cause F3). Script `run_f4.sh` / `start_f4.sh` (§8.2).
- **F4.2 riga C**: 3 rep + sentinella warm, cold=fadv, UNPLUGGED, cooldown 180s, T≤30, n_gen=64, flags PLAN (`--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4`). `runtime_commit=b0c4e5b`. `ttft_ms` popolato (wall-clock stream).
- **F4.3**: avviato `C2-cacheauto` (warm); **non completato** in questa sessione (cooldown in corso a chiusura report). Nessun dato C2/dio/ahwb in CSV.

## Numeri chiave

### Riga C (F4.2) — §9

| run_id | type | eval tok/s | ttft_ms | hit-rate | majflt | read_bytes | RAM peak |
|---|---|---:|---:|---:|---:|---:|---:|
| …-103901 | cold | **0.93** | 87401 | 56.9% | 35690 | 3.34e10 | 4736 MB |
| …-104453 | warm | **0.96** | 87011 | 56.9% | 31386 | 3.31e10 | 4709 MB |
| …-105043 | warm | **0.97** | 87092 | 56.9% | 34878 | 0* | 4648 MB |
| …-105632 | warm sent | **0.94** | 85505 | 56.9% | 33472 | 3.31e10 | 4755 MB |

\*rep3 `read_bytes_delta=0` — anomalia telemetria `/proc/io`; non usata per MiB/tok.

**Mediane C**: cold **0.93** tok/s; warm (3 measure+sent: 0.96, 0.97, 0.94) → mediana warm **0.96** tok/s.  
**MiB flash/tok** (warm rep2): `33074880512 / 1024² / 64` ≈ **494 MiB/tok** (vs naive F3 ~9.5 GiB/tok ≈ 20× meno).  
**majflt/tok** warm: ~490–545 (vs F3 ~3.6e5).  
**hit-rate**: **56.9%** stabile; log: `moe-cache: 8843 evictions, 4848 re-reads (75.8/token)` sul cold.  
**Sentinella**: 0.94 vs mediana 0.96 → deviazione ~2% (<15%) → stage valido.

### Confronto baseline naive F3

| | naive B/B2 | BigMoe C |
|---|---:|---:|
| tok/s warm | 0.10 | **0.96** (~9.6×) |
| MiB flash/tok | ~9700 (9.5 GiB) | ~494 |
| majflt/tok | ~3.6e5 | ~5e2 |
| hit-rate | n/a | 56.9% |

### Gate F4

Definizione: x = mediana warm best config.  
x = **0.96** tok/s < **1.5** → **STOP S23** (anche se x ≥ 3× naive: 0.96 ≥ 0.30).  
Il gate assoluto non è soddisfatto; il guadagno relativo sul muro è reale ma insufficiente per prodotto su 8GB/UFS3.1 con questa config lossless.

## Deviazioni / sorprese / bug

1. Build Termux: AHardwareBuffer API 24 → wrapper CXX (ahwb non misurabile in questa build).
2. `ttft_ms` << `load_s` annotato (`ttft_lt_load`): load_s da parser bmoe vs wall-clock stream; tok/s e hit-rate restano validi.
3. Hit-rate 56.9% << attesa letteratura ≥80% con cache ~2GB (H2 parziale: traffico ↓ ma cache sotto-saturata o working-set > 2GB su questo prompt).
4. CRLF su `run_bench.sh` dopo scp da Windows: un rep perso (exit 2); fix LF e rilancio.
5. F4.3 non chiuso: solo C misurato; C2/dio/ahwb assenti.

## Verdetto gate: STOP

S23 8GB / UFS 3.1: BigMoeOnEdge default (C) = **0.96 tok/s warm** (n=3+sent, commit `b0c4e5b`), hit 56.9%, ~494 MiB/tok.  
≥3× naive sì; ≥1.5 tok/s **no**.  
STOP binario B su S23: documentare; opzioni (a) device UFS4/più RAM, (b) prodotto su binario A (LFM2/4B), (c) F7–F8 predictor se si accetta PASS-condizionato solo con sweep che salga ≥1.5 (non dimostrato qui).

## Prossima azione proposta

- Completare F4.3 se batteria/tempo: cache-auto, 1500, io-threads, no-overlap, dio mainline (confronto).
- Non aprire F5 finché non c’è decisione gualt sul STOP.
- Eventuale re-measure ahwb solo con NDK/API≥26 o path non-Termux.

DONE
