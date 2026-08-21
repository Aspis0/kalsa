# K2 PHASE 1 — q4_K / q5_K MUL_MAT_ID on Adreno 740 (characterize, no fix)

**Mission:** Phase 1 only. Precise, evidence-backed characterization of WHY q4_K/q5_K MUL_MAT_ID fails on Adreno 740. Do NOT fix. Orchestrator (Claude) audits before any fix is designed.
**Date:** 2026-08-20
**Executor:** grok (K2 chapter)
**Device:** Galaxy S23, Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (also 192.168.1.82:39591)
**Device dir:** `/data/local/tmp/s3oracle` (s3base/s3fix/s3printf UNTOUCHED)
**Repo:** `BigMoeOnEdge/third_party/llama.cpp` branch `kalsa/kernel-s3-repack`
**adb:** `C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe`
**Logs:** `results/oracle_consumer_s23/k2_phase1/`

---

## ROLLING SUMMARY

**Status:** BANKED. llama.cpp `c1bb48d32ea87ea8650fd30e8753f4581c60537a` on `kalsa/kernel-s3-repack`, tag `kalsakernel-v3`. Submodule **NO push**. Outer repo commit + push follows this report.

**Speed answer (2026-08-21, exploratory):** the GPU MoE path this chapter unblocked is **2.17× burst decode** and **~1.5× sustained** vs CPU experts on S23 Adreno 740 (OLMoE-1B-7B Q4_K_M, ngl=16, unplugged, ABBA×2), at equal-or-lower temperature. Full write-up: `results/olmoe_gpu_moe_s23/RESULT.md`. Not a ship claim (N=2 blocks, one model, one device; A8 tg dropped for Dozing).

**Headline (banked, MAX RECALL angle C):** On Adreno 740 compiler E031.41.03.62, the original q4_K/q5_K MoE kernels are miscompiled; replacing the fixed masks in `get_scale_min_k4` with equivalent uchar kernel arguments is a device-verified workaround (0/80+0/4 → 80/80+4/4; MUL_MAT_ID 391/391). The evidence is consistent with a literal-mask/code-shape trigger but does **not** isolate the literal substitution from the accompanying ABI/program-shape change (three added kernel args alter register allocation/layout). This is the **fourth independently reproduced compiler-failure site/workaround** in the project; whether it is a distinct compiler root cause from the three previously characterized defects is **UNRESOLVED**. Never "fourth distinct defect."

Mask-then-shift innocence **in these kernels** is proven by P1-alone reaching 80/80+4/4 with the nibble expressions unchanged. P2's null result (still 0/80+0/4) is **non-diagnostic** — the dominant scale-mask defect was still active and could have hidden a second defect. Scope is kernel- and configuration-local, not a global statement that the idiom is safe (it is separately implicated in q4_0). H5 killed for this idiom. Shipped workaround is P1 (masks as kernel args). .so `a09ef68f…`.

**Open questions:**
- OPTIONAL follow-up, **not run:** dummy-arg attribution test — add 3 unused uchar args while **keeping literal masks**. Still FAIL → literals are the trigger; PASS → code-shape.

**Headline (device, HEAD sha `d88a8301…`, phase-1 contemporaneous; superseded by banked headline):** q4_K MUL_MAT_ID **0/80 FAIL** (ERR 0.567–0.959) and q5_K **0/4 FAIL** (ERR ~0.86–0.93) are real GPU of `kernel_{gemv,gemm}_moe_q{4,5}_k_f32_ns` (no `_ila`). q6_K **3/3 PASS** is real GPU (`kernel_{gemv,gemm}_moe_q6_k_f32_ns`). Dense q4_K noshuffle **2/2 PASS** (E4). E1 `-cl-opt-disable` on MoE **aborted** (compile err=-6; in-tree "small enough" claim FALSIFIED). E2 drop-fast-relaxed still 0/80. E3a cvt `-O0` aborted (expected). E3b cvt `-cl-mad-enable` still 0/80. **H3 REFUTED as sole cause. H4 not supported by the completed discriminator. H6 dead as common cause. H7 not fired.** (H1/H2 ranking at this snapshot is superseded by the banked C1/C2 wording above.)

**Reproduction (a):** E0 DONE on HEAD sha `d88a8301…`. q4_K **0/80 FAIL** ERR 0.567–0.959; q5_K **0/4 FAIL** ERR 0.86–0.93; q6_K **3/3 PASS**. Kernels: `kernel_{gemv,gemm}_moe_q{4,5,6}_k_f32_ns` + `kernel_moe_reorder_b`. **No `_ila`.** q6_K is real GPU. Garbage NMSE, both GEMV and GEMM.
**GPU vs vacuous PASS (b):** DEVICE CONFIRMED. E0_q6 logged `kernel_gemv_moe_q6_k_f32_ns` and `kernel_gemm_moe_q6_k_f32_ns`. Not vacuous.
**Localization (c):** MoE compute kernels (GEMV+GEMM). E4 dense noshuffle q4_K PASSES. Convert math-opts (E3b) did not flip.
**Hypotheses (d):** see PHASE 1 VERDICT at end of step log.

**On-device libggml-opencl.so sha:** `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8` (PC==device, 2026-08-20 push). `/data/local/tmp/s3oracle` recreated. `s3base`/`s3fix`/`s3printf` UNTOUCHED.

**PC HEAD:** llama.cpp `55f43a574` on `kalsa/kernel-s3-repack`.
**PC .so (HEAD, s3oracle rebuild 2026-08-20 19:32):** `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8` (`libggml-opencl.so` 8022056 B). Strings `GGML_OPENCL_LOG_KERNELS` and `GGML_OPENCL_MOE_OPTS` present. CMake configured `ggml commit: 55f43a574`. Previous v2 sha `2032b7c7…` superseded. On-device sha matches.

---

## STEP LOG (append-only)

### 2026-08-20 setup — context ingested

- PLAN.md §current: trans4 closed (3 Qualcomm miscompiles, kalsakernel-v1/v2). CPU judge rehabilitated. Next chapter = K2.
- retrial-s23: on Adreno 740, `test-backend-ops` MUL_MAT_ID src0=q4_K FAILS 0/80 and q5_K FAILS 0/4 — identical on patched AND unpatched. q6_K 3/3 PASS. Narrow quants + q8_0 PASS. K-quant storage roundtrip CLEAN (0 mismatches) → defect is COMPUTE, not storage/restore. Judge is clean, FAILs are REAL numerical errors.
- Prior (trans4, not conclusion): Adreno compiler miscompiles byte-lane dataflows; medicine is scalar-uint end-to-end. BUT 0/80 all-fail can also be a plain logic bug. Do not tunnel on miscompile.
- Historical retrial logs exist at `results/oracle_consumer_s23/retrial/cell4_e2e_bytewise_q4_K.log` (and q5_K, q6_K) — used as PRIOR only; reproduction must be on current HEAD.

Next: device connectivity + on-device sha + HEAD build identification, then run (a).

### 2026-08-20 HOLD — device in use by owner

