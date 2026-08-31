# Kalsa MoE experiments

This repository contains measurements and experiments for large MoE models on Android
devices. It has no product code and no dependency on the Kalsa app or its engine
repositories.

`PLAN.md` is the live plan and checkpoint ledger. A checkpoint cell is banked only when
its evidence is recorded. `docs/ALIVE.md` is the live results table.

## Evidence layout

- `scratchpad/agents/<cell>/`: per-cell evidence (`PREREG`, `REPORT`, `AUDIT`, and raw data).
- `results/`: raw experiment output.
- `scripts/`: Termux setup, build, benchmark, and download scripts.
- `analysis/`: log parsing, CSV generation, plots, and cache simulation.
- `traces/`: expert-activation traces collected on devices.
- `reports/`: phase reports.

## Method rules

1. Lock the preregistration before collecting numbers.
2. Complete a hostile audit before registering a result.
3. Refer to other repositories by SHA or tag, never by checkout path.

## Building and running (Termux)

The mainline llama.cpp rebuild uses the safe S23 configuration:

```bash
bash scripts/build_llama_termux.sh
# pin b10244, GGML_NATIVE=OFF, -march=armv8.2-a+dotprod+i8mm+fp16
bash scripts/preflight_llama_isa.sh \
  --binary ~/src/llama.cpp/build-safe/bin/llama-cli \
  --build-dir ~/src/llama.cpp/build-safe
```

`run_bench.sh` must invoke the preflight for phases F1–F4. The build directory
must contain `CMakeCache.txt` and `compile_commands.json` beside the binary.
`PREFLIGHT_ISA=0` is an explicit unsafe skip and is rejected for scientific phases.

## Android build constraint

On the S23, do not use the default `GGML_NATIVE=ON`: its native ISA probe can emit
unsupported SVE/SME instructions. The documented safe lane uses
`GGML_NATIVE=OFF`, `-march=armv8.2-a+dotprod+i8mm+fp16`, and exports
`compile_commands.json`. Skipping the ISA preflight with `PREFLIGHT_ISA=0` is unsafe
and rejected for scientific phases.

## Golden rules

One variable at a time; one CSV row per run; small and frequent commits in this repo;
never commit GGUF files; measure only on a physical device, never an emulator; never
measure with USB connected (the device is charging).

## Source basis

Integrated from the existing README, `PLAN.md`, and `docs/ALIVE.md`.
