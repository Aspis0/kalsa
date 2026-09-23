# REPORT - gpu-numerics-fix-recon: where the 740 + Q4_K_M prefill error enters

Read-only reconnaissance. No file outside this report was touched; no build, no run, no device
contact. Starting point: audit item 5 of `scratchpad/agents/s23-kld-740-q4km/AUDIT.md`.

Trees used:

- Engine: `/Users/marco/Projects/kalsallama-wt-1068` at `1068eb03d` (clean, protected ref
  `kalsa-gpu-opencl-v73`). All `file:line` below refers to this tree unless stated.
- Archive: `/Users/marco/Projects/kalsa-moe-experiments` (cells `adreno-acc-type`,
  `adreno-precision-bisect`, `adreno-operand-b`, `gemm-f32-ship`, `logit-oracle`).
- Model file: `/Users/marco/kalsa-models/LFM2.5-2.6B-Q4_K_M.gguf`, size 1674454848 bytes =
  byte-for-byte the size of the device copy the failing run used
  (`s23-kld-740-q4km/REPORT.md:71`).

---

## 1. Q1: which kernels actually run

Note on terms: there is no `PREBATCH` symbol in the engine. The relevant split in the dispatch
code is `ne1 == 1` (decode, GEMV) vs `ne1 > 1` (prefill, transposed-weight GEMM). The failing
instrument prefills 256-token chunks with `-b 256` and never decodes, so every quant mul_mat
sees `ne1 = dst->ne[1] = 256`.

### 1.1 What a Q4_K_M file actually contains (established from the file, not from convention)

I parsed the GGUF tensor-info directory of the exact model (size matches the device copy):

```
python3 struct-parse of /Users/marco/kalsa-models/LFM2.5-2.6B-Q4_K_M.gguf
ver 3, n_tensors 266, n_kv 33
tensor type counts: {'Q6_K': 19, 'F32': 99, 'Q4_K': 148}
```

- **148 x Q4_K**: ffn_gate, ffn_up (all 30 blocks), ffn_down (16 blocks), attn_q/k/output,
  shortconv in_proj/out_proj (all with ne0,ne1 >= 512).
- **19 x Q6_K**: `token_embd.weight` [ne0=2048, ne1=128000], 14 x `ffn_down.weight`
  [10752, 2048], 5 x `attn_v.weight` [2048, 512] (blk.2, 13, 24, 27, 29).
- **99 x F32**: norms, small conv weights.
- There is **no `output.weight`**: the lm_head is the tied `token_embd.weight` (Q6_K).
  `general.file_type` = 15 (MOSTLY_Q4_K_M), as already recorded by the audit from
  `s23-native-gpu-bench/raw/q1_bench_fa.out`.

So Q4_K_M = **Q4_K + Q6_K + F32**, and Q4_K_M is genuinely mixed: 19 tensors of the failing
model are Q6_K, including 14 of the 30 ffn_down projections and 5 attention V projections.

### 1.2 Dispatch walk on A7X (both 740 and 750 classify A7X: `ggml-opencl.cpp:299-304`)

Entry gate for the whole Adreno trans-weight family
(`ggml-opencl.cpp:24173`):

```
if (ne01 && ne1 && use_adreno_kernels(backend_ctx, src0)) { ... }
```

`use_adreno_kernels` (`ggml-opencl.cpp:9006-9030`): thresholds ne0,ne1 >= 512 on this compiler
series (E031.41 >= E031.38), ne2=ne3=1, and for Q4_K/Q5_K/Q6_K/Q8_0 additionally `ne1 % 64 == 0`.
All Q4_K and Q6_K weights of this model pass (smallest ne1 = 512; 512 % 64 == 0).

**Q4_K tensors -> `ggml_cl_mul_mat_q4_k_f32_adreno` (call at `ggml-opencl.cpp:24223-24224`):**

1. `use_q4_k_bin_kernels` (a8/bin path) first (`:22413-22418`): false on 740, because the
   `..._ila_a8_bin` programs are compiled only under `adreno_gen == X2E`
   (`ggml-opencl.cpp:4606-4641`), so the kernel handle is null and
   `use_q4_k_bin_kernels` returns false (`:9482-9491`).
