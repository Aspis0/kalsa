# Q47 — 3-D q2_K/q3_K CPU_REPACK load abort

Kernel pin: `Aspis0/kalsallama` `main` @ `9890d1054`.
Branch: `kalsa/fix-q23k-3d-load` (local only; no push).

## Causal chain (desk, before device abort string)

### What the loader actually does

`llama_model_loader::load_all_data` (`src/llama-model-loader.cpp:1543`, `:1571`):

```
size_t n_size = ggml_nbytes(cur);
...
ggml_backend_tensor_set(cur, data, 0, n_size);  // mmap source, extra-buft dest
```

CPU_REPACK weights are already allocated (`cur->data != nullptr`), so the mmap
alias branch is skipped and every expert tensor goes through `tensor_set`.

`n_size` is therefore **whatever `ggml_nbytes` returns after
`ggml_backend_cpu_repack_buffer_init_tensor`**.

### What init_tensor does to nb[]

`ggml/src/ggml-cpu/repack.cpp:5309-5315` (before this fix): on a q23k 8x4
trait it writes `tensor->nb[2] = packed_stride` (64-byte-padded slice, Q3
tile 912 vs native 880) and leaves `nb[0]`/`nb[1]` native.

`ggml_nbytes` (`ggml/src/ggml.c:1289-1311`, quantized branch) is a span:

```
ne[0]*nb[0]/blck + (ne[1]-1)*nb[1] + (ne[2]-1)*nb[2] + (ne[3]-1)*nb[3]
```

After that mutation this is **hybrid**: one native slice plus `(n_exp-1)`
packed strides. It is neither the GGUF payload nor `get_alloc_size`.

Documented wart: `docs/design-repack-q23k.md` buffer-sizing row, and
`scratchpad/agents/q40-m5-repack/REPORT.md` FIX D
("Do not use ggml_nbytes as the packed buffer size"). M0–M5 never drove
`load_all_data`; they passed **native** `wbytes` into `tensor_set`.

### Ranked suspects vs this chain

| # | Suspect | Verdict |
|---|---------|---------|
| 3 | `ggml-backend.cpp:334` `offset+size <= ggml_nbytes` ("tensor write out of bounds") | **Not the abort.** Loader passes `size = ggml_nbytes`, so the check is tautological. (Async twin is `:258`; mmap load uses the sync path.) |
| 1 | `repack.cpp:3282` / `:5339` `size == native src_slice*n_slices` | **Confirmed for 3-D when packed_stride != native_slice.** `set_tensor` special-cases q23k to native geometry (`:5337-5339`); packer asserts the same (`:3281`, `:3323`). Loader `n_size` is hybrid. They disagree iff `n_slices>1` and the packed slice is not byte-identical to the native slice. |
| 2 | `t->nb[2]=stride` at packer `:3303` after `init_tensor` already set it | Double write of the same value. Not an abort during load. After the fix, packer is the **only** writer of packed `nb[2]`. |
| alloc undersize | killed in the bug report | `get_alloc_size` (`:5377-5383`) == packer `stride*n_slices`. Agrees. |

2-D tensors (`ne[2]==1`) always hide the wart: `(ne[2]-1)==0`, so hybrid
collapses to native even when `nb[2]` is packed. That is why blk.0/blk.1
(q5_K/q6_K 2-D, and any 2-D q23k) pass.

### LFM control GGUF geometry (this PC)

File: `scratchpad/agents/q37-bprime-from-source/gguf/lfm/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-control.gguf`
(3 326 160 384 B). `blk.2` from `GGUFReader`:

| tensor | type | ggml ne | native total | packed stride | hybrid after init | loader `n_size` == native? |
|---|---|---|---:|---:|---:|---|
| `ffn_gate_exps` / `ffn_up_exps` | Q2_K | [2048, 1792, 32] | 38 535 168 | 1 204 224 (pad 0; Q2 size-neutral and 64-aligned) | 38 535 168 | **yes** |
| `ffn_down_exps` | Q3_K | [1792, 2048, 32] | 50 462 720 | 1 634 304 (tile 912 vs 880) | 52 240 384 | **NO** (Δ 1 777 664) |