- **NO adb** (no push, no shell, no sha) until explicit "device is free" prompt.
- Device check from earlier this session (before HOLD): S23 WAS attached (`SM_S911U`, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, also `192.168.1.82:39591` which is **Jelly Star** — do not confuse). `/data` 21G free. `/data/local/tmp/s3oracle` **does not exist** this session (cleaned after prior retrial). `s3base`/`s3fix`/`s3printf` present, untouched.
- Push list to recreate when device frees (same as retrial cell 0): `test-backend-ops`, `libggml-opencl.so`, `libggml.so`, `libggml-base.so`, `libggml-cpu.so`, `libllama.so`, `libllama-common.so`, `libc++_shared.so`, `libomp.so`. Sha256 PC==device after every push. Record on-device sha of `libggml-opencl.so` next to every run in MANIFEST.md.
- Until then: (1) source map of MUL_MAT_ID q4_K/q5_K/q6_K, (2) reconstruct 80+4 case matrix + NMSE threshold, (3) PC build of HEAD, (4) pre-register ranked hypotheses + discriminating experiments.

### 2026-08-20 step — source map start

Tracing `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/` for MUL_MAT_ID supports_op + dispatch + kernels.

### 2026-08-20 source map (verified against recon; my reading wins on discrepancies)

#### Env parsing (verified)

| var | parser | on | off | trap |
|---|---|---|---|---|
| `GGML_OPENCL_LOG_KERNELS` | `ggml_opencl_env_value_enabled` :1223 | `"1"` / any non-empty not `"0"`/`"false"` | unset / `""` / `"0"` / `"false"` | value-parsed. `"0"` does NOT enable. Unique-once names to **stderr** via `clGetKernelInfo` (`ggml_opencl_log_kernel_once` :70, called from `enqueue_ndrange_kernel` :1006 AND trans4 convert/restore picks). |
| `GGML_OPENCL_MOE_OPTS` | raw `getenv` :3995 | any set string **replaces** flags after `-cl-std=<device std>` | unset → default `-cl-std=… -cl-mad-enable -cl-fast-relaxed-math` | **NOT** a boolean. `"0"` would pass literal `0` to the compiler (build fail). Empty string is non-null → opts become just `-cl-std=…`. **Do NOT include `-cl-std=` in the value** — the code already prepends it. |
| `GGML_OPENCL_CVT_OPTS` | raw `getenv` :1667 | same shape as MOE_OPTS, for `program_cvt` only | unset → general `compile_opts` (mad + unsafe + finite + fast-relaxed) | convert/restore NOT affected by MOE_OPTS. `program_cvt` is **one program with ALL convert/restore kernels**. In-tree :3991-3994: MoE programs (one file each) "are small enough to survive `-cl-opt-disable`" **unlike program_cvt**. Full `-O0` on cvt may fail to build — see E3a/E3b. |
| `GGML_OPENCL_HOST_REPACK` / `DUMP_Q` | presence-only | any presence including `"0"` | **unset** | never export these for K2 runs. |
| `GGML_OPENCL_ORACLE` / `CVT_VARIANT` / `GEMV_AUDIT` | value-parsed | see helper | unset/`0`/`false` | leave unset unless a named experiment needs them. |

Default `opencl_c_std` = `"CL" + major + "." + minor` of the device (Adreno 740 log: OpenCL 3.0 → `CL3.0`).

#### (b) supports_op — q6_K is NOT vacuous

`ggml-opencl.cpp:7284-7307` `GGML_OP_MUL_MAT_ID`:

- q4_0 / q8_0 / mxfp4: general path (contiguous F32 src1).
- q4_1 / q5_0 / q5_1 / **q4_K / q5_K / q6_K**: **same gate** under `GGML_OPENCL_USE_ADRENO_KERNELS`: `src1==F32 && use_adreno_moe_kernels(src0) && both contiguous`.

`use_adreno_moe_kernels` :7000-7003 (backend_ctx unused):

```
name contains ("ffn" AND "exps") OR "as"
AND ne[1] % 32 == 0
```

No type check. No `ADRENO_GPU_GEN` check (recon claim 2 verified: `ADRENO_GPU_GEN` is used elsewhere, never in this gate or in `ggml_cl_mul_mat_id`).

`test-backend-ops.cpp:10063`: `NOT_SUPPORTED` and `SKIPPED` are **excluded** from `tests_run`. Therefore:

- 0/80 q4_K and 0/4 q5_K = 80+4 real GPU executions, all FAIL.
- 3/3 q6_K = 3 real GPU executions, all PASS. **Informative differential.**

`test_mul_mat_id::build_graph` :4303 names src0 `"as"` → name gate always true for these cases. All counted shapes have `m % 32 == 0`.

Device still needs `GGML_OPENCL_LOG_KERNELS=1` to print `kernel_gemv_moe_q6_k_f32_ns` / `kernel_gemm_moe_q6_k_f32_ns` (unique-once, stderr).

#### Dispatch `ggml_cl_mul_mat_id` :21308

Op table :24690 sets `func = ggml_cl_mul_mat_id`.

Per-type Adreno moe block (fallthrough if gate false — no generic K-quant MoE; comment :21349 "TODO: general MoE"):

| type | GEMV (`ne12==1`) | GEMM (`ne12>1`) | ILA bin? |
|---|---|---|---|
| q4_K | `kernel_gemv_moe_q4_k_f32_ns` :22274 | `kernel_gemm_moe_q4_k_f32_ns` :22326, **replaced by `_bin` ILA if loaded** | yes, `gemm_moe_q4_k_f32_ns_ila` if `use_adreno_bin_kernels` |
| q5_K | `kernel_gemv_moe_q5_k_f32_ns` :22457 | `kernel_gemm_moe_q5_k_f32_ns` :22510 | no |
| q6_K | `kernel_gemv_moe_q6_k_f32_ns` :22637 | `kernel_gemm_moe_q6_k_f32_ns` :22689 | no |

GEMV geometry (all three): `global {ceil(ne01/64)*64, 4, ne20}`, `local {64, 4, 1}`. `ne20 = n_used` (ids.ne[0] after view).

`ne12` is src1's token dim = test's `n`. So `n==1` → GEMV, `n>1` → GEMM.

`use_adreno_bin_kernels` :1508 is `#ifndef GGML_OPENCL_USE_ADRENO_BIN_KERNELS → false`. s3oracle CMakeCache has **no** `GGML_OPENCL_USE_ADRENO_BIN_KERNELS`. Protocol does not push `libadreno-opencl-kernels.so`. **Expect GEMM q4_K to use source**, not ILA. Still log kernel names: `_ila` in the name would mean bin leaked in.

GEMM also enqueues `kernel_moe_reorder_b` first (router/activation reorder). Shared across types. q4_0/q6_K use the same reorder and PASS → reorder is not the q4_K/q5_K differential. **Compile confound for E1:** `kernel_moe_reorder_b` is built with `CL_moe_compile_opts` (`ggml-opencl.cpp:4435-4438`), so `GGML_OPENCL_MOE_OPTS="-cl-opt-disable"` rebuilds it too. It is a trivial float4 copy, expected bit-identical under `-O0`. Still: an E1 FAIL is **not** scored as a standalone H1/H2/H3 refutation — interpret via the E3 ladder (E1 alone does not discriminate H1–H3 from H5).

