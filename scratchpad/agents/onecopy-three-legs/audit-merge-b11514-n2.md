# Hostile audit of the upstream b11514 merge (engine 904d38fad)

- **Auditor:** deepseek-v4.1-flash, pi, `6f1364b8` (archived). The writer was GLM `9e7a7cb9`.
- **Scope:** critique only. The auditor's builds ran in /tmp.
- **Coordinator verification:** the coordinator checked the load-bearing lines of F1, F2 and F4 on disk (marked "verified" below).
- **Status:** fixes delegated to GLM `2bd68f3d`.

## Findings

- **F1, P1, CONFIRMED (verified): the HMX gate for MUL_MAT_ID.**
  - The merge took upstream's `if (ne01_padded % 32 != 0 && is_matmul_id) return false;` and dropped our gate 15ad4b8e3, which also required the logical `src0->ne[1] % 32 == 0`.
  - Plain MUL_MAT is safe, because the HMX store clamps to `dst_cols` (`hmx-mm-kernels-tiled.h:1018`).
  - MUL_MAT_ID is not safe:
    - the DSP sees the padded ne[1], from upstream's own `h.ne[1] = hex_round_up(t->ne[1], 32);` (`ggml-hexagon.cpp:3325`, blame Krasnyansky 8be759e6f7);
    - so `if (k % 32 != 0 || n % 32 != 0) { return -1; }` (`matmul-ops.c:3761`) passes;
    - then the scattered store (`hmx-mm-kernels-tiled.h:1540` `assert(n_cols % HTP_MM_HMX_TILE_N_COLS == 0);`) writes round_up(N,32) floats into rows of logical width N.
  - Exposure: a repacked MoE weight with N % 32 != 0, with batch >= 5.
  - TILE32 one-copy is not exposed. A TILE32 operand is MUL_MAT-only, 2D (`ggml-hexagon.cpp:9236`).
  - The merger's evidence ("DSP consumes valid_rows") is the HVX macro, not HMX.
- **F2, P2, CONFIRMED (verified): narrow fopen for the slot-save temp file.**
  - `server-context.cpp:2668` creates it with `std::fopen(tmppath.c_str(), "wbx")`, while the other streams use u8path.
  - Effect: on Windows, a non-ASCII slot filename fails to save.
- **F3, P2, CONFIRMED: n_written and n_read disagree.**
  - n_written counts the KSID trailer (`server-context.cpp:3198`).
  - n_read skips it for a file with no checkpoints (`:2767` returns 0).
- **F4, P1, upstream-inherited, CONFIRMED (verified): Metal vec FA crash.**
  - The vec path is chosen by `(ne01 < 20) && (ne00 % 32 == 0)` (`ggml-metal-ops.cpp:3081`).
  - supports_op allows any dv < dk (`ggml-metal-device.m:1747`).
  - `fa_vec_f32.metal` instantiates only dk==dv pairs plus 96/64, 192/128, 320/256 and 576/512.
  - Any other pair gets a NULL pipeline and a SIGSEGV at `ggml-metal-ops.cpp:4032`.
  - The code is byte-identical to de7fa0a3c.
  - It is reachable from a GGUF with an odd (dk, dv) pair. We know of no shipping model with one.
- **F5, P2: hygiene.** -Wmissing-prototypes in 3 fork-only functions (governor tests, governor-bench-run).

## The merger's 11 claims

| Claim | Verdict |
|---|---|
| 1 (HMX gate) | REFUTED for MUL_MAT_ID (F1) |
| 2 (env opts) | CONFIRMED |
| 3 (raw-Q4_0 / renames) | CONFIRMED |
| 4 (opt_mbuf_dyn / static) | CONFIRMED |
| 5 (buft nullptr slots, null-checked wrappers) | CONFIRMED |
| 6 (OpenCL `.data()`, y8 gate intact at `ggml-opencl.cpp:27135/27163`) | CONFIRMED |
| 7 (server hunks) | CONFIRMED, except F2 |
| 8 (KV rotation vs KSID trailer offsets) | CONFIRMED |
| 9 (no duplicate save/restore blocks) | CONFIRMED |
| 10 (no fork-added line lost except the HMX gate) | CONFIRMED |
| 11 (Metal) | CONFIRMED as pre-existing upstream, but reachable in production (F4) |

Two notes:
- Upstream bumped `LLAMA_STATE_SEQ_VERSION` from 3 to 4, so slot files saved by the pre-merge binary are refused cleanly, not misparsed.
- `GGML_HEXAGON_MBUF=<n>` (a single value) now sets only the dynamic cap.

## The auditor's runs

- **Build and ctest:** CPU-only /tmp build, then `ctest -R "tile32|governor|leg-contexts|bench-logits|save-load"`: 12/12 passed, 7 env-gated skips.
- **OpenCL:** the 9 TUs compile against Khronos headers.
- **Not built:** no DSP or Metal build. The DSP and Metal conclusions are line-level code reading.
