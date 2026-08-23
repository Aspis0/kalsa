# Q40 M5 — v1 integration (backend-ops, real KEXP, pre-device evidence)

Status: M4 audit fixes applied. M5 done. Host PASS. Jelly Star PASS. v1 closed. No v2/cache.

Fork: `kalsa/repack-q23k` (see commits below). Base pin `1882bf8cd`.
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`

M0–M4 reports remain under `scratchpad/agents/q40-m{0,1,2,3,4}-repack/`.

## How the repack path was verified to engage

`test-backend-ops` allocates the **default CPU buffer**, not `CPU_REPACK`. Extra-buft `supports_op` only runs when `src0` is already on the extra buffer. Adding Q2/Q3 cases there tests native CPU vs other backends; it does **not** by itself run 8x4.

Engagement proof is `test-repack-q23k-m5`, which allocates weights from `ggml_backend_cpu_repack_buffer_type()` and asserts `ggml_cpu_repack_extra_name(w)`:

Jelly:

```
  ok A/B native-vs-repack q2_K GEMV extra=Q2_K_8x4
  ok A/B native-vs-repack q3_K GEMV extra=Q3_K_8x4
  ok A/B native-vs-repack q2_K GEMM M=4
```

Log lines `repack: repack tensor with q2_K_8x4` / `q3_K_8x4` match. Native A/B uses the default CPU buft (vec_dot); repack uses extra. Same graph, same quantized bytes, `tol = 1e-4*(1+max|ref|)`.

Host x86: 8x4 is never selected (`neon=0`). A/B extra-name check skips. Honest: this PC cannot prove the NEON kernel via llama `--no-repack`.

## test-backend-ops wiring

Added 8x4-eligible shapes (commented) in `tests/test-backend-ops.cpp`:

- `MUL_MAT` Q2_K/Q3_K: `m=8 n=1 k=256` and `m=16 n=4 k=256`, `bs={1,1}`
- `MUL_MAT_ID` Q2_K/Q3_K: `(n_mats,n_used,m,n,k)` = `(3,2,8,1,256)` and `(5,2,16,7,256)`

Q2_K/Q3_K were already in `other_types` (generic loops). The new cases are explicit 8x4-shaped pins. Full `test-backend-ops` was **not** run on Jelly (thousands of ops, hours). That is an M5 gap listed below.

## Real KEXP tensors (Marco, read-only)

File: `models/Marco-Mini-Instruct-KEXP.gguf` (not modified). Host-only (6.3 GiB; not on Jelly).

| Tensor | type | ggml ne | 8x4? | Result |
|---|---|---|---|---|
| `blk.0.ffn_gate_exps.weight` | q2_K | [1024, 768, 256] | yes (K%256=0, N%8=0) | expert0 GEMV vs native `to_float`·q8 **PASS** |
| `blk.0.ffn_up_exps.weight` | q2_K | [1024, 768, 256] | yes | expert0 GEMV **PASS** |
| `blk.0.ffn_down_exps.weight` | q3_K | [768, 1024, 256] | yes (768=3×256, 1024%8=0) | expert0 GEMV **PASS**; packed stride 350208 vs native slice 337920 (+32 B/tile) |

First 8 experts packed (real bytes, bounded RAM). Not a full-model logit A/B (`llama --no-repack`): host cannot select 8x4; Jelly does not have the GGUF.

## Pre-device evidence (exploratory, not a cell)

Allocation (Marco, 8 experts):

| | native slice | packed stride |
|---|---:|---:|
| Q2 gate/up | 258048 | 258048 (size-neutral) |
| Q3 down | 337920 | 350208 |

Host micro-bench (generic scalar GEMV, k=256 n=64 n_as=3 reps=50): `gemv_us=10`, `id_3x_gemv_us=31`. RSS N/A on MSVC.

Jelly (A76, plugged=**unknown** — adb shell, no battery protocol):

```
gemv_q2_8x4_us=6  id_3x_gemv_us=19  rss_kb=5844
graph_native_gemv_us=34 graph_repack_gemv_us=51
```

The graph-repack number is **not** a speedup claim: the v1 kernel is correctness-first (per-column sdot), the graph path pays q8 quantize + extra buft, and the shape is tiny. Native 34 µs vs repack 51 µs on this micro is expected and **not** a residency result.

## M2/M3/M4 rerun

Host and Jelly all PASS after the two audit fixes. Batched-src1 fence: one abort line, `n_threads=1`. M4 id modes distinct on both.

## Honest gaps (device-validation phase)

1. Full-model logits A/B (`--no-repack` vs extra bufts) on Jelly with Marco/LFM not run — needs the GGUF on device, app/llama-cli, 16-turn protocol from the design doc.
2. `test-backend-ops` extra path does not engage; only the M5 harness does. Running filtered backend-ops on Jelly is still native-CPU vs itself.
3. v1 GEMM/GEMV are not throughput-tuned; do not use the micro-bench as a ship gate.
4. Batched 2-D MUL_MAT (`src1.ne[2]>1`) is declined; MoE decode is `MUL_MAT_ID` / M==1.
5. Selective cache / mmap residency (v2) not started. Full repack of Marco experts is ~6 GB extra anonymous — not a Jelly default.
6. i8mm / 8x8 out of v1.
7. Plugged state undeclared; no energy/`majflt`/RssFile pairing.
8. Host ASan/UBSan not run (MSVC recipe).

v1 is closed at M5. Owner integration decision next. No v2/cache work started.

## Commits

See git log on `kalsa/repack-q23k`. Artifacts: `results/repack_q23k/m5_jelly/`.