Hand check (same `ggml_nbytes` formula): `scratchpad/agents/q47-q23k-3d-load-fix/NBYTES_MATH.json`.

So **LFM Q3 3-D must abort on suspect 1**. LFM Q2 3-D does **not** have a
size mismatch (payload % 64 == 0). The app report (first abort =
`blk.2.ffn_gate_exps`, Q2) is therefore either:

- they named the first 8x4 log line and the process died 178 ms into packing
  that tensor for a **4th** reason, or
- the abort string will show suspect 1 on a tensor whose hybrid ≠ native
  (Q3, or a Q2 whose slice is not 64-aligned).

Small counterexample that **does** mismatch on Q2 (M2 geometry pin):
`ne=[256,8,3]`, native 2016, packed stride 704, hybrid 2080.

### Abort string (Jelly CLI, pre-fix binary)

```
C:/Users/gualt/Desktop/Kalsa/moe-experiments/worktree-repack-q23k/ggml/src/ggml-cpu/repack.cpp:5339: GGML_ASSERT(size == src_nbytes) failed
```

RC=134 (SIGABRT). `lm_ggml_abort`. Matches the app tombstone
(`load_all_data+3708` is LTO-inlined `set_tensor`).

Harness: `test-repack-q23k-load --loader-set` on `ne=[256,8,3]` Q2
(hybrid 2080 vs native 2016). Raw: `results/q47_3dload_jelly/pre-fix-loader-set.err`.

App log "first q2_K_8x4 = blk.2.ffn_gate_exps, abort 178 ms later":
create order is gate (Q2) then **down (Q3)**. Gate is 64-aligned so
`set_tensor` passes, packer logs `q2_K_8x4`, packs ~38 MiB (~178 ms),
then down Q3 hits `:5339` **without** a `q3_K_8x4` log (assert is
before `repack()`). q3 "never reached" = never logged.

LFM Q2 packing itself is fine (`ok native set_tensor lfm_gate_q2`).

## Follow-on silent-wrong (found while verifying gen)

Stock fused MoE FFN (`ggml_cpu_try_fuse_moe_ffn`) launches native
`vec_dot` on gate/up/down. Extra `compute_forward` never sees those
nodes. On any tiled CPU_REPACK extra that is silent-wrong (slash-spam
at temp 0 on q23k). `-nr` and `GGML_MOE_FUSED_FFN=0` were coherent.
Declined fusion when any of those src0 extras is tiled (pointer-eq
set: K-quant 8x4/8x8, q4_0/iq4/mxfp4/q8 families, RISC-V 16x1);
extra MUL_MAT_ID runs instead. Same decline on fused GEMV. q23k_8x4
alone would have left q5_K_8x4 (Jelly trunk) and q2_K_8x8 (AVX512)
open.

## Fix (chosen)

Keep upstream `ggml_nbytes` / `ggml_backend_tensor_set` bounds check
untouched.

`init_tensor` must **not** publish packed `nb[2]`. The loader's copy size
is native GGUF payload; packed/padded bytes are dest-only
(`get_alloc_size` + packer). Packed `nb[2]` is written once, after the
packer has consumed native bytes (`:3303` / `:3345`). Do not
restore-native on q23k either — that would wipe packed `nb[2]` if
`init_tensor` runs again.

Fence stays loud: q23k `set_tensor` aborts with native vs given vs
`ggml_nbytes` if the source size is not the GGUF payload.

Fused FFN/GEMV decline on **any tiled CPU_REPACK extra**, not only
q23k_8x4. Native `vec_dot` on a tiled layout is the same silent-wrong
for q4_K/q5_K/q6_K 8x4 (Jelly-class) and q2_K_8x8 (AVX512). The
predicate is pointer-equality against the file-static tiled trait
set (`ggml_cpu_repack_extra_is_tiled`); never a virtual call on a
foreign extra. q23k-specific loud fences in `traits.cpp` stay
q23k-scoped. Non-tiled extras and `-nr` fusion are unchanged.

## Not done here

Allocator undersize (killed). Generic bounds-check rewrite to
`get_alloc_size` (unnecessary once `ggml_nbytes` stays native through
load; would change non-q23k extra-buft paths).
