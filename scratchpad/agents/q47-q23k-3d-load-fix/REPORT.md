# Q47 — 3-D q2_K/q3_K mmap load abort on CPU_REPACK

Kernel: `Aspis0/kalsallama` `kalsa/fix-q23k-3d-load` (local, not pushed),
based on `main` @ `9890d1054`. Worktree: `worktree-repack-q23k`.
Outer `BigMoeOnEdge` WIP was not touched.

## Abort string

```
ggml/src/ggml-cpu/repack.cpp:5339: GGML_ASSERT(size == src_nbytes) failed
```

Jelly `test-repack-q23k-load --loader-set`, RC=134. Raw:
`results/q47_3dload_jelly/pre-fix-loader-set.err`.

## Confirmed mechanism

**Suspect 1** (loader `n_size = ggml_nbytes` after `init_tensor` mutated
`nb[2]` to the packed/padded slice stride). Hybrid `ggml_nbytes` is
neither GGUF payload nor `get_alloc_size`. `set_tensor` requires native
geometry. 2-D hides it (`ne[2]-1==0`). LFM Q2 3-D is 64-aligned so it
packs; LFM Q3 3-D (next in create order) aborts. 178 ms is the Q2 pack.

Suspect 3 (bounds check) is tautological. Suspect 2 is not the abort.
Allocator undersize remains killed.

Follow-on (gen): stock fused MoE FFN ran native `vec_dot` on tiled
extras (silent-wrong, slash-spam). Declined for **any** tiled
CPU_REPACK extra, not only q23k_8x4.

Desk math: `NBYTES_MATH.json`. LFM control GGUF
`blk.2.ffn_gate_exps` Q2 `[2048,1792,32]` native==hybrid;
`ffn_down_exps` Q3 `[1792,2048,32]` hybrid 52240384 vs native 50462720.

## Fix

`init_tensor` no longer writes packed `nb[2]` for q23k. Packer remains
the single writer after consuming native bytes. `set_tensor` aborts with
both sizes if the source is not native. Fused FFN/GEMV skip when src0
extra is **any tiled CPU_REPACK trait** (pointer-eq against the
file-static 8x4/8x8/16x1 set — q4_K/q5_K/q6_K 8x4 on Jelly, q2_K_8x8
on AVX512, q23k, q4_0/iq4/mxfp4/q8 families). Never deref a foreign
extra. Upstream `ggml_nbytes` / tensor-set bounds check untouched.

Landing review (BANK-with-fixes) also added: padded-size death test
(`get_alloc_size` into `iface.set_tensor`, longjmp, n_threads=1);
`test-repack-q23k-load` exit 77 SKIP on hosts without 8x4.

## Tests

| Where | What | Result |
|---|---|---|
| Host x86 | M0–M5 | PASS |
| Host x86 | `test-repack-q23k-load` | **SKIP exit=77** (neon=0; banner in `host-load-skip.err`) |
| Jelly pre-fix | `--loader-set` padded 3-D Q2 | abort string above |
| Jelly post-fix | `--loader-set` + padded-size death test | RC=0; abort on alloc 2112 vs native 2016 |
| Jelly post-fix | M5 A/B GEMV/GEMM | PASS (`m5-ab.out`) |
| Jelly | `llama-completion` mmap+repack smoke | RC=0; greedy names Paris (`cli-smoke.out`) |
| Jelly | same with `-nr` | RC=0, coherent (`cli-norepack.out` + `.err` + `.rc`) |

Android: `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`, no i8mm.
Fingerprints: `results/q47_3dload_jelly/SHA256SUMS.txt`
(garbage-demo `665AFB98…`; landing `llama-completion` `74D83F75…`,
`test-repack-q23k-load` `650C3396…`). App tombstone stderr was never
on this PC; CLI capture in `TOMBSTONE.md`.

Device logs: `results/q47_3dload_jelly/`.