Compile: all `gemv_moe_*` / `gemm_moe_*` programs use `CL_moe_compile_opts` :3987-4011, 4263-4367. **MOE_OPTS recompiles compute only**, not convert.

#### (c) trans4-moe storage vs compute

For q4_K `set_tensor` :9357-9456, `use_adreno_moe_kernels` true → logs path `"trans4-moe"` and runs `kernel_convert_block_q4_k_trans4_ns` (`cvt.cl:1093`). Same for q5_K (`:1205`) and q6_K (`:1346`). Restore twins exist. **256×512×4 "as" shapes take trans4-moe convert**, not generic-soa / noshuffle.

Roundtrip K-quant = 0 mismatches (retrial). Convert+restore invert. That does **not** prove convert matches what compute expects; it proves convert and restore agree. Layout walk of q4_K convert vs GEMV (expert/superblock/subblock uint stride) **agrees**. CPU `dequantize_row_q4_K` lo-then-hi 32-nibble grouping matches convert's qv[p] packing. Layout-contract bug is **weak**.

Convert idiom: `uchar * qv_bytes = (uchar *)qv` on private `uint4 qv[8]` + nibble shuffle. Same family as trans4 defect-R. **q6_K convert uses the same uchar\* aliasing and PASSES** → convert miscompile is a weaker common-cause than compute.

256×512×4 is a roundtrip shape, not a test-backend-ops MUL_MAT_ID shape. MUL_MAT_ID counted shapes: m∈{64,512,768,896,1792}, k∈{256,768,2048,2304}, n_mats∈{4,8,32,64,128}. All still name=`as` and m%32==0 → same trans4-moe convert + moe compute.

#### Dense q4_K control (prior, cell4d)

Dense `MUL_MAT` q4_K **PASSES**, including Adreno-noshuffle-legal `m=131072,n=1,k=2048` (`ne1%128==0` → not the broken flat kernel). Dense kernel `gemv_noshuffle_q4_k_f32.cl` **also** has `get_scale_min_k4` and mask-then-shift, BUT:

- compile opts = `-cl-std=… -cl-mad-enable` (**no** `-cl-fast-relaxed-math`)
- `get_scale_min_k4` takes **mask_d6/mask_d4/mask_hi2 as arguments** (the known Adreno literal-mask dodge)

So "get_scale_min_k4 exists" is not enough to condemn it; the **literal masks + MoE compile opts** are the delta vs a passing twin.

The 10 dense FAILs are all q6_K **flat** (`m=16`, documented, out of K2 perim).

#### Idioms inventory (kernels involved)

**Present in q4_K AND q5_K GEMV+GEMM, absent in q6_K (explains the differential):**

1. `get_scale_min_k4` (`gemv_moe_q4_k_f32_ns.cl:10-23`, identical in GEMM :13-26 and q5_K GEMV :10-23). Reads `global const uchar *` at `q[j]`, `q[j+4]`, `q[j-4]`; `& 63` / `& 0x0F` / `& 0xC0` / `>> 2` / `>> 4`; writes through **private `uchar *` out-params**. 6-bit packed scales, `K_SCALE_SIZE=12`. **Squarely in the Adreno byte-lane family.** q6_K instead: `sc[j*2]` / `sc[j*2+1]` as plain `char` (`gemv_moe_q6_k_f32_ns.cl:69-71`).
2. **Mask-then-shift** nibble extract: `(q & 0xF000) >> 12` (and `& 0x00F0 >> 4`, `& 0x0F00 >> 8`) in `q4_k_to_fp32_packed8`, `dequantize_q4_k` GEMM macro, `q5_k_to_fp32_packed8`. q6_K and the **fixed** q4_0 moe use **shift-first then mask**: `(q >> 12) & 0x000F`. q4_0 comment at `gemv_moe_q4_0_f32_ns.cl:9-17` documents this exact miscompile on this compiler (E031.41.03.62), measured 16/16 when source byte ≥ 0x80.

**Shared, does NOT explain q6_K PASS by itself:**

- `as_ushort2` / `as_ushort4` punning (all three).
- Expert ID load `src2[i20]`, dst `dst[i01 + i20*ne01]`, GEMV grid, `moe_reorder_b` (q4_0 and q6_K pass).
- Convert uchar\* aliasing on private uint4[] (q6_K too).

**q5_K-only (cannot be THE common cause):**

- `as_uchar4` on qh (`gemv_moe_q5_k_f32_ns.cl:87`).
- `minv = -(float)dm_val*(float)mn` then `q*s + minv`. CPU `dequantize_row_q5_K` (`ggml-quants.c:1731`) is `d*sc*q - dmin*m`. Internally consistent (`+ (-dm*mn)`). q4_K uses `q*s - (+dm*mn)` vs CPU `dequantize_row_q4_K:1546` `d*sc*q - dmin*m` — also consistent. Sign convention is **not** a q4_K/q5_K common bug.

**Nontrivial scale/index arithmetic (logic-bug surface, source looks equivalent to CPU):**

- `get_scale_min_k4` vs CPU `ggml-quants.c` twin: extra `& 0x0F` on `(q[j+4] >> 4)` is redundant for uchar (result already 0..15). Not a source-level logic bug.
- Scale layout convert→compute: `(expert*ne01+row)*num_superblocks*12 + sb*12` matches on both sides.
- Q layout: 32 uints/superblock, 4 uints/subblock of 32 nibbles, stride `ne01`. Matches.
- Superblock `d`/`dm`: `expert * num_superblocks * ne01 + sb*ne01 + row`. Matches.

#### Recon cross-check

| recon claim | verdict |
|---|---|
| 1. same supports_op gate; 0/80 and 3/3 are real GPU | **CONFIRMED** |
| 2. GEMV/GEMM split, geometry, no ADRENO_GPU_GEN in MoE path | **CONFIRMED** |
| 3. case matrix 80 = 1+72+7; q5_K 4 = 2 GEMV + 2 GEMM; both families fail | **CONFIRMED** (S1 q4_K is exactly 6 GEMV + 1 GEMM, "mostly GEMV") |
| 4. get_scale_min_k4 is THE structural differentiator | **CONFIRMED as a top differentiator.** I add mask-then-shift as a **peer** differentiator (proven on this compiler for q4_0 moe). Dense noshuffle q4_K PASSES with a mask-arg get_scale_min_k4 and without `-cl-fast-relaxed-math` — so "the function exists" is not enough; literals + MoE opts are the delta. |
| 5. as_ushort2 shared; q5_K minv sign not common cause | **CONFIRMED** vs CPU formulas |
| 6. MOE_OPTS zero-code-change experiment | **CONFIRMED that the hook exists. DISCREPANCY on command shape:** recon's `GGML_OPENCL_MOE_OPTS="-cl-std=CL3.0 -cl-opt-disable"` would produce `-cl-std=CL3.0 -cl-std=CL3.0 -cl-opt-disable`. Code :3996 is `"-cl-std=" + opencl_c_std + " " + moe_opts_env`. Comment in-tree even says `GGML_OPENCL_MOE_OPTS="-cl-opt-disable"`. **My reading wins.** Correct: `GGML_OPENCL_MOE_OPTS="-cl-opt-disable"`. |