2. `ne1 == 1` GEMV: not taken (batch 256).
3. dp4a dense GEMM (`:22683-22699`): `q4k_dense_dp4a_on` defaults to
   `adreno_gen == X2E` (`:22684-22688`), then ANDed with `has_integer_dot`; the enabling env
   `GGML_OPENCL_Q4K_DENSE_DP4A(_WIMG)` was not set (run env = LD_LIBRARY_PATH + TMPDIR only).
   **OFF on the 740.**
4. Small-batch variants: `use_cok = q4k_gemm_cok && (ne1 <= 8)`, `use_r1`, `use_kimg`
   (`:22785-22806`). cok defaults ON but only for ne1 <= 8; batch 256 takes the default.
5. Selected: **`kernel_gemm_noshuffle_q4_k_f32`** (`:22803-22806`), program built from
   **`kernels/gemm_noshuffle_q4_k_f32.cl`** (`:4416-4431`).

**Q6_K tensors -> `ggml_cl_mul_mat_q6_K_f32_adreno` (call at `ggml-opencl.cpp:24229-24230`):**

1. `use_flat_gemv_for_large_m_q6_K` false: it only fires when weight `ne1 % 128 != 0`
   (`:9470-9474`); our q6_K weights have ne1 = 2048/512/128000, all multiples.
2. Tiled path: `use_q6k_tiled` (`:9322-9326`) requires `q6k_gemv_tiled_enabled`, which
   defaults to X2E/A8X only (`tiled_gemv_default_on`, `:9301-9303`), plus ne1 >= 32768.
   **OFF on the 740** (and it would only ever claim lm_head/embed shapes anyway).
3. `ne1 == 1` GEMV gate (`:22928`): not taken.
4. Else branch (`:23027-23192`): activations narrowed through `kernel_transpose_32_16` into a
   `CL_HALF_FLOAT` image (`:23153`, `:23168`), then `kernel_gemm_noshuffle_q6_K_f32_cok` only
   if `GGML_OPENCL_Q6K_GEMM_COK=1` AND ne1 <= 8 (`:23186-23192`) - default OFF.
5. Selected: **`kernel_gemm_noshuffle_q6_K_f32`** (`:23191-23192`), program built from
   **`kernels/gemm_noshuffle_q6_k_f32.cl`** (`:5536-5551`).

**lm_head (tied token_embd, Q6_K, ne1 = 128000): runs on the CPU.**
`supports_op` MUL_MAT declines vocab-scale Q4_K/Q5_K/Q6_K weights on A7X by default
(`ggml-opencl.cpp:9739-9748`, env `GGML_OPENCL_A7X_LMHEAD_CPU`, unset in the run), because the
E031.41 compiler miscompiles the flat K-quant GEMV. ggml then assigns that op to the CPU
backend. This is symmetric between the 750 acceptance (its QAD-Q4_0 file also has a Q6_K
token_embd - verified by the same GGUF parse: counts Q4_0:166, Q6_K:1 = token_embd, F32:99) and
the 740 failure, so it does not differentiate the two runs.

**F32 tensors**: norms do not matmul; small conv weights go through the conv/f32 paths - float
arithmetic, no product-precision question.

### 1.3 Per-type table: batch-GEMM kernel at `1068eb03d`, and does it multiply in half?

| GGML type (this file) | tensors | batch GEMM kernel selected on A7X, ne1=256 | source | multiply in ... |
|---|---|---|---|---|
| Q4_K | 148 | `kernel_gemm_noshuffle_q4_k_f32` (`ggml-opencl.cpp:22806`) | `kernels/gemm_noshuffle_q4_k_f32.cl:35` | **FLOAT** - carries the fix: `float8 c0` (`:61`), `c0 += convert_float8(B) * (float)dequantized_weights.s0` (`:102-105`) |
| Q6_K | 19 | `kernel_gemm_noshuffle_q6_K_f32` (`ggml-opencl.cpp:23191-23192`) | `kernels/gemm_noshuffle_q6_k_f32.cl:14` | **HALF** - `half8 c0..c3; half8 B;` (`:38-39`), `c0 += B * dequantized_weights.s0` (`:66-69`), B read via `read_imageh` (`:54-56`) - **no f32-product fix** |
| Q6_K lm_head | 1 | none (CPU fallback, `ggml-opencl.cpp:9741-9748`) | - | - |
| F32 | 99 | f32/conv paths | - | float |

