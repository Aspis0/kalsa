# REPORT - opencl-q8-activation-scale: float activation block scale for the dense q6_K dp4a path

Coder cell, detached worktree, base `563896ffa` (integration line - available, so used).
No push, no tag, no upstream, no phone touched, nothing in `/Users/marco/Projects/kalsallama`
modified (read-only `git worktree add` / `git log` against its object store).
Ref: `kalsa-opencl-q8-activation-scale`.

Task: make the int8 dp4a path numerically honest - the fp16 q8_1 activation block scale
flushes subnormal to zero on the Adreno 740 (`CL_DEVICE_HALF_FP_CONFIG=0x16`, DENORM off),
confirmed by `scratchpad/agents/dp4a-builtin-harness/REPORT.md` (K4 probe:
`match=0 flushed=2 mismatch=2` on 4 blocks; CPU reference stores the scale in float,
`ggml-quants.c:2768`, `ggml-cpu.c:509/525`). Section 1 is the layout inventory, written
before any code was changed, per the brief. Sections 2+ record the implementation as built.

## 1. Inventory of the q8_1 activation block layout (all line numbers at `563896ffa`)

### 1.1 There is no block struct

The q8_1 activation layout is not a struct anywhere. It is a triple of flat device
buffers, one array per field, typed only in the kernel signatures and host comments:

| field | element type today | shape per dispatch |
|---|---|---|
| `qa` int8 quants | `char` / `cl_char` | `[N * K]` |
| `da` block scale    | `half` / `cl_half` | `[N * (K/32)]`  <- the defect |
| `sa` block sum (`d * Sum(qs)`) | `half` / `cl_half` | `[N * (K/32)]` |

- Writer signatures: `kernels/quant_a_q8_1.cl:8-13` (`da` at `:10`, `sa` at `:11`);
  `kernels/moe_reorder_quant_a_q8_1.cl:12-21` (`da` at `:16`, `sa` at `:17`).
- Consumer signatures: `__global const half * src1_da` in every dp4a GEMM, see 1.3.
- Host buffer declarations: `ggml-opencl.cpp:721-724`
  (`prealloc_moe_qa/da/sa`, comment on `:723`: "per-block d ... (half)").

### 1.2 Kernels that WRITE the layout (2)

1. `kernels/quant_a_q8_1.cl` - `kernel_quant_a_q8_1` (`:7`); scale store
   `da[blk] = (half)d;` at `:40`, sum store `sa[blk] = (half)(d * (float)sum);` at `:41`.
   Dispatched from 7 dense host sites via `cl_kernel qk = backend_ctx->kernel_quant_a_q8_1`
   (`ggml-opencl.cpp:20877, 21320, 21762, 22078, 22805, 23202, 23539` - q4_0, q5_0,
   iq4_nl, q8_0, q4_k, q6_K, q5_K).
2. `kernels/moe_reorder_quant_a_q8_1.cl` - `kernel_moe_reorder_quant_a_q8_1` (`:12`);
   scale store `da[bidx] = (half)d;` at `:62`, sum at `:63`. Dispatched from 7 MoE host
   sites (`cl_kernel rq`, `ggml-opencl.cpp:27398, 27816, 28198, 28583, 28808, 29133, 29699`).

No other kernel writes `da`/`sa`. `kernels/cvt.cl` only name-checks q8_1 in comments; its
`kernel_moe_expand_scale_q8_0` (`cvt.cl:~3090`) expands the *weight* q8_0 scale for the
generic MoE GEMM - a different buffer, not the activation layout.

### 1.3 Kernels that READ `da` (12 source files, 15 entry points + 2 precompiled)

Dense noshuffle dp4a (7 files, 10 entry points), `src1_da` declaration lines:

| file | entries (`kernel void`) | `src1_da` at | also reads `sa`? |
|---|---|---|---|
| `gemm_noshuffle_q4_0_q8_1_dp4a.cl` | `:30` | `:34` | yes `:93` |
| `gemm_noshuffle_q4_k_q8_1_dp4a.cl` | `:56`, `:172 _wimg` | `:62`, `:178` | yes `:135`, `:249` |
| `gemm_noshuffle_q5_0_q8_1_dp4a.cl` | `:39`, `:138 _wimg` | `:44`, `:143` | yes `:103`, `:203` |
| `gemm_noshuffle_q5_k_q8_1_dp4a.cl` | `:56` | `:63` | yes `:132` |
| `gemm_noshuffle_q6_k_q8_1_dp4a.cl` | `:42` | `:48` | **no** |
| `gemm_noshuffle_q8_0_q8_1_dp4a.cl` | `:27`, `:123 _wimg` | `:31`, `:127` | no |
| `gemm_noshuffle_iq4_nl_q8_1_dp4a.cl` | `:51` | `:55` | no |

