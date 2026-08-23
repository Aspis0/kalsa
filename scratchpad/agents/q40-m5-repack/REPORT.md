# Q40 M5 — v1 integration (backend-ops, real KEXP, pre-device evidence)

Status: M5 done. Max-recall NIT 1–3 + pass-3 FIX A–D landed. Host PASS. Jelly Star PASS. v1 closed. STOP. No v2/cache.

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

Those 34 vs 51 µs numbers were **mislabeled** (alloc + `set_tensor` inside the timed loop). Replaced by the three-number bench in `maxrecall-fixes` below. No speed claims.

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

## maxrecall-fixes

Pass 1–2 NITs + cold-eyes pass 3 (2 CONFIRMED HIGH + MED). Applied, host+Jelly rerun, pushed. Then STOP.

### NIT 1 — three labeled numbers (not a speed claim)

Old `graph_native_gemv_us=34 graph_repack_gemv_us=51` included alloc + `set_tensor` inside the timed loop (full repack every iter). Harness now hoists pack/alloc into `graph_job` and prints:

Jelly A76 (shape n=64 k=256, GEMV M=1):

```
  (a) kernel-compute-only native_us=3 repack_us=5
  (b) one-time packing_us=43 (set_tensor on CPU_REPACK, n=64 k=256)
  (c) repack is not faster per call at this shape; value is residency only
```

(a) is compute-only per call. (b) is the eviction/repack cost in production. (c) is `packing_us/(native_us-repack_us)` only if repack is faster per call; here it is not. Host skips this block (`neon=0`).

### NIT 2 — K match + src1 ne[3]

`forward_mul_mat_q23k` asserts `src0->ne[0]==src1->ne[0]`. `supports_op` MUL_MAT_ID (q23k inner branch) and `compute_forward` both require `src1->ne[3]==1`. Confirmed: the ne[3] check is in `supports_op`, not only a forward assert.

### NIT 3 — phrasing

M5 does **not** run host model logits. It packs the first 8 experts of real Marco KEXP tensors and runs expert0 GEMV vs native `to_float` · q8. Host: gate Q2, up Q2, down Q3 all PASS. Full-model `--no-repack` A/B is still an honest gap (host cannot select 8x4; Jelly does not have the GGUF).

### FIX A (HIGH) — n_as==1 shape gate

`ggml_n_dims(src0)==3` is 2 for `[K,N,1]`. A single-expert MoE was packed at load then declined at dispatch → fence abort. Both `supports_op` and `compute_forward` now gate `src0->ne[2] >= 1 && src0->ne[3] == 1`. Dropped `GGML_ASSERT(ggml_n_dims(src0)==3)` in `forward_mul_mat_id_q23k`.

M4 kernel + graph grids include `n_as==1`. Jelly graph: `ok graph q2_K nas=1 tok={1,2,7,16}` (and q3_K) all three id modes. Host kernel `nas=1` PASS; graph skipped (no neon).

### FIX B (HIGH) — pointer equality, not `name()`

`ggml_repack_is_q23k_8x4` used to `static_cast` any `tensor_traits*` to `repack::tensor_traits_base` and call `name()`. KleidiAI/AMX/SpaceMIT extras share `tensor->extra` and do not have that vtable slot. The fence in `traits.cpp` calls this on **every** op with `src0->extra` set → UB/crash on `GGML_USE_CPU_KLEIDIAI` builds.

Fix: hoist `q2_K_8x4_q8_K` / `q3_K_8x4_q8_K` to file-static instances; identify by **pointer equality** against those two addresses. `ggml_cpu_repack_extra_name` uses the same compare (no virtual call). No test here can exercise KleidiAI — the pointer-eq rewrite is the proof.

### FIX C (MED) — decline null src1/src2

`supports_op` MUL_MAT_ID now returns false when `src[1]==null` or `src[2]==null` (previously null src2 passed, then `forward` asserted). src2 must be I32. Combined with NIT 2 `src1->ne[3]==1` in the same `supports_op` branch.

### FIX D (MED) — decline views

Views over 8x4-tiled tensors keep native `nb[0]/nb[1]` and can point into a misaligned packed offset (Q3 tile 912 vs native 880 + 64 B pad). `init_tensor` `GGML_ABORT`s if `tensor->view_src != nullptr` on a q23k-traited tensor.

**ggml_nbytes hybrid (known contract wart):** packed Q3 uses native `nb[0]/nb[1]` (880 B/row) plus packed `nb[2]` (912 B/tile × groups). `ggml_nbytes` therefore does not equal the packed allocation. `set_tensor` is special-cased to the native source size; `get_alloc_size` uses the packed stride. Do not use `ggml_nbytes` as the packed buffer size.

### Noted, no code change

- Expert-id `GGML_ASSERT(expert_id >= 0 && expert_id < n_as)` is DoS-not-OOB on a corrupt GGUF (acceptable for v1).
- Non-`MUL_MAT` / non-`MUL_MAT_ID` ops on a tiled extra abort by design. This is a **CPU-only-v1** limitation: it blocks a multi-backend weight copy that would otherwise fall through to native. v2 if a second backend must read the same buffer.
- q8_K float `d` matches upstream (auditor REFUTED the divergence worry).

### M0 test update

M0 still asserted `supports_op` false ("must decline until M4" / "M0 has no kernels"). On Jelly, 8x4 is selected and M2/M4 dispatch is true — those two checks now expect `supports_op` true. Host still skips (extra=null).

### Rerun

Host x86 (8x4 never selected): M0–M5 RESULT: PASS. Marco expert0 GEMV PASS.

Jelly Star `192.168.1.82:35785` (A76, neon+dotprod). SHA256 host==device for m0–m5 + `libomp.so`. `LD_LIBRARY_PATH=.`. KEYCODE_WAKEUP. M0–M5 RESULT: PASS. Extra names `Q2_K_8x4` / `Q3_K_8x4` via pointer-eq. Graph `nas=1` PASS.

v1 complete. No further work until the owner integration decision.