Sub-kernel nuance inside the FIXED q4_K file: only `kernel_gemm_noshuffle_q4_k_f32` (line 35)
is fixed. The three small-batch siblings in the same file still multiply in half:
`_r1` (`:190`, `half8 c0` at `:211`, `c0 += B * dq` at `:243`), `_kimg` (`:286`, `:309`,
`:332`), `_cok` (`:399`, `half8 acc` at `:428`). They serve ne1 <= 8 only
(`ggml-opencl.cpp:22785-22806`), so they do not run in this measurement, but they are the
kernels a small-chunk (<= 8 token) streaming prefill would hit - q4_K `_cok` is even
default-ON for that range.

For completeness: `gemm_noshuffle_q6_k_f32_tiled.cl` is natively f32
(`float cs = (float)code * (float)sc[sidx] * dval` `:116`, `acc[j] += cs * lact[...]` `:119`),
but it is unreachable on the 740 (section 1.2) and the tied lm_head is CPU anyway.

### 1.4 Can any Adreno-gated or capability-gated branch change this answer on a 740? No.

- `GGML_OPENCL_USE_ADRENO_KERNELS`: option ON by default (`ggml/CMakeLists.txt:268`), banner of
  the same build on this device says Adreno kernels ON (audit item 5, `opencl-banner.log`).
- dp4a dense GEMM: default **X2E-only** (`:22684-22688`); env not set. `has_integer_dot` is
  true on this device but is ANDed, not sufficient. (The q6_K dp4a program is *compiled* when
  `has_integer_dot` (`:4491-4504`) but has **no dispatch site anywhere** in
  `ggml-opencl.cpp` at `1068eb03d` - grep shows only declaration and clCreateKernel - so it is
  dead code on every generation.)
- bin/a8 kernels: compiled only under `adreno_gen == X2E` (`:4606-4641`) -> null on 740.
- tiled q4_K/q6_K GEMV/GEMM: default only on X2E/A8X (`:9301-9303`), env unset.
- flat-GEMV large-m escape: opt-in env `GGML_OPENCL_FLAT_LARGE_M` (`:9394-9402`), unset, and
  its predicate needs `ne1 % 64/128 != 0` anyway.
- MoE kernels: `use_adreno_moe_kernels` returns false for A6X/A7X/UNKNOWN (`:9044-9052`);
  model is dense (`n_expert = 0`), so moot.
- The run set only `LD_LIBRARY_PATH` and `TMPDIR` (`s23-kld-740-q4km/raw/cpu-arm.log:2`,
  `gpu-arm.log:2`) - no `GGML_OPENCL_*` override was present.

The selection is therefore deterministic: **Q4_K -> fixed f32-product GEMM, Q6_K -> unfixed
half-product GEMM, lm_head -> CPU.**

### 1.5 The expected key finding: CONFIRMED, with one correction to the audit's framing

The fix was applied to SOME batch GEMMs and not others (section 2), and Q4_K_M's mixture does
contain a type whose batch GEMM still multiplies in half: **Q6_K**, exercised by 19 tensors
that run on the GPU in this exact measurement, through `gemm_noshuffle_q6_k_f32.cl`, whose
main kernel computes `B * dequantized_weights.sN` in half over half accumulators
(`:38-39, :66-69`) - the precise defect class that `adreno-acc-type` measured at 95.8x KLD on
the 750 for q4_0 (`stock:half 0.4538 -> stock:mul 0.004736`).

This refines audit item 5 rather than contradicting it: the audit was right that the *q4_K*
kernel carries the fix and is the only reachable Q4_K x F32 batch GEMM; what item 5 did not
weight is that Q4_K_M is mixed, and the *q6_K* sibling of that kernel never received the fix.
The 740 run's GPU-side GEMM population = 148 fixed (Q4_K) + 19 unfixed (Q6_K).

---

## 2. Q2: what the fix touched

### The commits