---

### 2026-08-20 case matrix + NMSE (from `tests/test-backend-ops.cpp`)

`test_mul_mat_id::max_nmse_err()` :4276 = **`5e-4`**. (Not 1e-2. Generic op dump path :7356 is also 5e-4.)

Constructor: `(type_a, type_b, n_mats, n_used, b, m, n, k)` with src0 `as` shape `[k, m, n_mats]`, src1 `[k, b?1:n_used, n]`, ids `[n_used, n]`. GEMV iff `n==1`.

`all_types` includes q4_K, q5_K, q6_K. `base_types` includes q4_K only. `other_types` includes q5_K, q6_K (not q4_K).

**q4_K = 80 counted GPU cases**

| bucket | lines | count | GEMV/GEMM |
|---|---|---:|---|
| all_types singleton | :8863-8865 | 1 | GEMM `n_mats=4,n_used=2,b=0,m=64,n=16,k=768` |
| base_types grid | :8867-8876 | 72 = 2×3×2×6 | `n_mats∈{4,8} × n_used∈{1,2,4} × b∈{0,1} × n∈{1,4,5,17,32,129}`, `m=512,k=256` → **12 GEMV + 60 GEMM** |
| S1 extra | :8910-8918 | 7 | 6 GEMV (`n=1`, m∈{896,768,1792}, k∈{2304,2048}, n_mats∈{32,64,128}) + 1 GEMM (`n=2,m=896,k=2304`). **`n_mats=64` appears 5 times** (4 GEMV + the n=2 GEMM); the other two are n_mats=128 and n_mats=32. |

**q4_K GEMV/GEMM split (hostile recount, matches):** **18 GEMV + 62 GEMM** = 12+6 / 1+60+1.

**q5_K = 4**

| bucket | count | which |
|---|---:|---|
| all_types singleton | 1 | GEMM m=64 n=16 k=768 |
| other_types | 2 | GEMV n=1 and GEMM n=32, m=512 k=256 n_mats=4 n_used=2 b=0 |
| S1 | 1 | GEMV `n_mats=64,n_used=8,b=0,m=896,n=1,k=2304` |

**q6_K = 3** (the PASSing set): GEMM m=64 n=16 k=768; GEMV m=512 n=1 k=256; GEMM m=512 n=32 k=256. Confirmed in prior log `cell4_e2e_bytewise_q6_K.log`.

**Prior NMSE (retrial, sha 9198f387 / eaec5d884 — PRIOR, re-measure on HEAD):**

- q4_K: ERR **0.58–0.997** (log max **0.996871802** at `ne=[512,4,1,1]`; first case 0.916). Sample dumps show comparable magnitude, scrambled sign/value — garbage ~1e0, not ~1e-2. Uniform across GEMV (`ne=[512,1,1,1]`) and GEMM (`ne=[64,2,16,1]`, `ne=[512,*,n>1,*]`). Log: `results/oracle_consumer_s23/retrial/cell4_e2e_bytewise_q4_K.log`.
- q5_K: ERR **0.90–0.92** all 4. Log: `…/cell4_e2e_bytewise_q5_K.log`.
- q6_K: 3/3 OK. Log: `…/cell4_e2e_bytewise_q6_K.log`.

---

### 2026-08-20 ranked hypotheses

Do not tunnel. 0/80 can be logic. Evidence currently **leans miscompile in compute**, because source-level scale/index matches CPU, dense noshuffle q4_K passes, q6_K moe passes, q4_0 moe (shift-first, no packed scales) passes.

| rank | hyp | for | against | kills if |
|---|---|---|---|---|
| **H1** | `get_scale_min_k4` **literal** byte-lane miscompile (private uchar\* outs, `&63`/`&0xC0`/`>>2`, non-uniform uchar loads) under MoE opts | unique to failing types; Adreno family; dense twin with **arg masks** PASSES; both GEMV+GEMM | source text ≡ CPU; could be H2 instead | MOE_OPTS -O0 PASS + a later one-function rewrite of get_scale_min_k4 alone PASS (H2 still in) |
| **H2** | mask-then-shift nibble extract miscompile (`(v & 0xF000) >> 12` arithmetic-shift + known-bits eating the follow-on `& 0xF`) | **already proven** on this compiler for q4_0 moe; q4_0 moe now shift-first and PASSES; q6_K shift-first PASSES; present in both GEMV+GEMM q4_K/q5_K | dense noshuffle q4_K has the same idiom and PASSES (but without `-cl-fast-relaxed-math`) | MOE_OPTS drop-fast-relaxed still FAIL, -O0 PASS, shift-first-only rewrite PASS |
| **H3** | `-cl-fast-relaxed-math` mad-fusion of `nibble*scale - minv` (esp. GEMM half path) | unique to MoE opts vs dense; recon's "lesser suspect" | q6_K moe compiled with the **same** opts and PASSES | MOE_OPTS=`-cl-mad-enable` (no fast-relaxed) PASS while -O0 not needed |
| **H4** | convert trans4-ns miscompile that restore inverts (roundtrip 0, compute reads "wrong" SoA) | uchar\* alias on private uint4; cvt built with unsafe+fast-relaxed; in-tree comment at :1658 about trans4_ns miscompile | q6_K convert uses the same aliasing and PASSES; convert↔compute index walk agrees; CVT_OPTS is a **control** | **E3a PASS** (cvt -O0 actually compiled) with default MoE opts, and E1 FAIL. E3a **build failure is NOT a kill and NOT evidence.** E3b PASS is weaker H4 (math-opts in cvt). |
| **H5** | plain logic bug (scale index, expert stride, GEMM tile) common to q4_K+q5_K GEMV+GEMM | 0/80 is the classic signature | source ≡ CPU for scales/index; same glue as passing q4_0/q6_K; both kernel families fail identically at ~NMSE 0.9 | E1 FAIL **and** a *completed* E3 (E3a if it built, else E3b) still FAIL. An E3a abort does not count as E3 FAIL. **E1 FAIL alone does not kill H1–H3 and does not prove H5.** |
| **H6** | ILA bin GEMM / expert glue / q5 minv sign | — | q5 minv internally consistent; glue shared with passing types; ILA not in this cmake; GEMV (no ILA) also fails | LOG_KERNELS shows `_ila`; GEMV-only subset still fails anyway |
| **H7** | **q5_K-GEMM-only** extra defect: GEMM `dequantize_q5_k` `ushort2 qh5x16` packing vs the ql tile vs CPU `dequantize_row_q5_K` **never traced**. GEMV qh path (`as_uchar4` per uint) was verified consistent. q4_K has no qh → **cannot be the common 0/80 cause**. Orthogonal, stacked on top of H1–H5. | q5_K has 2 GEMM cases; convert transposes qh; GEMM dequant takes a different qh vector type than GEMV | q4_K (no qh) fails too; q5_K GEMV also fails today | **E6:** after the common fix, q4_K 80/80 **and** q5_K GEMV PASS but q5_K GEMM still FAIL. Then source-trace GEMM qh packing first, then a targeted dump. |