MoE dp4a (5 files, 5 entry points): `gemm_moe_q4_0_q8_1_dp4a.cl:39` (sa `:127`),
`gemm_moe_q4_k_q8_1_dp4a.cl:68` (sa `:170`), `gemm_moe_q6_k_q8_1_dp4a.cl:59` (no sa),
`gemm_moe_mxfp4_q8_1_dp4a.cl:59` (no sa), `gemm_moe_q8_1_dp4a.cl:119` (sa `:193`).

Precompiled Adreno binaries (not editable, built only with
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS=ON`, the bench recipe sets it OFF):
`gemm_moe_mxfp4_q8_1_dp4a_ila` (`ggml-opencl.cpp:5070`) and
`gemm_moe_q4_0_q8_1_dp4a_ila` (`:5106`). Both read the layout as half; any float
promotion that included the MoE path would silently break them.

Every consumer stages `da` through `__local half sh_d[...]` and converts to float at use
(e.g. q6_K `:91` load, `:117` `(float)sh_d[...]`), so the flush happens twice: once at
the writer's `(half)d` store and again at staging - promotion must change the buffer
element type, the local staging type, and the load cast together.

### 1.4 Host allocation and sizing (`ggml-opencl.cpp`)

- Buffer struct `ggml_cl_buffer` `:368-393`; `allocate()` `:381-392` is **grow-only**
  (realloc only when `new_size > size`, never shrinks) - relevant to safety, see 2.1.
- `da` sized `n_blocks * sizeof(cl_half)` (`n_blocks = N * (K/32)`) at **14 sites**:
  7 dense - `:20873, 21316, 21758, 22074, 22801, 23198, 23535` - and 7 MoE -
  `:27393, 27811, 28193, 28577, 28803, 29128, 29692`. `sa` mirrors it one line down at
  every site; `qa` is `N * K * cl_char`.
- Kernel args: writer `qk` args 2/3 = `prealloc_moe_da`/`_sa` at the same 7 dense sites;
  consumers get `prealloc_moe_da` per site (q6_K: `:23219`); MoE writer `rq` args 3/4 at
  the 7 MoE sites.
- The `da` buffer is never read back to the host anywhere - kernel args only.

### 1.5 Which of these can actually run on the Adreno 740 (A7X, `has_integer_dot=true`, stock envs)

Only the **dense q6_K** pair: `ggml_cl_mul_mat_q6_K_f32_adreno`'s dp4a branch
(`:23186-23231`), and only when `KALSA_Q6K_DENSE=dp4a` (at `563896ffa` the selector
defaults to the f32 GEMM route, which returns before the dp4a branch).
- q4_0 dense dp4a: default off, env `GGML_OPENCL_Q4_0_DENSE_DP4A` (`:~20866`).
- q5_0 dense dp4a: default off, env `GGML_OPENCL_Q5_DENSE_DP4A` (`:~21321` site env).
- iq4_nl / q8_0 / q4_k / q5_k dense dp4a: default `adreno_gen == X2E` only -> off on A7X.
- All 7 MoE sites: unreachable, the shipped model is dense (`n_expert = 0`).
- The 2 precompiled dp4a binaries: `GGML_OPENCL_USE_ADRENO_BIN_KERNELS=OFF` in the bench.

### 1.6 Width verdict (decides the change)

A **global** float promotion of `da` = 14 .cl files (2 writers + 12 source readers),
14 host allocate sites, plus a hard incompatibility with the 2 precompiled MoE dp4a
binaries (they hardcode half and cannot be rebuilt) and with `sa` users if `sa` were
promoted too. That is not a small change.

The layout only requires **per-dispatch writer/consumer agreement**, not global
consistency: each site overwrites the whole `da` region it reads, writer then consumer,
on one in-order queue, before any other site runs (section 2.1). So the smallest change
that removes the flush where it was measured (dense q6_K dp4a, section 1.5) is to promote
`da` for that pair only: 2 .cl files + 1 selector + 2 extra program builds + 1 allocate
line + 2 dispatch picks. That is what is implemented here; section 6 states how to widen
it if the owner decides the other arms must flip too.

## 2. What was implemented (commit `87f31d81f`, ref `kalsa-opencl-q8-activation-scale`)

Stack: `563896ffa` -> `87f31d81f` (this). Worktree:
`/Users/marco/Projects/kalsallama-wt-q8scale`, detached HEAD. Pushed: NO. No tag, no
upstream (verified: `fatal: no upstream configured for branch ...`). 3 files changed,
61 insertions(+), 8 deletions(-).

### 2.1 Design: pair-scoped float promotion, behind `KALSA_Q8A_SCALE`

The fix follows the inventory's width verdict (1.6): promote `da` from half to float for
the dense q6_K dp4a pair only, selected at load time.

- `kernels/quant_a_q8_1.cl` (+8/-2): a `q8a_t` typedef (`float` under
  `-DKALSA_Q8A_SCALE_F32`, else `half`); the `da` parameter and the `da[blk] = (q8a_t)d;`
  store use it. `sa` stays half. Define-off preprocesses back to the stock types - proven
  below, not asserted.
- `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl` (+10/-4): the same typedef; `src1_da`
  signature, `__local sh_d` staging, and the `(q8a_t)0` fallback use it. The `(float)`
  conversions at the use sites are unchanged (half->float is exact, float->float is
  identity), so the fp32 arm changes only the storage and staging width of the scale.
- `ggml-opencl.cpp` (+41/-3):
  - selector `kalsa_q8a_scale_f32()` (after `kalsa_q6k_dense_f32()`, same style):
    `KALSA_Q8A_SCALE=fp32|fp16`, unset means fp32, anything else = `GGML_LOG_ERROR` +
    `exit(1)` so an A/B never runs the wrong arm silently;
  - two extra program builds in `load_cl_kernels`, only when the arm is fp32:
    the q6_K dp4a GEMM and the quant pre-pass rebuilt from the same source with
    `compile_opts + " -DKALSA_Q8A_SCALE_F32"`, producing two new kernel handles
    (`..._dp4a_f32`, `kernel_quant_a_q8_1_f32`); programs are released after
    `clCreateKernel`, matching the stock pattern, and the program-cache key includes
    `compile_opts` (SHA-256 `source || compile_opts || ...`, `cl-program-cache.h:18-29`),
    so the two arms are distinct cache entries and cannot collide;
  - one `GGML_LOG_WARN` line at load: `ggml_opencl: q8_1 activation scale: fp32|fp16
    (KALSA_Q8A_SCALE)` - WARN not INFO because the bench stderr filter drops INFO lines
    (the `KALSA_Q6K_DENSE` INFO line was proven invisible in
    `opencl-q6k-accurate-path/REPORT.md` section 7; that line is left as-is, out of scope);
  - the q6_K dp4a dispatch site: `prealloc_moe_da` sized `n_blocks * sizeof(cl_float)`
    in the fp32 arm (`sizeof(cl_half)` in fp16), and writer/consumer kernel picks by arm.

### 2.2 Why per-pair scope is sufficient (the buffer is shared, and that is safe)

`prealloc_moe_da` is one grow-only buffer (`ggml_cl_buffer::allocate`, `:381-392`, reallocs
only when growing) shared by all 14 dispatch sites. Consistency is needed per dispatch,
not per process: each site allocates, then its writer overwrites the entire `da` region
it will read (all `n_blocks` elements), then its consumer reads exactly that region, all
on one in-order queue before any other site runs. Element type is decided per site by the
site's own kernel pair, and the size check is in bytes, so both orderings are safe:
fp32-then-fp16 reuses the oversized buffer and rewrites the first 2*n bytes as halfs;
fp16-then-fp32 sees `4n > 2n` and reallocs. The other 6 dense sites and all 7 MoE sites
keep their stock half writer + half consumer, so they are bit-identical to `563896ffa`
in both arms.

### 2.3 Selector matrix (this device: A7X, `has_integer_dot=true`, other envs unset)

| env | dense q6_K batch GEMM (KALSA_Q6K_DENSE unset) | activation scale |
|---|---|---|
| (nothing) | f32 GEMM route (KALSA_Q6K_DENSE default) - dp4a branch never entered | n/a, **fp32 scale arm is the build default** |
| `KALSA_Q6K_DENSE=dp4a` | dp4a branch, stock kernel **source** rebuilt with float `da` | **fp32 (default): no flush** |
| `KALSA_Q6K_DENSE=dp4a KALSA_Q8A_SCALE=fp16` | dp4a branch, stock half `da` (preprocess-identical to `563896ffa`) | fp16 = the measured-defect arm |
| `KALSA_Q8A_SCALE=<other>` | - | log error, `exit(1)` |

One binary serves all four rows. The A/B for the open question is the last two rows:
`KALSA_Q6K_DENSE=dp4a` with and without `KALSA_Q8A_SCALE=fp16`.

**Default = fp32, defended:** (1) the fp16 arm is a confirmed device defect (harness K4:
subnormals flush, `got_da=0x0000`), and a default that knowingly runs a confirmed-broken
arm is not defensible once written down; (2) it matches the CPU reference, which carries
the scale in float (`Q8_K`, `ggml-quants.c:2768`), so the KLD comparison target agrees;
(3) the A/B is symmetric - both arms live in this binary, one env flip, no rebuild;
(4) precedent: `KALSA_Q6K_DENSE` also defaults to the accurate side. The fp32 arm adds no
kernel launches and no transpose - unlike the f32 GEMM route that cost the 9.9%, the dp4a
kernels still run int8; the only change is 4 bytes instead of 2 for the scale array.

### 2.4 Machine proof that the fp16 arm is the stock arm

`clang -E` of both modified files with the define OFF vs the `563896ffa` blobs: the diff
is the added `typedef half q8a_t;` line and the alias spelling (`half` -> `q8a_t`) at the
4+1 substituted tokens; nothing else differs (25 and 26 diff lines, all of that form).
The alias resolves to `half`, so the fp16 arm compiles the stock types and stock
arithmetic. Output in-session; commands in section 4.

## 3. What was NOT fixed (separate defects, deliberately not folded in)

1. **Block size 32 vs 256.** The GPU quantizer quantizes per 32 elements
   (`quant_a_q8_1.cl`, `v[32]`, `n_blocks = N * (K/32)`); the CPU reference quantizes per
   256 (`Q8_K`, `QK_K=256`, `ggml-quants.c` / `ggml-cpu.c:509/525`). Different quantization
   grid, different number of scales, different rounding opportunities. This is a second,
   independent divergence source and is untouched by this change - fixing the flush does
   not make the two grids agree, and a clean A/B on the scale type says nothing about it.
2. **`sa` (block sum) is still half.** `sa[blk] = (half)(d * (float)sum)` remains in both
   writers. It is read by the q4_0/q4_k/q5_0/q5_K dense GEMMs and 3 MoE GEMMs (inventory
   1.3), where `d*sum` can also lose precision. It is **not read at all by the q6_K dp4a
   GEMM** (no `src1_sa` in the file; the host does not pass it), so for the path under
   test it is dead weight, and promoting it would widen the change for no effect there.
3. **The other 6 dense dp4a arms and all 7 MoE arms still store half `da`** - unchanged
   and, per 1.5, unreachable on this device with stock envs (opt-in envs / X2E-only /
   dense model). Promoting them too is the widening option in section 6.
4. **The 2 precompiled MoE dp4a binaries** (`_ila`) hardcode half and are not rebuildable;
   any future promotion of the MoE path must either disable or rebuild them.
5. **The int8 activation quantization grid itself** (per-32 amax, `d = amax/127`, `rint`)
   is unchanged - it is inherent to the q8_1 design and is the same kind of quantization
   the CPU reference performs (just at 256-block granularity, item 1).
6. **The dp4a builtin call sequence** - already refuted as a suspect by the harness; not
   touched.

## 4. Syntax gate (NDK clang `-fsyntax-only`, both arms, both targets)

`/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang`
(r29, clang 21), `-x cl -cl-std=CL3.0 -Xclang -finclude-default-header -fsyntax-only`,
run over the 2 touched `.cl` files:

| target | define off (fp16 arm) | `-DKALSA_Q8A_SCALE_F32` (fp32 arm) |
|---|---|---|
| `-target spirv64` (the project's preregistered gate) | **rc=0 / rc=0** | **rc=0 / rc=0** |
| `-target aarch64-linux-android28` | rc=1 / rc=1 | rc=1 / rc=1 |

The aarch64 rows fail for **stock too** (re-run against the `563896ffa` blobs in the same
session: rc=1, 2 errors / 7 errors): that bare target does not honor
`cl_khr_fp16`/`cl_khr_integer_dot_product` pragmas, so `half` casts, `__local half`, and
`dot_acc_sat_4x8packed_ss_int` are undeclared there regardless of this change. The viable
gate for these fp16 files is spirv64, where all 4 combinations pass; warnings under
spirv64 are the stock `qcom_wave_pair_mode` / ignored-pragma notes, present in the
untouched file.

## 5. Android build (recipe = the bench recipe, verbatim)

Configured **after** the commit so the stamp matches the ref. Log:
`/tmp/q8scale/configure.log`, `/tmp/q8scale/build.log`.

- Configure: **rc=0**, `-- ggml commit:  87f31d81f` (matches
  `kalsa-opencl-q8-activation-scale`); cache verified: `BUILD_SHARED_LIBS:BOOL=OFF`
  (required or the link fails on `AHardwareBuffer_allocate/lock/release/unlock`),
  `OpenCL_INCLUDE_DIR:PATH=.../include`, `OpenCL_LIBRARY:FILEPATH=.../libOpenCL.so`
  explicit because the NDK re-roots `CMAKE_PREFIX_PATH`.
- `cmake --build ... --target llama-perplexity`: **rc=0**, 329/329, zero lines matching
  `error`. Linking line: `[329/329] Linking CXX executable bin/llama-perplexity`.

Artefact:

```
path:    /Users/marco/Projects/kalsallama-wt-q8scale/build-android-ocl-q8scale/bin/llama-perplexity
size:    119750600 bytes
sha256:  44dda288e27c594730bed725cab5465153050334e16cf13af59b9837feb6711c
ELF64 AArch64 (interpreter /system/bin/linker64 on the bench binaries)
```

Self-reported build line (`build-android-ocl-q8scale/common/build-info.cpp`, and the
`version: %s (build %d, commit %s)` format string + `87f31d81f` literal confirmed inside
the ELF via `strings`):

```
LLAMA_BUILD_NUMBER = 11200        (== git rev-list --count HEAD)
LLAMA_COMMIT       = "87f31d81f"
LLAMA_COMPILER     = "Clang 21.0.0"
LLAMA_BUILD_TARGET = "Android aarch64"
-> runtime: version: <llama_version()> (build 11200, commit 87f31d81f)
```

`llvm-readelf -d` NEEDED: `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so` - the same
set as every bench binary; ship `libomp.so` alongside, as in the previous cells.

## 6. Owner decision points and the widening option

- Implemented: pair-scoped promotion (2 .cl files, dense q6_K path). The global layout
  change would be 14 .cl files + 14 allocate sites + a conflict with the 2 precompiled
  MoE binaries (1.6); not done, yours to order.
- Widening to the other 6 dense arms, if you want it: same typedef edit in those 6
  consumer files, pass `compile_opts + " -DKALSA_Q8A_SCALE_F32"` at their 6 build sites,
  arm-pick writer/consumer/alloc at their 6 dispatch sites. Additive, same selector,
  no design change. MoE additionally hits the precompiled-binary problem (item 3.4).
- The `sa` promotion (item 3.2) is a separate one-line-per-file change if the q4_k/q5_k
  family is ever put on the bench.

## 7. Status and boundaries

- On disk: commit `87f31d81f`, ref `kalsa-opencl-q8-activation-scale` (no upstream, no
  tag, never pushed), worktree `/Users/marco/Projects/kalsallama-wt-q8scale` clean after
  the build, binary + sha256 above, this report.
- The shared `/Users/marco/Projects/kalsallama` was not modified: its dirty-file census
  is 11 entries, identical before and after this session (7 modified + 4 untracked, all
  pre-existing); only `git worktree add` / object-store reads against its `.git`.
- **No phone was touched**: no `adb`, no push, no run. The measurement is the owner's to
  schedule. Suggested arms (one binary): control = `KALSA_Q6K_DENSE=dp4a
  KALSA_Q8A_SCALE=fp16`, treatment = `KALSA_Q6K_DENSE=dp4a` (fp32 default); the WARN line
  `q8_1 activation scale: ...` in stderr records which arm ran.
- Not claimed: any on-device number. If the fp32 arm reproduces the fp16 arm's 57x
  divergence, the flush is eliminated as the suspect and the remaining error is in the
  main kernel's arithmetic or in the 32-vs-256 grid (items 3.1); if divergence collapses
  at dp4a speed, the fast kernel runs at the accurate kernel's quality and the 9.9%
  prefill penalty is recoverable without the f32 route.