| commit | subject | in `1068eb03d`? |
|---|---|---|
| `513bf4cea` (+ duplicate `33c3817c4`) | opencl: compute the Adreno q4_0 GEMM product in f32 | YES (both ancestors; `git merge-base --is-ancestor`) |
| `67c73d26c` | opencl: compute the Adreno q4_K GEMM product in f32 ("Mirrors the q4_0 fix. Serves the Q4_K_M catalogue model. Fidelity and cost are unmeasured for this kernel.") | YES |
| `7ef9389bc` | selectable precision and math flags - **KALSA_GEMM_PREC / KALSA_GEMM_MATH** (`-DKALSA_GEMM_PREC=0..3`) | **NO** - probe branch `kalsa/gemm-acc-probe` only |
| `5d188a9e4` | selectable f32 activation operand - **KALSA_GEMM_B** + companion transpose kernel | **NO** - probe only |
| `33ebbd210` | KALSA_BENCH_FAULT_INJECT oracle negative control ("never merge") | NO |

Archive side: `gemm-f32-ship/PLAN.md:104-110` ("Ship branch: one file, 17 code lines, no macros,
no env vars... The env-var machinery stays on `kalsa/gemm-acc-probe`"), and the acc-type probe
lines `gemm_noshuffle_q4_0_f32 prec=... compile_opts='... -DKALSA_GEMM_PREC=2'`
(`adreno-acc-type/REPORT.md`, provenance section).

### The LIST: which .cl kernels received the f32 product (state of the tree at `1068eb03d`)

RECEIVED (unconditional, baked into the source):

1. `kernels/gemm_noshuffle_q4_0_f32.cl` - single kernel, all 16 product sites
   `convert_float8(B) * (float)`, no half product left.
2. `kernels/gemm_noshuffle_q4_k_f32.cl` - **main kernel only** (`:61, :102-105`); the diff of
   `67c73d26c` touches hunks at lines 51-142 only. `_r1`, `_kimg`, `_cok` sub-kernels remain
   half.

NOT RECEIVED (still `half8 c0/acc` + `c0 += B * ...`, verified by grep at `1068eb03d`):
`gemm_noshuffle_q6_k_f32.cl` (`:38/:66`, **the one Q4_K_M exercises**), `gemm_noshuffle_q5_k_f32.cl`
(`:55/:100`), `q4_1` (`:35/:57`), `q5_0` (`:32/:56`), `q5_1` (`:33/:59`), `q8_0` (`:35/:57`),
`iq4_nl` (`:55/:75`), `q1_0` (`:32/:54`), and all ten `gemm_moe_*_ns.cl` (dense models never
reach those). This matches `gemm-f32-ship/PLAN.md:124-141` ("The fix started as ONE kernel.
Eighteen sibling kernels still multiply in half... The other eighteen stay as they are").

### The selector question, answered exactly

`grep -rn "KALSA_GEMM" .` over the whole `1068eb03d` tree: **zero hits**. The KLD audit's finding
stands: those env names do not exist in our engine. They live only in the probe commits
(`7ef9389bc`, `5d188a9e4`), which are not ancestors of `1068eb03d`; the 750 acceptance ran a
probe kit built from that branch (`kit-gemm-acc-probe` @`7ef9389bc`, `adreno-acc-type/REPORT.md`
header), where `-DKALSA_GEMM_PREC=n` and `-DKALSA_GEMM_MATH=...` were compile-time selectors
read inside `gemm_noshuffle_q4_0_f32.cl` and appended to `compile_opts` by the host.

**What our engine does instead:** no selector of any kind. The production fix removed the
#ifdef/env axis entirely and hardcoded the float product into the kernel text (see the ship
plan's "no macros, no env vars"). Consequence: for Q4_K_M there is no runtime knob that makes
the q6_K GEMM multiply in float - fixing it means editing `gemm_noshuffle_q6_k_f32.cl`.

---

## 3. Q3: the kernel cache

Mechanism (`ggml/src/ggml-opencl/cl-program-cache.cpp/.h`):

- Activation: `GGML_OPENCL_KERNEL_CACHE_DIR`; unset/empty/"1"/"default" -> platform default
  (`cl-program-cache.cpp:331-366`, `default_cache_dir()` `:200-215`). On non-Windows/non-Apple
  the default is `temp_directory_path()/llama.cpp/cl-cache` - with an Android app's TMPDIR that
  is exactly `/data/user/0/com.kalsa.app/cache/llama.cpp/cl-cache` (the code comments this case
  at `:206-210`). So the app's cache is ON by default, no env needed.
- Key: `compute_key()` (`cl-program-cache.cpp:156-170`) = SHA-256 of
  `source_bytes || 0x00 || compile_opts || 0x00 || key_suffix`, where `key_suffix`
  (`:239-255`) = CL_DEVICE_NAME, CL_DRIVER_VERSION, CL_DEVICE_VERSION, CL_PLATFORM_VERSION,
  `fmt=<CL_PROGRAM_CACHE_FORMAT_VERSION>` (=1u, `cl-program-cache.h:54`), and
  `kset=<GGML_OPENCL_KERNEL_SET_ID>`. The header documents this contract at
  `cl-program-cache.h:18-30`.
- **The source is hashed, and so is the kernel set**: `GGML_OPENCL_KERNEL_SET_ID` is a SHA-256
  over `kernel_name:sha256(kernel_source);` for every kernel in the build, computed at CMake
  configure time (`ggml/src/ggml-opencl/CMakeLists.txt:42-51, 265-266`), with a
  CMAKE_CONFIGURE_DEPENDS hook so embed builds (`GGML_OPENCL_EMBED_KERNELS` default ON,
  `ggml/CMakeLists.txt:267`) stay current. The engine passes the program text itself -
  embedded `.cl.h` string or `read_file(".cl")` - to `build_program_from_source`, which calls
  `cl_program_cache_try_load` first and falls through to `clBuildProgram` from source on any
  miss (`ggml-opencl.cpp:1428-1447`). No `.cl` file contains `#include`, so the hashed text is
  the complete source.
- Verdict file: `verdict-<sha256(key_suffix)>.txt`, i.e. keyed on device identity + kset
  (`cl-program-cache.cpp:257-270`), written by `ggml_opencl_record_verdict`
  (`ggml-opencl.cpp:~1415-1425`); a cached `ok=0` disables the whole device at backend init
  ("device disabled, ops stay on CPU", `ggml-opencl.cpp:7171-7177`), and fail verdicts older
  than 15 min are ignored (`cl-program-cache.h:59`, `.cpp:524-530`). `1068eb03d` is the commit
  that introduced the kset keying precisely so a kernel fix invalidates a stale fail verdict.

### Decision: can a program compiled from PRE-fix source be reused after the fix? No.

For any kernel whose source the fix changed (`gemm_noshuffle_q4_0_f32.cl`,
`gemm_noshuffle_q4_k_f32.cl` main program), the pre-fix and post-fix `source_bytes` differ ->
different SHA-256 key -> different `.clbin` file. A pre-fix binary sits orphaned in the cache
directory but can never be selected. The kset field makes this doubly true even if two
kernels shared a program: the whole-set hash moves. Unchanged kernels (e.g.
`gemm_noshuffle_q6_k_f32.cl`) may load a cached binary from an old session, but by construction
that binary was built from byte-identical source and equivalent options on the same device and
driver - it is not "pre-fix arithmetic", it is the same arithmetic.

Applied to the two caches in question:

- **The measured run**: TMPDIR was `/data/local/tmp/s23-kld-740`
  (`raw/gpu-arm.log:2`), so its cache was `$TMPDIR/llama.cpp/cl-cache` - a directory created by
  that session's fresh `1068eb03d` binary (built that day, sha256 recorded,
  `REPORT.md:62-63`), deleted at cleanup. No pre-fix source has ever been compiled into it.
- **The app** (`/data/user/0/com.kalsa.app/cache/llama.cpp/cl-cache`): persists across runs and
  installs, but an engine update changes both the per-program source hash and the kset id, so
  pre-fix entries are unreachable the moment the app ships fixed sources.

**Verdict: the stale-cache hypothesis is refuted by code**, for the measured run (session-local
cold cache under an overridden TMPDIR) and for the app (source+opts+kset keyed). One honest
caveat: the cache directory was deleted without being listed (`REPORT.md:180-182`), so this
conclusion rests on source reading, not on an artefact. `GGML_OPENCL_KERNEL_CACHE_DEBUG=1`
prints a HIT/MISS/SAVE trace to stderr even in tools that filter INFO logs
(`cl-program-cache.h:11-13`) and would close it empirically.

One adjacent mechanism the cache discussion surfaces, worth recording: a *fail verdict* or a
mid-init program build failure sets `kernel_build_failed` and the init loop early-returns
(`if (backend_ctx->kernel_build_failed) { return; }`, e.g. `:4425`). A full verdict fail means
full CPU fallback, which the timing and KLD of the measured run already exclude (audit item 3).
A partial failure would leave kernel handles unassigned and hit `CL_CHECK`, which is
`GGML_ASSERT(0)` - a crash, not wrong numbers (`ggml-opencl.cpp:67-73`). So the "silent
wrong-arithmetics fallback" reading of `1068eb03d`'s "no exit(1)" subject is weakly supported
by the code as written; see section 6.

---

## 4. The named residual: the f16 activation-transpose operand

**What it is.** In every trans-weight quant GEMM/GEMV path the activations arrive f32 and are
viewed as an `CL_RGBA/CL_FLOAT` image, then deliberately narrowed to f16 by a shared transpose
kernel before the GEMM multiplies:

- source image f32: q4_K block `ggml-opencl.cpp:22631`; q6_K block `:23129-23131`;
- transpose scratch sized at half: `region.size = K * (N + padding) * sizeof(float)/2`
  (`:22639`), format `CL_RGBA, CL_HALF_FLOAT` (`:22653` q4_K; `:23153` q6_K);
- the transpose itself: `kernel_transpose_32_16`, launched at `:22668` (q4_K) and `:23168`
  (q6_K); its source carries `// converts to FP16` (`kernels/transpose.cl:113`), reads the f32
  input with `read_imageh` after conversion (`:127`) and writes with `write_imageh` (`:139`);
- the GEMM then reads `B` as `half8` via `read_imageh`
  (`gemm_noshuffle_q4_k_f32.cl:62`, `gemm_noshuffle_q6_k_f32.cl:54-56`).

So even the FIXED q4_K kernel, whose *product* is f32, still multiplies a f16-narrowed
activation operand. The batch-1 GEMV path does not transpose and keeps `CL_FLOAT`
(`adreno-precision-bisect/REPORT.md`, reading 3: q4_0 GEMV `__private float2 totalSum`,
image `CL_FLOAT`), which is why decode measured clean.

**Where it lives.** One shared host helper kernel (`transpose.cl`) invoked by all ten quant
trans-weight paths (q1_0, q4_0, q4_1, q5_0, q5_1, iq4_nl, q8_0, q4_K, q6_K, q5_K - enumerated
in `adreno-acc-type/REPORT.md`, transpose paragraph), i.e. by both quant types this run used.
Changing it in place would silently alter nine other paths.

**What `adreno-operand-b` changed and measured** (cell REPORT, QRD8650 / Adreno 750, session
808395, kit @`eefa27e30` = probe commit `5d188a9e4`):

- Changed: a *companion* transpose kernel (token-identical apart from element type) writing an
  f32 image, the transposed scratch doubled, and the GEMM reading `read_imagef`, selected by
  `KALSA_GEMM_B=half|float`; the shared `kernel_transpose_32_16` was deliberately left
  untouched (`5d188a9e4` commit message; `adreno-operand-b/REPORT.md`, reading 3).
- Measured (same corpus/seed/protocol, 4 rows): `stock:mul:half` 0.004736 / 94.826% (control
  reproduces to the sixth decimal), **`stock:mul:float` 0.004641 / 94.319%**, `stock:deq:float`
  0.004635 / 94.432%.
- Reading: NO. Keeping activations f32 into the q4_0 GEMM changes KLD by within 2% and slightly
  *worsens* same-top; it costs 0.509x throughput (bandwidth doubling on the transposed leg) and
  was discarded. The chain of refutations on the 750 then reads: attention, compiler flags,
  f16 accumulator, dequant precision, stored-operand precision - all refuted; only the
  *product* ever moved KLD (95.8x). Remaining named suspects after that cell: tile geometry and
  summation order.

---

## 5. Ranked candidates and the single cheapest discriminating experiment

Ranking = likelihood x cheapness to test (likelihood from the source and the archive, cheapness
in phone/build/QDC cost).

| # | candidate | likelihood | cheapness | basis |
|---|---|---|---|---|
| 1 | **Q6_K batch GEMM still multiplies in half** (the fix-coverage gap; section 1.5) | HIGH | HIGH - one kernel edit mirroring `67c73d26c` + `ninja llama-perplexity` + one phone session; no app build, no QDC | source-proven at `1068eb03d`; 19 Q6_K tensors (14 ffn_down + 5 attn_v) execute that kernel at batch 256; same defect class measured at 95.8x KLD on the 750 |
| 2 | 740-specific driver/compiler defect in one of the executed kernels | MED | HIGHEST - a control rerun needs no code change at all | this E031.41 compiler family has documented 740-specific breakage in this very file: flat K-quant GEMV "broken on Adreno 740 driver 0676.73 (NMSE ~12)" (`:9456-9459`), FA programs SIGSEGV on A7X (`:9894-9905`), MoE trans4_ns miscompile "found with some A7x" (`:9046-9048`); but no carve-out exists for the noshuffle q4_K/q6_K GEMMs, and the sibling 750 cleared the gate with the same compiler series |
| 3 | q4_K main kernel infidelity / tile-geometry / sum-order residue (the ~5x-class residual the acc-type and operand-b cells left standing, unmeasured for q4_K anywhere) | MED as contributor, LOW as explanation of 0.395 | MED - only separable from #1 by patching #1 and observing | `adreno-operand-b/REPORT.md` (final section): tile geometry `{1,128,1}/{2,64,1}` + `qcom_reqd_subgroup_size("full")` and per-fiber K-accumulation order are the two suspects that cell could not touch; `gemm-f32-ship/PLAN.md:161` - q4_K fidelity never measured on any device |
| 4 | f16 activation-transpose operand (section 4) | LOW as the 80x cause - refuted on 750/q4_0 by `adreno-operand-b` (within 2%); MEDIUM as a contributor; UNTESTED for q6_K | MEDIUM - port of probe commit `5d188a9e4` (host + kernel), rebuild | measured NO on the only path it was measured on |
| 5 | silent compile-failure fallback at `1068eb03d` ("no exit(1)") | LOW - verdict-fail means full CPU (excluded by timing), partial failure means `CL_CHECK`/assert crash, not wrong logits (section 3); banner process of the same build compiled fine on this device | HIGH to observe - `GGML_OPENCL_KERNEL_CACHE_DEBUG=1` + unfiltered stderr of the measured process | audit item 5's "one silent mechanism", now narrowed |
| 6 | stale pre-fix cached program | REFUTED by code (section 3): key = sha256(source, opts, device, driver, fmt, kset); measured run used a session-local TMPDIR cache | N/A - already answered by reading; optional `..._CACHE_DEBUG=1` confirmation | the 0.395/63.9% proximity to the 750's pre-fix 0.4538/62.8% is a magnitude coincidence until #1 or #2 says otherwise |

### The single cheapest experiment that best discriminates

**One session, one patched GPU arm against a regenerated reference - the q6_K f32-product
A/B.** It is the likelihood-weighted cheapest (candidate #1 tests by far the most likely cause
for the least work) and its two outcomes split the whole table:

- KLD collapses toward the ~0.005 regime: #1 confirmed AND #4 (f16 operand) refuted for q6_K at
  the same time (the patch keeps the identical f16 operand; only the product changes - exactly
  the `67c73d26c` shape), AND #2/#5/#6 exonerated for this path (fresh build, fresh cache,
  device produced correct-enough numbers).