**PROPOSAL (do not commit; ≤5-line candidates if H1/H2 confirmed on device):**

- P1 (H1): copy dense `get_scale_min_k4` mask-as-args into the four moe q4_K/q5_K kernels (GEMV+GEMM).
- P2 (H2): rewrite `q4_k_to_fp32_packed8` / `dequantize_q4_k` / `q5_k_to_fp32_packed8` to shift-first then mask, matching `gemv_moe_q4_0_f32_ns.cl:18-28`.

Orchestrator audits before either is applied. Device experiments first.

---

### 2026-08-20 pre-registered device experiments (run when device is free)

**Push first** (s3oracle was cleaned): recreate `/data/local/tmp/s3oracle`, push `test-backend-ops`, `libggml-opencl.so`, `libggml.so`, `libggml-base.so`, `libggml-cpu.so`, `libllama.so`, `libllama-common.so`, `libc++_shared.so`, `libomp.so`. Sha256 PC==device. Record on-device `libggml-opencl.so` sha in `results/oracle_consumer_s23/k2_phase1/MANIFEST.md` next to every run. `s3base`/`s3fix`/`s3printf` UNTOUCHED. adb: `-s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (NOT Jelly Star `192.168.1.82:39591`). From Git-bash `MSYS_NO_PATHCONV=1`. **Never export HOST_REPACK or DUMP_Q.**

Common prefix (value-parsed LOG_KERNELS; capture **stderr**):

```
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK GGML_OPENCL_DUMP_Q GGML_OPENCL_ORACLE GGML_OPENCL_CVT_OPTS GGML_OPENCL_MOE_OPTS
```

Harness: `/data/local/tmp/s3oracle/test-backend-ops -o MUL_MAT_ID`

| # | name | extra env / filter | expect H1/H2/H3 (miscompile in compute) | expect H4 (convert) | expect H5 (logic) |
|---|---|---|---|---|---|
| **E0** | HEAD reproduction | none. optionally also `-p 'type_a=q4_K'` / `q5_K` / `q6_K` as follow-ups | 0/80, 0/4, 3/3 reproduced; ERR ~0.58–0.997; stderr contains `kernel_gemv_moe_q4_k_f32_ns`, `kernel_gemm_moe_q4_k_f32_ns` (no `_ila`), **and** `kernel_{gemv,gemm}_moe_q6_k_f32_ns` | same counts | same counts |
| **E1 FIRST** | `-cl-opt-disable` on MoE compute | `GGML_OPENCL_MOE_OPTS="-cl-opt-disable"` (log must contain `MoE compile opts overridden: '-cl-std=CL3.0 -cl-opt-disable'`). **Also rebuilds `kernel_moe_reorder_b`** (`:4435-4438`, same `CL_moe_compile_opts`; trivial float4 copy, expected bit-identical under `-O0`; q4_0/q6_K already pass through it). | **PASS (or ERR collapse)** → compute-miscompile family in play (H1/H2/H3 still not split). **FAIL is NOT a standalone H1/H2/H3 refutation** — interpret via the E3 ladder. E1 alone does not discriminate H1–H3 from H5. | still FAIL (cvt not rebuilt). E1 FAIL + later E3a/E3b PASS would be H4, not H1–H3. | E1 FAIL is **compatible with H5**; only a completed E3 still FAIL promotes H5. |
| **E2** | drop fast-relaxed only | `GGML_OPENCL_MOE_OPTS="-cl-mad-enable"` (matches dense gemv_noshuffle opts) | PASS or partial → H3/H2-opts; still FAIL → not just fast-relaxed | still FAIL | still FAIL |
| **E3a** | convert `-cl-opt-disable` (attempt) | `GGML_OPENCL_CVT_OPTS="-cl-opt-disable"`, MoE opts **unset**. Log must contain `program_cvt compile opts overridden`. | still FAIL (if the program **actually built**) | **PASS** (if built) | still FAIL (if built) |
| **E3b** | convert drop-unsafe/finite/fast-relaxed, keep opt | **Only if E3a aborts.** `GGML_OPENCL_CVT_OPTS="-cl-mad-enable"` (drops `-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` from stock cvt `compile_opts`, keeps the optimizer). Weaker H4 discriminator, expected buildable. | still FAIL | **PASS** (weaker H4) | still FAIL |
| **E4** | dense q4_K control | `-o MUL_MAT -p 'type_a=q4_K.*m=131072'` (or the historical dense run) | still PASS (localizes to moe path, not q4_K dequant-in-general) | — | — |
| **E6** | **conditional, after the common fix** | **IF** q4_K is 80/80 **and** q5_K GEMV PASSes **and** q5_K GEMM still FAILs. Then source-trace `gemm_moe_q5_k_f32_ns.cl` `dequantize_q5_k` `ushort2 qh5x16` packing vs GEMV `as_uchar4` vs CPU `dequantize_row_q5_K`; only then a targeted GEMM dump (`-p 'type_a=q5_K'` and the n>1 cases). | n/a (not the common cause) | n/a | n/a — this is **H7**, orthogonal |

**E3a build failure is an EXPECTED possible outcome, not evidence for or against H4.** In-tree `ggml-opencl.cpp:3991-3994`: MoE programs are one-file-each and "small enough to survive `-cl-opt-disable`", **unlike `program_cvt`** (one big program with every convert/restore kernel). If E3a fails to compile, aborts, or never emits a successful `program_cvt` load: **record the failure verbatim, do not score H4, fall through to E3b.** Only a completed E3a (cvt compiled and tests ran) can score H4 at full strength.

**One variable at a time.** E1 before E2 before E3a (E3b only on E3a abort). If E1 PASSes, still run a completed E3 (E3a if it builds, else E3b) so convert is not a second required contributor. **If E1 FAILs: do not treat that as H1/H2/H3 refuted** — run the E3 ladder; H5 is in front only if a *completed* E3 still FAILs, then E5 (dst tile vs CPU, not a 5-line fix).

E5 (only if E1 FAILs **and** a completed E3a-or-E3b still FAILs): one small GEMV (`-p 'type_a=q4_K,type_b=f32,n_mats=4,n_used=1,b=0,m=512,n=1,k=256'`) with element dump; check whether error is all columns or a 32-wide subblock / expert / scale-group pattern.

E6 is **not** in the E0–E5 sequence. It fires only after a common-path fix has already made q4_K 80/80 and q5_K GEMV PASS, with q5_K GEMM still FAIL.

Filter notes: `-p` is a regex on `vars()`. Use `type_a=q4_K,` (trailing comma) to avoid accidental matches. q6_K confirm can be `-p 'type_a=q6_K'`.

---

### 2026-08-20 build prep — COMPLETE

Reuse `moe-experiments/build-android-opencl-s3oracle` (NOT k2: k2 is `BUILD_SHARED_LIBS=OFF` and has no `.so`; NOT smoke: CMAKE_HOME is BigMoeOnEdge engine). s3oracle CMakeCache: source=`llama.cpp`, `BUILD_SHARED_LIBS=ON`, `GGML_OPENCL=ON`, `GGML_OPENCL_EMBED_KERNELS=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `ANDROID_ABI=arm64-v8a`, `android-29`, NDK 27.1.12297006, Ninja, Release. No `GGML_OPENCL_USE_ADRENO_BIN_KERNELS`.

