# q62 PC-only bmoe-cli preparation

Status: an existing arm64 Android CPU-only `bmoe-cli` was found on the PC, so no build was run.

## Scope and safety

- PC filesystem inspection only.
- No device access and no `adb`.
- No Git executable or Git operation was used. The checkout metadata and index were read as ordinary files solely to record provenance/state.
- `BigMoeOnEdge/` was not edited, checked out, updated, or built in-tree.

## Selected artifact

Binary:

`C:\Users\gualt\Desktop\Kalsa\moe-experiments\models_staging\ship_runtime_s23_0ac612de\bmoe-cli`

- Size: `6,362,168` bytes
- SHA-256 (Python `hashlib.sha256`): `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`
- It is an AArch64 ELF (`ET_DYN`) Android binary.
- It is dynamically linked. Push the complete runtime directory, not the executable alone. The bundled files are `bmoe-cli`, `libc++_shared.so`, `libggml-base.so`, `libggml-cpu.so`, `libggml.so`, `libllama-common.so`, and `libllama.so`.
- Local archive records: `models_staging/ship_runtime_s23_0ac612de/MANIFEST.md` and `models_staging/ship_runtime_s23_0ac612de/DEVICE.sha256`.
- The local manifest identifies this as the PC-side archive pulled from the S23 deployment on 2026-08-16 and reports the seven-file runtime check as `7/7 OK`.

No `bmoe-cli --help` execution was attempted because this is an arm64 Android executable and the requested emulator/device execution was not needed.

## Provenance and ISA

The local provenance record `results/kernel_ke/source_pins.txt` identifies the Mellum2/dotprod source as:

- BigMoeOnEdge source commit: `d98702747593e169f5b05fade8af661894fe86f3`
- llama source commit: `e5605f3bd3545867b2eb2581c96fd7042e243541`
- NDK: `27.1.12297006`
- Android API: `29`
- CPU arch flag: `armv8.2-a+dotprod+fp16`
- Build record: CPU/dotprod variant; no i8mm and no SVE requirement

The archive has no bundled OpenCL, Hexagon, or Vulkan runtime library; its ELF dependencies are the CPU/Android runtime set. This is the Jelly/S23 A76-compatible dotprod build. It should run on the Xiaomi 8 Gen 3, which supports dotprod and i8mm; it does not require i8mm or SVE.

The Mellum2 `5.151 t/s` product number was a S23 decode result, not a q62 prefill result. The local records are `PLAN.md` (the 5.151 product/config entries), `results/lineup_abs_s23/REPORT.md` (the dedicated `0ac612de...` binary and decode command), and `results/kernel_ke/source_pins.txt` (source/ISA provenance).

The local build directory `BigMoeOnEdge/build-android-mellum2/cli/bmoe-cli` is a different artifact (`559bc59d341441473d3a4e5e0876991cbec90b46d5bbf0b884aeb8a4651b7a73`), so it is not claimed as the selected archive's build output. Its historical build log is `results/mellum2_kernel_s1/build_android_bmoe.log`.

## Current BigMoeOnEdge checkout state

Read-only checkout metadata reports:

- HEAD ref: `refs/heads/kalsa/drop-policy-s2`
- HEAD: `9f2584f0db51647a22e5fb9ed2c13db2daa96420`
- Dirty: **yes**
- Diff summary: nine tracked paths differ from the index:
  `cli/main.cpp`, `core/include/bmoe/config.h`, `core/include/bmoe/metrics.h`, `core/src/engine/session.cpp`, `core/src/metrics/csv_metrics_sink.cpp`, `core/src/moe/router_hook.cpp`, `core/src/moe/router_hook.h`, `docs/assets/hero-dsv4.gif`, and `docs/assets/hero.gif`.

No cleanup or mutation was performed. No untracked-file claim is made here because the requested Git command was intentionally not run.

## Source flag validation

The exact spellings were checked in `BigMoeOnEdge/cli/main.cpp`; defaults come from its local variables and `BigMoeOnEdge/core/include/bmoe/config.h`.

| Flag | Current source default/meaning | Used by PREREG? | Mismatch |
|---|---|---:|---|
| `--moe-stream` | Off by default (`enabled=false`); enables MoE streaming | Yes | None |
| `--cache-mb` | `0` by default; `auto` is an explicit alternate | Yes (`0`) | None |
| `--dense-weights` | `anon` / anonymous mode by default | Yes (`anon`) | None |
| `--io-threads` | `4` by default | Yes (`4`) | None |
| `--ubatch` | `0` by default, meaning follow the context width | Yes (`512`) | None; PREREG overrides the default |
| `--no-think` | Thinking is on by default (`think=true`); this flag disables it | Yes | None |
| `--progress` | Off by default | Yes | None |
| `--csv` | No path and no CSV sink by default; takes an output path | Yes (path) | None |
| `--io-trace` | No path and no I/O trace by default; takes an output path and is meaningful with streaming | Optional | None |
| `--cache-ceil-mb` | `0` by default, meaning no ceiling | Not in frozen command | None |
| `--compute-trace-layers` | Off by default; takes a path and enables compute-layer tracing | Not in frozen command | None |

All eleven requested spellings exist exactly in the current source. The only operational nuances are that `--csv`, `--io-trace`, and `--compute-trace-layers` are path-valued options, and `--ubatch 512` is an explicit override of the source default `0`.

## Build record

`build_log_path: N/A (existing suitable binary found; no out-of-tree build run)`.

The requested Android-31/Release build branch was therefore not entered. The selected existing artifact is recorded as Android API 29 above; its reuse avoids changing the WIP submodule or creating a second binary.

Frozen command source: `scratchpad/agents/q62-product-streamer-prefill/PREREG.md`. Scout/product notes: `scratchpad/agents/q62-product-streamer-prefill/SCOUT.md`.
