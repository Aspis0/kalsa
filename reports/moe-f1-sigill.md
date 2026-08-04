# F1 addendum — SIGILL CMake probes / rebuild safe (2026-08-03)

## Evidenza (read-only adb, device SM-S911U Android 16)

### Tombstone CMake (21:14)
Due `SYSTEM_TOMBSTONE` con `signal 4 (SIGILL)`:

| Probe | Path CMakeScratch | Flag compile |
|---|---|---|
| `GGML_MACHINE_SUPPORTS_sve` | `TryCompile-i2qseL/cmTC_b48f7` | `-mcpu=native+sve` |
| `GGML_MACHINE_SUPPORTS_sme` | `TryCompile-Ji7jtN/cmTC_1ecb1` | `-mcpu=native+sme` |

Fonte: `dumpsys dropbox` + `build/CMakeFiles/CMakeConfigureLog.yaml`  
(`runResult.stderr: Illegal instruction`, `exitCode: FAILED_TO_RUN`).

### CMakeCache del build F1 (`~/src/llama.cpp/build`)
- `GGML_NATIVE:BOOL=ON`
- `GGML_CPU_ARM_ARCH:STRING=` (vuoto)
- Feature probe: `HAVE_DOTPROD=1`, `HAVE_MATMUL_INT8=1`, `HAVE_SVE=` vuoto, `HAVE_SME=` vuoto

### Flag finali `libggml-cpu` (`compile_commands.json`)
```
-U__ARM_FEATURE_SVE -U__ARM_FEATURE_SME -mcpu=native+dotprod+i8mm+nosve+nosme
```
Quindi: i probe SVE/SME hanno fallito come previsto; il binario **non** abilita esplicitamente SVE/SME, ma resta su `-mcpu=native+…`.

### CPU (`/proc/cpuinfo`)
Features: `asimddp` (dotprod), `i8mm`, `bf16`, `fphp` — **senza** `sve`/`sme`.  
ABI: `arm64-v8a`. Bootreason history: multipli `reboot` (correlazione temporale, **non prova di causalità**).

### `llama-cli --version` (no `-m`)
- Output: `version: 1 (67d5978)`, Clang 21.1.8 Android aarch64.
- Un’invocazione ha prodotto anche tombstone `SIGSEGV` su `--version` (fault addr `0x30`); riesecuzione successiva exit 0. Non prova reboot; segnala binario/ambiente fragile.

## Ipotesi

| Ipotesi | Verdetto |
|---|---|
| SIGILL da probe CMake SVE/SME con `GGML_NATIVE=ON` | **PROVATA** (tombstone + configure log) |
| Binario finale emette SVE/SME | **Non supportata** dai flag finali (`+nosve+nosme`) |
| Binario con `-mcpu=native` potenzialmente non riproducibile / fragile | **Plausibile** (native + segfault intermittente su `--version`) |
| Probe SIGILL **causano** i reboot full | **Non provata** — solo correlazione temporale con `ro.boot.bootreason=reboot` |

## Fix repo (senza rebuild sul telefono in questo turno)

1. `scripts/build_llama_termux.sh` — pin `b10244`/`67d5978`, `GGML_NATIVE=OFF`,  
   `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, CURL/OpenCL off, preflight.
2. `scripts/preflight_llama_isa.sh` — blocca NATIVE/mcpu=native/SIGILL in log, check cpuinfo, `--version` only.
3. `scripts/build_bmoe_termux.sh` — allineato: NATIVE off + arch esplicita (prima lasciava NATIVE default ON).
4. `scripts/run_bench.sh` — preflight ISA automatico se trova `CMakeCache` accanto al binario, o `PREFLIGHT_ISA=1`.

## Rebuild consigliato (Termux, quando gualt autorizza)

```bash
# push script da PC, poi in Termux:
cd ~/experiments   # o dove copi gli script
bash scripts/build_llama_termux.sh
# produce ~/src/llama.cpp/build-safe/bin/llama-cli
# NON riusare ~/src/llama.cpp/build (NATIVE=ON)
```

Smoke modello **solo** dopo preflight OK + batteria UNPLUGGED ≤32°C (non eseguito qui).