- CMake re-ran, `ggml commit: 55f43a574`. `ninja test-backend-ops ggml-opencl` exit 0 (19 steps). Unused-param warning on `use_adreno_bin_kernels` confirms BIN_KERNELS is compiled out (`return false`).
- PC shas after rebuild (2026-08-20 19:32):

| artifact | bytes | sha256 |
|---|---:|---|
| `libggml-opencl.so` | 8022056 | `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8` |
| `test-backend-ops` | 10166824 | `e5f2ecd431eae87cdb7a6fcb6197976b71eb8fa901b0d7338ae6d607b568503c` |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-base.so` | 6103496 | `7c4a575e4c6c97b8ca06f2e5d202e8a546b284c78a811f146d3d3ccff06f59ec` |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `libllama-common.so` | 78377240 | `f901fa499c0e036666b124d2bf9d65d7ecc1c028059acc447d9306d949d886c8` |

- Pre-rebuild `.so` was v2 `2032b7c7…` (7968824 B). HEAD `.so` is larger and contains `GGML_OPENCL_LOG_KERNELS` / `GGML_OPENCL_MOE_OPTS`.
- `test-backend-ops` sha identical to retrial eaec5d884 — expected under SHARED_LIBS (exe unchanged, `.so` changed).
- NDK companions for the push list:
  - `NDK/…/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so`
  - `NDK/…/lib/clang/18/lib/linux/aarch64/libomp.so`

STOP for device. No fix. No commit.

### 2026-08-20 hostile review — GO (PC-side fold-in)

Hostile review: GO, no blockers, 10/10 code claims verified, case matrix recount **18 GEMV + 62 GEMM**. Two MAJOR caveats folded:

1. **E1 confound:** `kernel_moe_reorder_b` is compiled with `CL_moe_compile_opts` (`:4435-4438`). `-cl-opt-disable` rebuilds it too. Trivial float4 copy, expected bit-identical under `-O0`; q4_0/q6_K already pass through it. Table now states: **E1 FAIL is interpreted via the E3 ladder, not as standalone H1/H2/H3 refutation.** E1 alone does not discriminate H1–H3 from H5 (kill-conditions already encoded this; the table now says it).
2. **H7 / E6 (conditional):** GEMM q5_K `ushort2 qh5x16` packing vs CPU `dequantize_row_q5_K` was never traced. GEMV qh (`as_uchar4`) was. q4_K has no qh → not the common cause; can be an extra q5_K-GEMM-only stack. Fire E6 only if after the common fix q4_K is 80/80, q5_K GEMV PASSes, q5_K GEMM still FAILs.

Cosmetic: prior ERR upper bound **0.997** (log max 0.996871802, not 0.96). S1 `n_mats=64` appears **5 times**.

Device still HOLD. Next prompt expected to be the green light.

### 2026-08-20 GREEN LIGHT — push

S23 free (charging; correctness session). Serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (SM_S911U). Jelly Star not used. `/data` 21G. `s3oracle` recreated. `s3base`/`s3fix`/`s3printf` still present, untouched (mtime 08-18/08-19). Full push list sha256 **PC==device**. On-device `libggml-opencl.so` = `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`. See `results/oracle_consumer_s23/k2_phase1/MANIFEST.md`.

Next: E0.

### 2026-08-20 E0_q6 DONE

sha `d88a8301…`. `LOG_KERNELS=1`. `-o MUL_MAT_ID -p type_a=q6_K`. **3/3 OK** (GEMM n=16, GEMV n=1, GEMM n=32). stderr: `kernel_gemm_moe_q6_k_f32_ns` and `kernel_gemv_moe_q6_k_f32_ns` plus router/`kernel_moe_reorder_b`. **No `_ila`.** q6_K MUL_MAT_ID is a real GPU PASS. Logs: `results/oracle_consumer_s23/k2_phase1/e0_q6.{out,err}`.

### 2026-08-20 E0_q5 DONE

sha `d88a8301…`. `-p type_a=q5_K,`. **0/4 FAIL.** ERR 0.926 (GEMM n=16), 0.862 (GEMV n=1), 0.915 (GEMM n=32), 0.858 (GEMV S1 n=1 m=896). Garbage, not subtle. Kernels: `kernel_gemv_moe_q5_k_f32_ns`, `kernel_gemm_moe_q5_k_f32_ns`. No `_ila`. Logs: `e0_q5.{out,err,summary.txt}`.

### 2026-08-20 E0_q4 DONE — E0 complete

sha `d88a8301…`. `-p type_a=q4_K,`. **0/80 FAIL.** 80 ERR lines, min 0.5667 (GEMV n=1) max 0.9592. Garbage across GEMV and GEMM. Kernels: `kernel_gemv_moe_q4_k_f32_ns`, `kernel_gemm_moe_q4_k_f32_ns` (source, **not** `_ila`). `kernel_moe_reorder_b` present. Logs: `e0_q4.err`, `e0_q4.summary.txt` (full 123MB dump on device).

E0 headline confirmed on HEAD. Next: E1 `GGML_OPENCL_MOE_OPTS="-cl-opt-disable"`.

### 2026-08-20 E1 ABORT

sha `d88a8301…`. Override line **present**: `MoE compile opts overridden: '-cl-std=CL3.0 -cl-opt-disable'`. Then `kernel compile error (err=-6)` while loading kernels; LLVM IR dump of `@llvm.qgpu.opencl.image.load.v4f32`. **No tests ran.** In-tree comment that MoE programs "are small enough to survive -cl-opt-disable" is **FALSIFIED** on this compiler. E1 is an abort, **not** a standalone H1/H2/H3 refutation (matches the pre-reg reading via the ladder). Next: E2 `MOE_OPTS="-cl-mad-enable"`.

### 2026-08-20 E2 DONE — H3 sole-cause REFUTED

sha `d88a8301…`. Override `-cl-std=CL3.0 -cl-mad-enable` (compiled). q6_K 3/3 PASS. q4_K **0/80 FAIL**. q5_K **0/4 FAIL** ERR 0.79–0.93. Dropping `-cl-fast-relaxed-math` from MoE compute **does not** flip the defect. H3 is not the sole cause. Next: E3a CVT_OPTS=-cl-opt-disable (expected possible build failure).

### 2026-08-20 E3a ABORT (expected, not H4 evidence)

sha `d88a8301…`. Override `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-opt-disable'`. **err=-6** compiling program_cvt. Zero tests. As pre-registered: do not score H4. Fall through to E3b `CVT_OPTS="-cl-mad-enable"`.

