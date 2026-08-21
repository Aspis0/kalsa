# q6k-cherry-audit — hostile review of 5c7e16fa682834ee4d4ba9dca8a18b283af95393

Repo: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack` (HEAD = audited commit, working tree clean under `ggml/src/ggml-opencl/`).
Upstream reference: `6503355df0eb4f65875012523263c302fe0088c1` (PR #26476).
Method: diff-of-diffs of the two commits, full read of both post-images, mechanical ifdef-stripping comparison of the kernel fast path, grep-level sweep of every `kernel_mul_mv_q6_K_f32_flat` touch point, and recomputation of every hash/count/timestamp claimed in `results/q6k_cherry_s23/MANIFEST.md`.

All file:line references are to the post-image of `5c7e16fa6` unless marked `^` (parent).

---

## Findings

### F1 — Gate bug: `q6_k_flat_old_compiler` is TRUE on Intel (and any non-Adreno) device — CONFIRMED
**ggml-opencl.cpp:6019-6024**, with **ggml-opencl.cpp:296-315** and **:162-177**.

- `get_adreno_cl_compiler_version()` returns `{}` when the driver string contains neither `E031` nor `DX` (:309). `ggml_cl_compiler_version` is an aggregate whose first member `ADRENO_CL_COMPILER_TYPE type;` has **no default initializer** (:163), and `enum ADRENO_CL_COMPILER_TYPE { E031, DX }` makes `E031 == 0`. So `{}` value-initializes `type` to **E031** with major=minor=patch=-1.
- The new gate is `type == E031 && !newer_than_or_same(E031,45,0,0)`. With type=E031(0) and versions -1/-1/-1, `newer_than` computes `-10101 > 450000` → false; `same` → false. So the gate evaluates **true on every Intel device** (the only non-Adreno family that passes device registration, :5901).
- The codebase knew about this exact trap: the pre-existing q4_0 flat-kernel gates at :2003 and :2021 explicitly guard `backend_ctx->gpu_family != ADRENO || ...`. The new gate dropped that guard.
- Consequence chain: `load_cl_kernels()` builds `mul_mv_q6_k_f32_flat.cl` unconditionally (:2225-2250, not inside any SOA_Q ifdef), so Intel compiles the kernel with `-DADRENO_OLD_COMPILER=1`: scalar dequant, printf machinery, extra kernel arg. The host then sets arg 17 because the same flag is true (:20946-20949), so args stay consistent — **no runtime error, no wrong output**, but Intel eats the measured 13-20% q6_K GEMV penalty the change explicitly claims to avoid ("everyone else gets the original source", :2236-2238), and both the commit message and the kernel header comment (`mul_mv_q6_k_f32_flat.cl:31-36`) are false for Intel.
- Provenance: byte-identical in upstream `6503355df` (verified by diff-of-diffs). This is a faithfully inherited upstream defect, not a cherry-pick error.

Severity: perf-only, correctness-neutral, zero impact on the branch's Adreno/S23 target. But it is a real logic hole against the stated intent.

### F2 — Non-Adreno / newer-compiler devices getting the wrong kernel or wrong `-D` flags on Adreno paths — REFUTED (for Adreno)
For actual Adreno devices the gate is correct:
- `E031.41.03.62` (the S23): major=41 < 45 → workaround ON. Correct.
- `E031.45+` → `newer_than_or_same` true → OFF; DX → type check fails → OFF. Fast path built from original source, no arg 17, host sets no arg 17. Consistent.
- The A7X flash-attn carve-out (:7804-7817) cannot fire off-Adreno: `adreno_gen` defaults to `ADRENO_UNKNOWN` and is only assigned inside the Adreno/Qualcomm name-match branch (:5892-5899); Intel/other devices never get A7X. Carve-out placement (after the `is_*` predicates, before `is_kv_type_ok`) matches upstream exactly and only declines the three KV-convert variants on A7X.
The non-Adreno residue is F1, which is perf-only.

### F3 — Hypothetical Adreno "E17" compiler would be misclassified as old-E031 — PLAUSIBLE (latent)
`get_adreno_cl_compiler_version()` has no E17 branch (:296-315), so an Adreno driver reporting an E17 compiler returns `{}` → type=E031, versions -1 → gate TRUE → workarounds wrongly enabled. The comment at :6020-6022 argues the explicit type check is needed *because of* E17/DX, yet the parser cannot produce an E17 type at all — the comment's rationale is half-fictional, and the E17 case it worries about actually falls into the F1 hole. No known Adreno E17 device; latent only. Also inherited verbatim from upstream.

### F4 — Cherry-pick fidelity — CONFIRMED CLEAN
`diff <(git show 6503355df) <(git show 5c7e16fa6)` shows differences ONLY in: commit message, index lines, hunk line offsets, and the documented conflict resolution at the adapted call site (+2 comment lines + signature form). Insertion counts reconcile exactly (upstream 42 → local 44 in ggml-opencl.cpp = the 2 comment lines). Every other hunk — struct field (:580-581), q6k_opts block (:2235-2241), gate (:6016-6024), blank line + A7X carve-out (:7796, :7804-7817), arg-17 set (:20946-20950), and all 96 kernel lines — is byte-identical to upstream. No dropped hunk, no silent edit, nothing beyond the documented adaptation.

### F5 — Kernel argument wiring — CONFIRMED CORRECT
- Exactly ONE build site (:2246) and ONE dispatch site (:20915) for `kernel_mul_mv_q6_K_f32_flat` in the entire file; there is no GEMM variant, no subgroup variant, no separate n>1 batching path that could miss the arg. The binary-kernel path (`adreno_use_bin_kernels`) covers only `gemv/gemm_noshuffle_*` kernels — it cannot bypass or shadow this kernel's source build.
- Kernel params: src0_ql…r3 = indices 0..16 (:137-160 of the .cl); `q6k_mask` lands at index 17 under the ifdef (:161-165). Host sets 0..16 contiguously (:20925-20941) then conditionally 17 with `sizeof(cl_uchar)` matching `uchar`.
- Build-time flag and runtime arg flag are the SAME field (`q6_k_flat_old_compiler`), set once in `ggml_cl_init` (:6019) before `load_cl_kernels()` runs (called from `alloc_buffer`, :11779, after init). No ordering window, no TOCTOU between program signature and clSetKernelArg.
- Both helper call sites (`block_q_6_K_dot_y_flat`, .cl:239/:243) updated for the inserted `dbg` parameter; `il` exists in scope (.cl:209).

### F6 — Scalar-path math and flag-off behavior — CONFIRMED CORRECT
Mechanical check: preprocessing the new `.cl` with `ADRENO_OLD_COMPILER` undefined yields the parent file EXACTLY, except (a) one added comment block and (b) `global char * sc` moved after `float dall` — a semantically null declaration reorder. The conformant fast path is untouched.
Scalar path equivalence, verified term-by-term against the parent vectorized path:
- `Q6W(qb,sh,hb,p)` expands to exactly `(qb>>sh)&15 | ((hb>>2p)&3)<<4` − 32, reproducing w0/w1/w2/w3 for planes p=0..3 including the mask arithmetic (`qh&3<<4 ≡ (qh&0x0C)<<2`, etc.).
- Scales: reads sc[0],sc[2],sc[4],sc[6] relative to `blk_scales + ib*16 + is`, identical to vectorized; sign-extension `(int)x − 256*(x>>7)` is correct two's-complement widening of int8.
- Activation lanes y[0..3], y[32..35], y[64..67], y[96..99] match `vload4(0, y+{0,32,64,96})` positions.
- `int offset_src0` overflow needs >2^31 blocks (~5.5×10^11 weights) — unrealistic, acknowledged in the comment; `blk_d = src0_d + offset_src0` pointer arith is fine (non-negative int, sign-extended).
- Barrier correctness: no local-memory barriers touched; the optimizer-barrier printfs are guarded by `q6k_mask==0xFE` which the host never sends (host hardcodes 0xFF, :20948), so they compile but never execute. Confirmed empirically: zero `HELPER/Q6KLANE/Q6KTOT` occurrences in all four run logs.

### F7 — Perimeter — CONFIRMED CLEAN
`git show --stat`: exactly two files (`ggml-opencl.cpp`, `mul_mv_q6_k_f32_flat.cl`). Zero changes to MoE MUL_MAT_ID q2_K/q3_K/q4_K/q5_K kernels, masks-as-arguments, scalar-uint trans4 dataflow, or the test harness. Manifest claim that build-tree commit `532ac356c` differs from `5c7e16fa6` by metadata only: verified — `git diff 532ac356c 5c7e16fa6` is empty (identical trees).

### F8 — Evidence coherence — CONFIRMED GENUINE
Recomputed locally against `results/q6k_cherry_s23/`:
- SHA-256 of all four raw logs match MANIFEST byte-for-byte (`66bb63a5…`, `b2c377f0…`, `c6ba0405…`, `5e32248a…`).
- `q6k_dense.out`: `925/925 tests passed`, rc=0, end timestamp `Fri Aug 21 15:20:04 EDT 2026`; `q6k_mmid.out`: `401/401 tests passed`, rc=0, end `15:29:26 EDT 2026` — both match MANIFEST start/end times.
- In-run pre-run sha block present in BOTH logs with `libggml-opencl.so = b9d99fa8…` as claimed; hashes taken on-device before execution, not pasted.
- stderr shows `Compiler E031.41.03.62` (the documented S23 compiler), `GGML_OPENCL_SOA_Q` active, `kernel_mul_mv_q6_K_f32_flat` loaded (dense) and all `gemm/gemv_moe_q2_k…q6_k_f32_ns` kernels loaded (mmid).
- Behavioral anti-stale-binary evidence: the previously-failing ten dense q6_K flat cases (m=16, n=1..9 + repeat n=1) are all OK in-run (out lines 163-171, 1054); MUL_MAT_ID per-type counts match MANIFEST exactly (q2_K 5, q3_K 5, q4_K 80, q5_K 4, q6_K 3). A stale pre-fix binary could not produce these results.
- File mtimes (15:20/15:29, manifest 15:32) consistent with run timeline. No wrong-run reuse smell detected.

### Minor (style/dead-code — last, as instructed)
- Debug scaffolding (`dbg` param, HELPER/Q6KLANE/Q6KTOT printfs, 0xFE sentinel) ships in the old-compiler build; intentional and documented as load-bearing, but it is dead weight forever and a future refactor that "cleans up" a printf will silently re-break E031.41. The FRAGILE comment acknowledges this.
- Comment at :6022 ("newer_than_or_same() is false for every non-E031 compiler") is misleading — it is equally false for non-Adreno devices where `type` vacuously equals E031; that is precisely the F1 hole.

---

## Verdict

**BANK.**

One-line justification: the cherry-pick is byte-faithful outside the documented signature adaptation, the arg wiring/math/fast-path are provably correct, and the S23 evidence is genuine; the single real defect (F1, Intel misclassified as old-E031 due to the missing `gpu_family` guard) is inherited verbatim from upstream, correctness-neutral, off the target device, and warrants a follow-up guard — not a block of this commit.