- KLD stays ~0.395: #1 and #3-as-sole-cause die; the field narrows to #2 (740 driver), #4
  (operand, q6_K-specific), and a q4_K-main-kernel problem - each then testable without
  ambiguity.

Mechanics (mirrors the reviewed fix; the owner owns the edit):

1. Host edit, one file:
   `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl` - in `kernel_gemm_noshuffle_q6_K_f32`
   (line 35), copy the `67c73d26c` pattern: widen `c0..c3` to `float8` (`:38`), and change the
   eight product lines (`:66-69`, `:78-81`, ...) from `c0 += B * dequantized_weights.sN` to
   `c0 += convert_float8(B) * (float)dequantized_weights.sN`. Leave `_cok` (`:155`) alone; it
   cannot run at ne1=256 and changing it would mix questions.
2. Build:
   `cd /Users/marco/Projects/kalsallama-wt-1068/build-android-ocl-1068 && ninja llama-perplexity`
3. Phone (same protocol as `s23-kld-740-q4km/REPORT.md` section 7; reference file was deleted,
   so one CPU arm must be regenerated first - it is shared by both GPU arms):
   ```
   # push binary, libomp.so, corpus.txt; then:
   cd /data/local/tmp/s23-kld-740-q4km2 && \
   LD_LIBRARY_PATH=$PWD/lib TMPDIR=$PWD ./llama-perplexity \
     -m /data/local/tmp/llamabench/LFM2.5-2.6B-Q4_K_M.gguf \
     -f corpus.txt -c 256 -b 256 -ngl 0  -fa off -s 42 --temp 0 --kl-divergence-base cpu.kld

   # arm i: stock binary (reproduce 0.394993 / 63.892%)   [provenance control]
   # arm ii: patched binary, same command plus:
   #   -ngl 99 -fa off ... --kl-divergence --kl-divergence-base cpu.kld
   ```
   Read: arm i reproduces; arm ii vs arm i is the decisive delta. Optionally add
   `GGML_OPENCL_KERNEL_CACHE_DEBUG=1` to the arm-ii invocation to archive the HIT/MISS trace
   (closes #6 empirically for free).

**Zero-build fallback/parallel control** (cheapest possible single run, weaker
discrimination): rerun the identical protocol with `LFM2.5-2.6B-QAD-Q4_0.gguf` on the same 740.
All its GPU GEMMs are the fixed q4_0 kernel (166 tensors) and its lm_head is the same CPU
Q6_K rule, so a PASS exonerates device/driver/cache/operand for the q4_0 path and localizes the
failure to the Q4_K_M mixture; a FAIL points at the device. First verify the file is on the
phone (`adb shell ls -l /data/local/tmp/llamabench`); the app's copy lives under
`/data/user/0/com.kalsa.app/files/...` (readable only via run-as), and the Mac copy is
`/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`. It does NOT separate q6_K from
q4_K-within-the-mixture, which is why it ranks second despite being free.

Both runs obey the standing rules: phone unplugged check before/after, no app interaction, no
settings writes, archive every transcript this time (battery reads, `ls` listings, the cache
debug trace - the exact gaps the last audit flagged).

---

## 6. WHAT WE DO NOT KNOW

1. **Which kernels actually executed in the failing run.** No artefact exists: the perplexity
   log filters the OpenCL banner, the cl-cache directory was deleted unlisted, and no
   kernel-selection log line exists at `1068eb03d`. Everything in section 1 is what the source
   *selects*, proven to be deterministic under the recorded env, but not a record of what ran.
2. **Whether the q6_K half product is sufficient to produce 0.395/63.9%.** The 95.8x precedent
   is q4_0-on-750; no KLD measurement of any q6_K GEMM exists on any device, and the mixture
   here also contains the never-measured q4_K main kernel. Only experiment section 5 settles
   sufficiency.
3. **Whether the 740 can clear the gate at all.** No acceptance number exists for any model on
   this phone; 0.004736/94.826% is a 750 (QRD board) number with Q4_0. The Q4_0 control run is
   the missing calibration.
4. **q4_K fidelity post-fix anywhere** (`gemm-f32-ship/PLAN.md:161` said "no"; this recon found
   no later measurement) - the residual factor ~5 vs GEMV fp32, and the tile-geometry/sum-order
   suspects, were never isolated.
5. **Whether GDN/attention support ops assigned where we assume.** SSM_CONV/SSM_SCAN are
   supported as F32 (`ggml-opencl.cpp:9682-9697`); `GGML_OP_GATED_DELTA_RULE` has no
   supports_op case, and the actual per-op backend split of the lfm2 graph in the failing run
   was never traced (no graph dump archived; the acc-type-era dumps were declared UNALIGNED for
   a different graph).
6. **Whether the app's shipped APK carries pre-fix sources at all.** The engine-side cache
   question is answered (section 3), but which fork pin + vendored `.cl` files the current
   `com.kalsa.app` build contains was not checked here (the vendored-kernel history: `main`
   pinned `a0cabca6b` had `half8 c0` at line 38, `gemm-f32-ship/PLAN.md:36-41`; whether every
   shipping branch since received `67c73d26c` is a separate app-repo question).
7. **Device-side hygiene assertions of the original run** (battery, cleanup, listings) - still
   report-author assertions with no archived transcripts, unchanged by this recon.
8. **The exact second model in `/data/local/tmp/llamabench`** ("both .gguf models",
   `s23-kld-740-q4km/REPORT.md:183`) - no archived listing names it; the Q4_0 control's push
   cost is therefore unverified.