### 2026-08-20 audit — E3 ladder (PC-side only)

Orchestrator CERTIFIED the three load-bearing claims (MOE_OPTS prepends `-cl-std`; dense noshuffle passes mask args while moe uses literals; q4_0 in-tree comment documents mask-then-shift). Ranking unchanged.

Audit finding applied: E3 as originally written (`CVT_OPTS="-cl-opt-disable"`) can fail to **build** because `program_cvt` is one large program. In-tree `:3991-3994` says MoE programs, unlike program_cvt, are small enough to survive `-cl-opt-disable`. Split:

- **E3a** = attempt `-cl-opt-disable` on cvt. If compile/load aborts: record, do **not** score H4, fall through.
- **E3b** = `CVT_OPTS="-cl-mad-enable"` (stock cvt opts minus unsafe-math / finite-math / fast-relaxed; optimizer stays on). Weaker but buildable H4 discriminator.

E3a build failure is an **expected possible outcome**, not evidence for or against H4. Device still HOLD.

### 2026-08-20 E3b DONE — H4 math-opts not supported

sha `d88a8301…`. Override `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'` (compiled). q6_K 3/3 PASS. q4_K **0/80 FAIL**. q5_K **0/4 FAIL** ERR 0.83–0.94. Dropping unsafe/finite/fast-relaxed from **convert** did not flip. Completed E3 discriminator does **not** support H4. (E3a -O0 on cvt never built, so H4 is not fully killed.)

### 2026-08-20 E4 DONE — dense q4_K PASSES

sha `d88a8301…`. `-o MUL_MAT -p type_a=q4_K.*m=131072`. **2/2 OK** (n=1 and n=64). Kernels: `kernel_gemv_noshuffle_q4_k_f32`, `kernel_gemm_noshuffle_q4_k_f32`. Defect is in the **MoE** path, not q4_K dequant-in-general. `s3base`/`s3fix`/`s3printf` still untouched (mtime 08-18/08-19).

---

## PHASE 1 VERDICT (STOP — no fix, no commit)

On-device `libggml-opencl.so` sha every run: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`. Logs under `results/oracle_consumer_s23/k2_phase1/`.

| hyp | verdict | why |
|---|---|---|
| **H1** get_scale_min_k4 **literals** | **LIVE** (leading) | Unique to failing moe kernels. Dense twin (E4) PASSES with the same function taking **mask args**. E1 could not -O0-test it (compile abort). E2 still FAIL ⇒ not just fast-relaxed. |
| **H2** mask-then-shift nibble extract | **LIVE** (peer) | Proven on this compiler for q4_0 moe; q4_0 now shift-first and PASSES. Dense noshuffle still has the idiom and PASSES (E4), so H2 needs the **moe expression shape**, not the idiom in isolation. E1 abort, E2 still FAIL. |
| **H3** `-cl-fast-relaxed-math` sole cause | **REFUTED** | E2 `MOE_OPTS=-cl-mad-enable` compiled; q4_K still 0/80, q5_K still 0/4. |
| **H4** convert miscompile | **NOT SUPPORTED** by completed discriminator | E3a abort (not evidence). E3b compiled, still 0/80. Cannot fully kill (no cvt -O0). Roundtrip K=0 + q6_K convert same aliasing still argues against H4 as the common cause. |
| **H5** plain logic bug | **OPEN** (not killable by this ladder) | E1 abort means we never got moe -O0. Compatible with remaining 0/80 after E2+E3b. Does not outrank H1/H2: source-level scale/index still matches CPU. |
| **H6** ILA / glue / q5 minv | **DEAD** as common cause | No `_ila` on any run. Same reorder as passing q6_K. q4_K has no qh/minv-sign issue. |
| **H7** q5_K-GEMM qh packing | **NOT FIRED** | q4_K still 0/80. E6 stays conditional for after a common fix. |

**What the opt ladder could not do:** `-cl-opt-disable` does not build MoE programs **or** `program_cvt` on compiler E031.41.03.62 (err=-6, image.load lowering). The in-tree "MoE programs are small enough to survive -cl-opt-disable" claim is **FALSIFIED**.

**PROPOSAL (still not applied):** P1 = port dense mask-as-args `get_scale_min_k4` into the four moe q4_K/q5_K kernels. P2 = shift-first nibble extract matching `gemv_moe_q4_0_f32_ns.cl:18-28`. Either is ≤ a small localized diff. Orchestrator audits device evidence before any patch.

E5 (dst-tile dump) not run: user STOP after E0–E4 ladder. Available if H5 needs a spatial pattern next.

### 2026-08-20 PHASE 2 — E5-P2 then E5-P1

Cosmetic debt (fix comment at final-commit only): `ggml-opencl.cpp:3993-3994` "small enough to survive -cl-opt-disable" is **FALSIFIED** on E031.41.03.62 (E1 compile err=-6).

**E5-P2** (shift-first nibble in 4 kernels; `get_scale_min_k4` literals untouched). sha `b531095660704b3b60909e737ee04e14a6fca3e3c06d2b1f69d2e2d6bdcf753a`. Diff `e5_p2.diff`. q6 3/3. q4 **0/80**. q5 **0/4** ERR ~0.87–0.94. Counts unchanged. **Non-diagnostic** for nibble-idiom innocence (C2): the dominant scale-mask defect was still active. Reverted.

**E5-P1** (P2 reverted; masks as kernel args copying dense noshuffle; nibble extract still mask-then-shift). sha `62431160ba4a3dbf92133ccf6996f16e8dc14a2a8b96b7f7c4fc6c144e28c8cc`. Diff `e5_p1.diff`. q6 3/3. q4 **80/80 PASS**. q5 **4/4 PASS** (both GEMV and GEMM). Kernels still `kernel_{gemv,gemm}_moe_q4_k_f32_ns`.

## PHASE 2 VERDICT (STOP — no commit)

| hyp | verdict after E5 |
|---|---|
| **H1** literal `get_scale_min_k4` | **WORKAROUND DEVICE-VERIFIED; trigger not isolated (C1).** On E031.41.03.62 the original q4_K/q5_K MoE kernels are miscompiled; replacing the fixed masks in `get_scale_min_k4` with equivalent uchar kernel arguments flipped 0/80→80/80 and 0/4→4/4. Consistent with a literal-mask/code-shape trigger; does **not** isolate the literal substitution from the accompanying ABI/program-shape change (three added kernel args alter register allocation/layout). Dense mask-as-args dodge is the shipped workaround, not cargo-cult. |
| **H2** mask-then-shift nibble | **INNOCENT IN THESE KERNELS (C2).** Proven by P1-alone reaching 80/80+4/4 with the nibble expressions unchanged. P2's null result is **non-diagnostic** (dominant scale-mask defect still active; could have hidden a second defect). Scope: kernel- and configuration-local, **not** a global claim that the idiom is safe (separately implicated in q4_0). Do not ship P2 as the K2 fix. |
| **H3** | still REFUTED (phase 1 E2) |
| **H4** | still unsupported |
| **H5** logic | **KILLED for this idiom.** Equivalent-mask transform + FAIL→PASS ⇒ compiler, not source logic. Does not identify which compiler trigger (literals vs ABI/shape). |
| **H6** | still DEAD |
| **H7** q5 GEMM qh | **NOT FIRED.** q5 GEMM PASSed under P1. |

Working tree on `kalsa/kernel-s3-repack` holds **P1 only** (uncommitted). P2 lives only as `results/oracle_consumer_s23/k2_phase1/e5_p2.diff`. Fix commit after orchestrator audit + hostile review.

### 2026-08-20 COMMIT-WITH-FIXES — re-verify + commit

Hostile review three changes applied:
1. q4_K GEMM mask args wrapped in `if (!backend_ctx->kernel_gemm_moe_q4_k_f32_ns_bin)`. ILA 13-arg path stays on the old literal-mask binary (unfixed on A6X/A7X; this tree compiles bin kernels out).
2. Comment at load_cl_kernels: `-cl-opt-disable` does **not** compile MoE programs on E031.41.03.62 (err=-6, 2026-08-20).
3. Four kernel comments rewritten as upstream-facing (no ticket names).

Post-review .so sha `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da` PC==device.

Device battery:
- **MUL_MAT_ID 391/391 PASS** — q4_K 80, q5_K 4, q6_K 3, q4_0 74, q4_1 75, q5_0 3, q5_1 3, q8_0 75, mxfp4 74. Zero FAIL.
- **MUL_MAT 915/925** — 10 FAIL, all q6_K m=16 flat (retrial cell4d unchanged).
- **roundtrip all-zero** (8 MoE + 2 dense). Narrow-quant 0 is post-defect-P, expected.
- Unfiltered full `test-backend-ops` **SIGSEGV rc=139** during PAD after a 7.1 GB dump log (not pulled). Not a clean suite total; regression check is the MUL_MAT/MUL_MAT_ID/roundtrip numbers above.

Commit: `c1bb48d32ea87ea8650fd30e8753f4581c60537a` on `kalsa/kernel-s3-repack` (5 files, +115/−32). **NO push.** STOP.

### 2026-08-20 MAX RECALL — two cheap device tasks, then STOP

Device still ours, plugged, TLS serial. `s3base`/`s3fix`/`s3printf` UNTOUCHED.

**Task 1 (E2/E3b artifact gap):** dumps **FOUND** on device (`/data/local/tmp/s3oracle/logs/e2_q{4,5}.out`, `e3b_q{4,5}.out`; ~123MB q4, ~1.9MB q5). Extracted on-device `ERR =` + `tests passed` only (dumps **not** pulled) into `results/oracle_consumer_s23/k2_phase1/e2_q4.summary.txt` `e2_q5.summary.txt` `e3b_q4.summary.txt` `e3b_q5.summary.txt`.

| run | claimed | artifact | verdict |
|---|---|---|---|
| E2 q4 | 0/80 | 80 ERR lines, `0/80 tests passed` | **MATCH** |
| E2 q5 | 0/4 ERR 0.889/0.785/0.910/0.933 | 0.888727631 / 0.785408716 / 0.909778643 / 0.932921124, `0/4 tests passed` | **MATCH** |
| E3b q4 | 0/80 | 80 ERR lines, `0/80 tests passed` | **MATCH** |
| E3b q5 | 0/4 ERR 0.904/0.828/0.932/0.936 | 0.904070598 / 0.828423078 / 0.932363694 / 0.935937768, `0/4 tests passed` | **MATCH** |

Env from the already-pulled `.err` of those runs: E2 `MoE compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`; E3b `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`. sha `d88a8301…`. **No re-run.**

**Task 2 (PAD control, PRE-FIX `.so`):** PC copy of `d88a8301` had been overwritten. Rebuilt at `55f43a574` → sha **identical** `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`. Archived `libggml-opencl.d88a8301.so`. On-device sha verified, then `test-backend-ops -o PAD` stdout `/dev/null` stderr `pad_d88a8301.err` (1464 B, `kernel_pad` loaded). **rc=0 PASS.** Isolated PAD on pre-fix does **not** die 139. **No diagnosis** (unrelated-verdict already argued from code — zero shared surface). `N/M tests passed` not captured (stdout discarded by spec).

**Device left with fixed `.so`:** pushed `libggml-opencl.a09ef68f.so`; on-device sha **verified** `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da`. PC `bin/libggml-opencl.so` restored from the same archive. llama.cpp back on `kalsa/kernel-s3-repack` `c1bb48d32`.

**Forensic D2 (S1 n_mats):** REFUTED in adjudication — ERR lines print dst `ne` (never contains `n_mats`); `n_used` sequence 8,1,6,8,8,4,8 in the logs matches the code's S1 list exactly. Prior report text unchanged.

### 2026-08-20 MAX RECALL angle C — mandated rewordings (banked)

No claim UNSOUND; C4 sound. Three rewordings applied to rolling summary + PHASE 2 verdicts. Committed kernel comments unchanged (they state the observed differential).

**C1 (trigger not isolated):** On Adreno 740 compiler E031.41.03.62, the original q4_K/q5_K MoE kernels are miscompiled; replacing the fixed masks in `get_scale_min_k4` with equivalent uchar kernel arguments is a device-verified workaround. The evidence is consistent with a literal-mask/code-shape trigger but does not isolate the literal substitution from the accompanying ABI/program-shape change (three added kernel args alter register allocation/layout).

**C2 (nibble idiom, local):** Mask-then-shift innocence in these kernels is proven by P1-alone reaching 80/80+4/4 with the nibble expressions unchanged. P2's null result is non-diagnostic (the dominant scale-mask defect was still active and could have hidden a second defect). Scope: kernel- and configuration-local, not a global statement that the idiom is safe (it is separately implicated in q4_0).

**C3 (site, not distinct root cause):** This is the fourth independently reproduced compiler-failure site/workaround in the project; whether it is a distinct compiler root cause from the three previously characterized defects is UNRESOLVED. Banked text never says "fourth distinct defect."

### Open questions

- OPTIONAL follow-up experiment, **not run now:** dummy-arg attribution test — add 3 unused uchar args while **keeping literal masks**. If still FAIL → literals are the trigger; if PASS → code-shape.

### 2026-08-20 EXPLORATORY speed cell (Mellum2 Q4_K_M, S23 unplugged)

Pointer only: `results/mellum2_gpu_moe_s23/RESULT.md`. First look at GPU-resident vs CPU-resident experts on the K2-unlocked model. **BLOCKED_DRIVER** after two hard reboots (HARD STOP): Arm A `-ngl 8` (~15 s, RAM still ~4.6 GB) then authorized retry Arm A `-ngl 2` (~28 s, MemAvailable cliff to 450 MB). Identical 209 B OpenCL device-select stderr, `bootreason=reboot`, no tok/s. Arm B never ran. 391/391 correctness does not imply 12B-Q4_K_M is loadable on 8 GB A740. Follow-up (not tonight): smaller 2–4 GB q4_K MoE GGUF. Exploratory, n=0 completed reps. Unplug gate passed. Not a ship cell.

STOP.
