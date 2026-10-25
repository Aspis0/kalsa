# REPORT - weight-fp16: half->float weight-side dequant ablation for the dense
# q4_K kernels (KALSA_WQ_PREC)

Status: IN PROGRESS - incremental report, written as the work happens. Nothing
pushed, no upstream contact, NO device/adb contact (this cell is host-side only:
one engine change, one Android binary). The phone arms belong to a later session.

## 1. PRE-REGISTRATION (written 2026-09-23 15:11 EDT, BEFORE any code edit)

Ordered task: R3 of `../quant-alignment/REPORT.md:248` - the weight-side fp16
lead, the surviving batch-common candidate after the K-split refutation today
(serial 0.006983 vs split 0.006890, pair stopped, `../s23-kld-740-q4-0/REPORT.md`
section 41). Recon: `../gpu-next/RECON.md` section 2.

**Hypothesis.** The batch-common q4_K residual is carried (in whole or part) by
weight-side fp16 rounding inside the q4_K kernels that run at BOTH batch shapes:

- b256: `gemm_noshuffle_q4_k_f32.cl:63` `half4 dequantized_weights;` in
  `kernel_gemm_noshuffle_q4_k_f32` - every weight is dequantised through half
  (sub-scale `half4 scale/mval` at `:88-89`, rounded from a float product;
  dequant product stored to half at `:98-141`), then widened to float for the
  product. The CPU reference keeps `d * sv` and the dequant in float.
- b1: the GEMV `d*sv` half sub-scale in `gemv_noshuffle_q4_k_f32.cl`:
  `regS/regM = convert_half2(convert_float2(d) * convert_float2(sv))` at
  `:284-285` (main GEMV), `:434-435` (fused GLU variant, inside the
  `Q4K_GLU_LOOP` macro), `:545-546` (split-K variant). All three are live decode
  dispatch variants; the long-vocab lm_head variants (`_tiled`, `_o4`, gated
  `ne[1] >= 32768`) and the MTP-batch `_mc3` (`:724-725`, ne1==3 only) are NOT
  in the registered arms and stay fp16 this round.

**Change under test.** One env selector, `KALSA_WQ_PREC`, house pattern
`KALSA_GEMM_PREC` (`7ef9389bc`) / `KALSA_COK_ACC`: unset = today's fp16 weight
side, byte-identical default; `fp32` = `-DKALSA_WQ_FP32` flips exactly the sites
above to float (GEMM: `float4 dequantized_weights/scale/mval`, scale loads kept
`half4` and converted, sub-scale product unrounded; GEMV: `regS/regM` float2,
sub-scale product unrounded). Scoped to q4_K ONLY: q6_K
(`gemm_noshuffle_q6_k_f32.cl:43`), q5_K (`:57`), and every other q4_K kernel
(`_r1`, `_kimg`, `_cok`, `_mc3`, `_tiled`, `_o4`) stay untouched this round -
that limitation is recorded here as a scope decision, not an accident. Dispatch,
launch geometry, buffer sizes: untouched.

**Arms (one binary, two shapes):**

- CONTROL: `KALSA_WQ_PREC` unset (shipping default) - must reproduce its anchor
  EXACTLY or the pair is VOID (no rerun, the harness is digit-for-digit
  reproducible, `../cok-residual/REPORT.md:94-96`):
  - b1: median KLD **0.006012** (anchor, ship default, s23 section 37b)
  - b256: median KLD **0.005412** (anchor, ship default)
- TREATMENT: `KALSA_WQ_PREC=fp32`, same binary, same shape:
  - b1 arm, reference `cpu-q4km-b1.kld`
  - b256 arm, reference `cpu-q4km.kld`

**Decision rule (pre-registered at `../quant-alignment/REPORT.md:248`, quoted):**
"\<= -0.0015" movement at BOTH shapes confirms the common weight-side term;
movement \< 0.0005 at both (i.e. `< -0.0005` fails) drops it permanently.
Numerically:

- CONFIRM: treatment KLD <= 0.004512 at b1 AND <= 0.003912 at b256
  (anchor - 0.0015 at each shape).
- DROP: treatment KLD > 0.005512 at b1 AND > 0.004912 at b256
  (moved less than 0.0005 at both shapes).
- Between the two bands at either shape: inconclusive - report, no landing
  decision from this pair alone.

**Void conditions.** Control does not reproduce its anchor digit-for-digit at
displayed precision; any build/preflight gate failure on the device; the load
line not printing `q4_K weight dequant: fp32 (KALSA_WQ_PREC)` on the treatment
or `fp16` on the control.

**Cost side (not run by this cell).** Register pressure in the b256 GEMM grows
(float4 dequant registers); pp256 and decode speed must be re-benched before any
landing. The dp4a q6_K route (76.4 t/s) is not touched by this change.

### 1a. Wording correction (post-audit, before any device run, 2026-09-23)

Luna's audit (`AUDIT.md:26`, verdict FIX-FIRST) refuted the section-1
decision-rule quotation. Section 1 above stays untouched as pre-registered; this
subsection is the correction of record. No threshold number moves, so the STOP
condition in the ordered fix did not trigger.

**(i) Decision-rule quotation.** R3 verbatim
(`../quant-alignment/REPORT.md:248`, last table cell):

> ">= -0.0015 at both b1 and b256 would confirm the common weight-side term (and
> it is the ONLY candidate that moves b1 without adding a quantiser);
> < -0.0005 at both -> drop it permanently"

The wrong sentence in section 1 is the line beginning "**Decision rule
(pre-registered at ... quoted):**" (`REPORT.md:53-55`): it printed
`"\<= -0.0015"` where R3 says `>= -0.0015` while claiming to be a quotation,
and its parenthetical "(i.e. `< -0.0005` fails)" contradicted section 1's own
numeric DROP line (treatment > anchor - 0.0005 at both). Read literally against
the signed delta `treatment - control` (negative = KLD falls), R3's two clauses
are incoherent: zero movement would "confirm", a fall of 0.002 would "drop",
and delta = -0.001 satisfies both. The coherent reading - consistent with R3's
column header "expected KLD movement" and with the bands already registered -
is the magnitude of the fall: **a fall >= 0.0015 at BOTH shapes confirms; a
fall < 0.0005 at BOTH drops it permanently.** The numeric bands in section 1
are exactly that reading, are unchanged, and remain the single authoritative
rule: CONFIRM treatment KLD <= 0.004512 at b1 AND <= 0.003912 at b256; DROP
treatment KLD > 0.005512 at b1 AND > 0.004912 at b256. The DROP bands are
strict: drop means b1 > 0.005512 AND b256 > 0.004912, and equality with either
band edge is inconclusive (added in the 2026-09-23 re-audit fix; no number
changed).

**(ii) Default-coverage wording.** The section-1 sentence "All three are live
decode dispatch variants" (`REPORT.md:26`) overstates. On the S23 the Adreno 740
maps to `ADRENO_GPU_GEN::A7X` (`ggml-opencl.cpp:300-304`) and split-K dispatch
defaults only on `X2E` (`:22693-22702`); the submitted commands set no split-K
env. So the b1 arm exercises the main-GEMV site (`:284-285`) and the fused-GLU
site (`:434-435`); the split-K site (`:545-546`) is compiled and flipped by the
selector but NOT dispatched on this phone by default. b256 exercises the GEMM
`:63` site. The split-K site becomes live only if a future arm forces
`GGML_OPENCL_Q4K_GEMV_SPLITK=1` - out of this pair's scope.

## 2. The change (commit c8161f64a, branch kalsa-opencl-wq-fp32)

- Branch created off **`319b539377605f6c572e234b28678b74bd78deb5`** in a NEW worktree
  `/Users/marco/Projects/kalsallama-wt-wq` (the shared checkout `/Users/marco/Projects/kalsallama`
  is on `main` with 12 dirty lines of other agents - snapshotted before
  `/tmp/wq-fp16/shared-status-before.txt` and after
  `/tmp/wq-fp16/shared-status-after.txt`: byte-identical, shared checkout untouched).
- Commit: **`c8161f64adc47ba1deb9501f30735d497259af90`** (short `c8161f64a`), exactly one commit
  above 319b53937, message "opencl: KALSA_WQ_PREC=fp32 ablates fp16 q4_K weight dequant
  (default unchanged)" + body naming repo kalsallama, branch kalsa-opencl-wq-fp32, HEAD/base
  319b53937. `git branch --show-current` printed before the commit. NOT pushed; no tag;
  `git rev-parse @{upstream}` for this branch = fatal (no upstream). `git rev-list --count HEAD`
  = **11203**. Worktree clean after (`git status --porcelain` = 0 lines).
- Diff: 3 files, **+79 / -3**, ASCII-clean (`git diff | perl -ne 'print if /[^\x00-\x7F]/'` = 0
  lines). No new file; no existing file's responsibility changed.

| file | change |
|---|---|
| `ggml-opencl.cpp:1602-1620` | new `kalsa_wq_fp32()` beside `kalsa_cok_acc_f32()` (same lambda-getenv shape; `KALSA_WQ_PREC` unset/empty = false, `fp32` = true, any other value = ERROR `unrecognized KALSA_WQ_PREC='%s' (unset\|fp32)` + exit 1) |
| `ggml-opencl.cpp:4502-4512` | q4_K GEMM build site: `-DKALSA_WQ_FP32` appended to `cok_opts` when set; the existing WARN now also prints `q4_K weight dequant: %s (KALSA_WQ_PREC)` |
| `ggml-opencl.cpp:4644-4651` | q4_K GEMV build site: same define appended to `CL_gemv_compile_opts` + its own WARN `q4_K GEMV weight sub-scale: %s (KALSA_WQ_PREC)` (WARN so the arm survives the bench stderr filter, the KALSA_Q8A_SCALE precedent) |
| `kernels/gemm_noshuffle_q4_k_f32.cl:63-68,93-98` | `kernel_gemm_noshuffle_q4_k_f32` (the b256 kernel) only: `#ifdef KALSA_WQ_FP32` selects `float4 dequantized_weights` and `float4 scale/mval` (the float sub-scale product kept unrounded); `#else` = the verbatim `half4` lines. The `half4 d/dm` loads stay (fp16->fp32 conversion is exact); the j-loop dequant lines and the `(float)` products are textually unchanged - with `float4 scale` they execute in float |
| `kernels/gemv_noshuffle_q4_k_f32.cl:34-44` | `WQ_SUBSCALE(d,s0,s1)` macro selected by `#ifdef` OUTSIDE any macro body (required: `#ifdef` cannot appear inside the `Q4K_GLU_LOOP` macro); the fp16 branch expands to the exact original `convert_half2(...)` text |
| `kernels/gemv_noshuffle_q4_k_f32.cl:275-281,300-305` | main GEMV: `regS/regM` `float2` vs `half2` decl block + sub-scale `#ifdef` block |
| `kernels/gemv_noshuffle_q4_k_f32.cl:431-436,459-460` | fused-GLU GEMV: same decl block; the macro body's two lines become `WQ_SUBSCALE` calls |
| `kernels/gemv_noshuffle_q4_k_f32.cl:554-558,573-578` | split-K GEMV: same two blocks |

**Scope written down (as ordered).** q4_K ONLY. q6_K (`gemm_noshuffle_q6_k_f32.cl:43`) and
q5_K (`:57`) untouched. Within q4_K, untouched this round: `_r1`, `_kimg`, `_cok` (has its own
KALSA_COK_ACC selector), the MTP-batch `_mc3` (`:735-736` at the new file - executes only at
ne1==3, not in the registered arms), the long-vocab lm_head `_tiled`/`_o4` (dispatch-gated
`ne[1] >= 32768`), and the q4_K dp4a file. The three flipped GEMV variants are the live decode
dispatch paths (main / fused GLU / split-K, `ggml-opencl.cpp:22725-22728`); the main GEMM kernel
is the b256 dense path on the phone. Dispatch, launch geometry, buffer sizes: untouched.

**Cache key.** The selector is part of the program cache key by construction:
`build_program_from_source` (`ggml-opencl.cpp:1437-1440,1453`) passes `compile_opts` into
`cl_program_cache_try_load/try_save`, and the key is sha256 over `compile_opts` among other
fields (`cl-program-cache.h:18-25`). The define is appended to that string at both build sites.

Selector truth table (functions awk-extracted from the file bytes, `clang++ -std=c++17`, fresh
process per value; `/tmp/wq-fp16/sel/truth-table.txt`, harness exit 0):

| KALSA_WQ_PREC | rc | result |
|---|---|---|
| unset / empty | 0 | false = fp16 weight side, the DEFAULT |
| `fp32` | 0 | true = treatment |
| `fp16` / `FP32` / `bogus` / `0` / `1` | 1 | `unrecognized KALSA_WQ_PREC=...`, exit 1 |

## 3. Gates (NDK clang 21, full argv in /tmp/wq-fp16/gates/commands.txt)

Compile line (both passes, 20 invocations total, all rc=0, all logs 0 bytes - no warnings):
`cd <srcdir> && /opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang
-x cl -cl-std=CL3.0 -Xclang -finclude-default-header -target spirv64 -O2 -S -emit-llvm [defines]
-o ... <file>` plus the same line with `-fsyntax-only`. Sources: 319b =
`git show 319b53937:...`, new = commit c8161f64a, bare-filename invocation in per-source dirs
(the cok-residual ModuleID lesson). Source sha256: 319b gemm `0d8dc8c12...` (matches the
cok-residual/cok-accumulator audit chain), 319b gemv `51d355562a...`, new gemm
`8338c6798c...`, new gemv `857b7b569f...`.

Identity gates (`cmp -s`, rc values as run):

| comparison | rc | meaning |
|---|---|---|
| new gemm, unset vs 319b gemm | **0** | default = 319b53937's kernel exactly |
| new gemm, `-DKALSA_COK_ACC_F16` vs 319b + same | **0** | the other selector's control arm is unchanged |
| new gemv, unset vs 319b gemv | **0** | default = 319b53937's kernel exactly |
| new gemv, unset + `-DVECTOR_SUB_GROUP_BROADCAST` vs 319b + same | **0** | identity holds under the phone's vector-broadcast build too |
| new gemm + `-DKALSA_WQ_FP32` vs new unset | **1** | treatment differs (census below) |
| new gemv + `-DKALSA_WQ_FP32` vs new unset | **1** | treatment differs (census below) |

Preprocessed-source gate (secondary, `-E -P`, same clang): **both files, selector unset vs 319b,
cmp rc=0** - the preprocessed kernel source is byte-identical, not just the IR.

Treatment census (every diff hunk mapped to its enclosing define; script output in gates dir):

- gemm (42 hunks, 646 diff lines): 41 hunks inside `kernel_gemm_noshuffle_q4_k_f32`; 1 hunk =
  the module-scope `declare half @llvm.fmuladd.f16` relocating (first-use order; declare count
  stays 1). Per-kernel fmuladd.f16 use counts unset -> fp32: main 16 -> **0** (the intended
  removal), `_r1` 4 -> 4, `_kimg` 8 -> 8, `_cok` 4 -> 4. `_r1`/`_kimg`/`_cok` bodies: 0 hunks.
- gemv (94 hunks, 3398 diff lines): 25 in `kernel_gemv_noshuffle_q4_k_f32`, 48 in `_glu`, 18 in
  `_splitk` (the three intended kernels); 3 hunks are module-tail declare relocations
  (`convert_half2` position, `fmuladd.v2f16`/`fmuladd.v2f32` swap - declare counts 1/1/1 in both
  builds). `_mc3` intrinsic-use count 130 -> 130, body 0 hunks; `kernel_gemv_splitk_reduce_f32`
  0 hunks.

## 4. Android build (llama-perplexity)

- Load checks (owner rule, separate `pgrep -fl` per pattern): before configure+build, no
  ninja/ld.lld/clang/gradle/cmake running; load **2.24 / 2.91 / 2.69** (a transient 1-min spike
  to 5.61 was traced to a single 1-core `grep` of another process - waited 45 s, decayed to
  **3.62 / 3.47 / 2.95** before starting; 10-core host). Configure single-threaded, build
  `ninja -j 3` exactly, one heavy build at a time.
- Configure: **EXIT=0** (`/tmp/wq-fp16/android-configure.log`), recipe = phone-engine-v2
  section 5 line by line, own build dir **`build-android-ocl-wq-fp32`**: summary `-- Including
  CPU backend`, `-- Including OpenCL backend`, **`-- ggml commit:  c8161f64a`**; 0 error lines;
  cache verified `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`, both OpenCL paths set.
- Build: `ninja -C build-android-ocl-wq-fp32 -j 3 > /tmp/wq-fp16/android-build.log 2>&1` ->
  **EXIT=0, 651/651 steps** (~3-4 min; binary mtime 15:22 EDT). The single `error` grep hit is
  the known configure-time UI-download message (`b11203 ... HTTP response code said error`), 0
  FAILED. The log shows `[142/651] Generate .../autogenerated/gemv_noshuffle_q4_k_f32.cl.h`,
  `[143/651] ...gemm_noshuffle_q4_k_f32.cl.h` (embed picked up both edited kernels; the
  generated headers contain the `KALSA_WQ_FP32` lines) and `[226/651] ... ggml-opencl.cpp.o`
  (host-side compile gate), `[636/651] Linking CXX executable bin/llama-perplexity`.
- Embedded build info (`build-android-ocl-wq-fp32/common/build-info.cpp`):
  `LLAMA_BUILD_NUMBER = 11203` (== `git rev-list --count HEAD`), `LLAMA_COMMIT = "c8161f64a"`,
  `LLAMA_BUILD_TARGET = "Android aarch64"`. `strings -a` exact-match counts in the ELF:
  `c8161f64a` = 1, `319b53937` = 0, `unrecognized KALSA_WQ_PREC` = 1,
  `q4_K weight dequant` = 1, `q4_K GEMV weight sub-scale` = 1.
- **sha256 of the binary (path
  `/Users/marco/Projects/kalsallama-wt-wq/build-android-ocl-wq-fp32/bin/llama-perplexity`):**

```
53bcb31e11ea2f67c711f73979174a4dd6d9fbca00c0b84f8aada6239ea23279  build-android-ocl-wq-fp32/bin/llama-perplexity
```

  size 119,663,968 bytes; `file`: ELF 64-bit LSB pie executable, ARM aarch64, interpreter
  /system/bin/linker64, BuildID[sha1] 91292ec711abf40d6b1643e4e328820f9d8dac87 (not runnable on
  this Mac - all evidence read from the artifacts).

**Device commands the phone arms will need** (same binary, four arms; run them through this
cell's own wrapper `raw/run-scripts/wq-fp16-arm-device.sh` - added post-audit, section 6 - which
applies the standing preflight gates (battery not charging, thermal status 0 and <= 34.0 C,
artifact presence, on-device sha256 = `53bcb31e...`), pins `adb -s` to the S23 serial, writes the
battery/thermal/wakefulness bracket, and refuses any arm name outside the four registered ones.
The commands it wraps are these; `DEV`, `MODEL`, `CORPUS`, `LIB` as in the s23 cell's scripts;
BIN = the pushed binary. Control anchors from
section 1 must reproduce EXACTLY or the pair is VOID):

```sh
# b256 CONTROL - must reproduce 0.005412 exactly
env -u KALSA_WQ_PREC -u KALSA_COK_ACC -u KALSA_COK_KORDER LD_LIBRARY_PATH="$LIB" TMPDIR="$DEV" \
  "$BIN" -m "$MODEL" -f "$CORPUS" -c 256 -b 256 -ngl 99 -fa off -s 42 --temp 0 \
  --kl-divergence --kl-divergence-base "$DEV/cpu-q4km.kld"

# b256 TREATMENT - confirm if <= 0.003912, drop if > 0.004912 (section 1)
env -u KALSA_COK_ACC -u KALSA_COK_KORDER KALSA_WQ_PREC=fp32 LD_LIBRARY_PATH="$LIB" TMPDIR="$DEV" \
  "$BIN" -m "$MODEL" -f "$CORPUS" -c 256 -b 256 -ngl 99 -fa off -s 42 --temp 0 \
  --kl-divergence --kl-divergence-base "$DEV/cpu-q4km.kld"

# b1 CONTROL - must reproduce 0.006012 exactly
env -u KALSA_WQ_PREC -u KALSA_COK_ACC -u KALSA_COK_KORDER LD_LIBRARY_PATH="$LIB" TMPDIR="$DEV" \
  "$BIN" -m "$MODEL" -f "$CORPUS" -c 256 -b 1 -ngl 99 -fa off -s 42 --temp 0 \
  --kl-divergence --kl-divergence-base "$DEV/cpu-q4km-b1.kld"

# b1 TREATMENT - confirm if <= 0.004512, drop if > 0.005512 (section 1)
env -u KALSA_COK_ACC -u KALSA_COK_KORDER KALSA_WQ_PREC=fp32 LD_LIBRARY_PATH="$LIB" TMPDIR="$DEV" \
  "$BIN" -m "$MODEL" -f "$CORPUS" -c 256 -b 1 -ngl 99 -fa off -s 42 --temp 0 \
  --kl-divergence --kl-divergence-base "$DEV/cpu-q4km-b1.kld"
```

Each arm's log must show `version: ... commit c8161f64a` at load and
`ggml_opencl: q4_K small-batch accumulator: fp32 (KALSA_COK_ACC), q4_K weight dequant:
<fp16|fp32> (KALSA_WQ_PREC)` + `ggml_opencl: q4_K GEMV weight sub-scale: <fp16|fp32>
(KALSA_WQ_PREC)` - wrong value or missing line = VOID (section 1). Run pairs control-first; the
b256 pair gates the b1 pair.

## 5. Boundaries and what was NOT verified

- No device/adb contact; the binary was never executed (ARM aarch64, host is darwin-arm64).
  Every runtime claim above is read from artifacts (build-info.cpp, strings, ELF headers).
- The cache-key statement is a code-read proof (`cl-program-cache.h:18-25`), not a captured
  on-device cache-identity run; the phone session should still capture the cache-key/identity
  trace as its standing discipline.
- IR gates cover the spirv64/clang-21 compile of this host; the Qualcomm online compiler is not
  gated here (never is) - the control arms reproducing their anchors is the on-device gate.
- Speed cost (float4 dequant registers in the b256 GEMM; pp256 + decode) unmeasured; a landing
  decision needs the speed pair (R3's own rule, `quant-alignment/REPORT.md:248`).
- Nothing pushed (push disabled without an explicit order; upstream DISABLED, never touched),
  no tag, no fetch. Worktree clean at c8161f64a. /tmp artifacts: /tmp/wq-fp16/
  {android-configure.log, android-build.log, gates/, sel/, shared-status-*.txt}.

## 6. Post-audit fixes (2026-09-23, luna FIX-FIRST round)

Engine tree untouched this round (the audit confirmed the code: default identity,
fp32 arithmetic, cache key); no commit was needed, none made. Two fixes delivered:

1. **Decision-rule wording** -> `### 1a` above: R3 quoted verbatim
   (`>= -0.0015 ... confirm ... < -0.0005 ... drop`), the wrong section-1 sentence
   named (the `"\<= -0.0015"` misquote + the `(i.e. '< -0.0005' fails)` parenthetical
   that contradicted the registered DROP band), and the default-coverage sentence
   corrected (b1 exercises main-GEMV + fused-GLU sites; split-K compiled-and-flipped
   but not dispatched on A7X default). **No threshold number moved** (CONFIRM
   0.004512/0.003912, DROP 0.005512/0.004912 unchanged) - the STOP condition did
   not trigger.
2. **Four-arm device wrapper** `raw/run-scripts/wq-fp16-arm-device.sh` (143 lines,
   host-side, mirroring the s23 cell's `raw/run-scripts/` layout; the cited
   `kld-k-split-arm-device.sh` is b8/ksplit-only and stays untouched in its own
   cell). One responsibility: run ONE pre-registered arm behind the gates. Per arm
   it: refuses pre-existing output files (73); reads battery/thermalservice/power
   (sensor error 63); battery floor 22 (99); charging = AC/USB/wireless (98);
   thermal >= 3 or >= 44.0 C (97); cool-down gate thermal != 0 or > 34.0 C (95);
   artifact presence (66); **sha256 of the binary verified ON the device** against
   `53bcb31e...` (65); writes the START bracket (epoch, battery level, AC/USB
   powered, temperature tenths, thermal status, mWakefulness); runs the arm
   (b1->`cpu-q4km-b1.kld`, b256->`cpu-q4km.kld`, control = `env -u KALSA_WQ_PREC`,
   treatment = `KALSA_WQ_PREC=fp32`, both with `KALSA_COK_ACC`/`KALSA_COK_KORDER`
   unset); appends REMOTE_RC plus the `version:`/`KALSA_WQ_PREC` evidence lines to
   the bracket; pulls status/log/err into `raw/runs/`. **Every adb call is
   `adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`** - the Jelly Star is
   unreachable from this script.

Checks run (nothing executed on any device):

| command | exit |
|---|---|
| `bash -n wq-fp16-arm-device.sh` | **0** |
| `--dry-run b1-control` / `b1-treatment` / `b256-control` / `b256-treatment` | **0** each; serial pinned in all 11 adb lines per arm, sha gate present, env/batch/ref correct per arm (e.g. treatment prints `KALSA_WQ_PREC=fp32`, b1 prints `-b 1` + `cpu-q4km-b1.kld`) |
| `--dry-run b8-control` (unknown arm) | **64** `UNKNOWN_ARM 'b8-control' (...)` |
| `--dry-run b256-control extra` (second positional) | **64** `USAGE: ... [--dry-run] <arm>` |
| (no args) | **64** `UNKNOWN_ARM '' (...)` |

Dry-run logs: `/tmp/wq-fp16/dry-*.log` (11 `DRY-RUN +` command lines each; `go()`
prints instead of executing, so no adb command ran).

**Not verified this round:** the live gates (battery/thermal/sha/refuse/pull) are
code-read + dry-run verified only - no device run was performed, per order. The
remote-rc propagation relies on platform-tools 37.0.1 returning the remote exit
status (and the arm's own rc is additionally recorded as `REMOTE_RC=` in the
status file regardless).

### 6a. Re-audit fix (2026-09-23)

1. **Evidence gate** (`wq-fp16-arm-device.sh`, new `evidence_rc()` + the
   post-pull check; script now 173 lines): the greppped-in status lines are no
   longer decoration - after the pull, `evidence_rc` verifies on the PULLED
   files that (a) the `commit c8161f64a` version line is present and (b) exactly
   ONE selector flavor appears and it matches the arm: treatment = `fp32
   (KALSA_WQ_PREC)`, control = `fp16 (KALSA_WQ_PREC)`. Any failure exits **60**
   with `EVIDENCE_GATE_FAIL ...` naming the reason (version missing / selector
   missing or both flavors / flavor does not match arm). Design note: the re-audit
   asked for "no selector line" on control - the host prints the selector WARN
   unconditionally (that is why the WARN exists, `ggml-opencl.cpp:4647-4648`),
   so the gate checks the FLAVOR, which is also the section-1 void rule (control
   must print `fp16`). Checks, no device: `bash -n` EXIT=0; fixture-log runs of
   the awk-extracted `evidence_rc` (`/tmp/wq-fp16/fixture/results.txt`):
   treatment-ok 0, control-ok 0, no-version 1, no-selector 2,
   control-sees-fp32 3, mixed-flavors 2 - all as wanted; `--dry-run` of all four
   arms EXIT=0, no syntax errors, gate line prints the arm's expected flavor.
2. **1a strictness sentence** appended: DROP bands strict, equality with either
   band edge inconclusive; no number changed.

### b1-control attempt 1 — INVALID (thermal stop)

- Prediction/anchor: b1-control median KLD exactly **0.006012**; any other completed displayed value voids the pair. No completed KLD number.
- The single audited wrapper `raw/run-scripts/wq-fp16-arm-device.sh` was updated only for the coordinator's current device gates: battery floor 25%, low_power=0, Awake + Kalsa foreground, and stop at thermal status ≥3 or battery temperature ≥44.0 °C; the prior ≤34.0 °C gate is superseded. Binary SHA verified on device: `53bcb31e11ea2f67c711f73979174a4dd6d9fbca00c0b84f8aada6239ea23279`.
- Start 2026-09-24T04:02:43Z: unplugged, 71%, 40.1 °C, thermal 2, low_power 0, Awake, `com.kalsa.app/.MainActivity` resumed. The run reached only chunks 1–2/14. The watchdog read thermal 3 at 42.5 °C; the arm was interrupted. End 04:04:55Z: unplugged, 70%, 42.7 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID; no KLD result.** Background `adsprpcd` was about 93–100% in brackets/watchdog.
- Raw files: `raw/b1-control-start-attested-bracket.txt`, `raw/b1-control-end-attested-bracket.txt`, `raw/runs/b1-control-aborted.status`, `raw/runs/b1-control-aborted.log`, `raw/runs/b1-control-aborted.err`, `raw/stage-device-binary.log`, `raw/run-scripts/wq-fp16-arm-device.sh`, `raw/run-scripts/wq-fp16-bracket.sh`, `../governor-nofit/raw/A-b1-control-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 24 00:02 raw/b1-control-start-attested-bracket.txt
      34 raw/b1-control-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1482 Sep 24 00:04 raw/b1-control-end-attested-bracket.txt
      34 raw/b1-control-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  306 Sep 24 00:05 raw/runs/b1-control-aborted.status
       2 raw/runs/b1-control-aborted.status
-rw-r--r--  1 marco  staff  399 Sep 24 00:05 raw/runs/b1-control-aborted.log
       5 raw/runs/b1-control-aborted.log
-rw-r--r--  1 marco  staff  509 Sep 24 00:05 raw/runs/b1-control-aborted.err
       5 raw/runs/b1-control-aborted.err
-rw-r--r--  1 marco  staff  686 Sep 24 00:02 raw/stage-device-binary.log
      10 raw/stage-device-binary.log
-rwxr-xr-x  1 marco  staff  9503 Sep 24 00:01 raw/run-scripts/wq-fp16-arm-device.sh
     180 raw/run-scripts/wq-fp16-arm-device.sh
-rwxr-xr-x  1 marco  staff  1138 Sep 24 00:02 raw/run-scripts/wq-fp16-bracket.sh
      12 raw/run-scripts/wq-fp16-bracket.sh
-rw-r--r--  1 marco  staff  552 Sep 24 00:04 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-control-watchdog.log
       6 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-control-watchdog.log

### b1-control retry 1 — INVALID; b1-control arm VOID after second thermal stop

- Prediction/anchor: b1-control median KLD **0.006012** exact. No completed KLD number.
- Start 2026-09-24T04:08:32Z: unplugged, 69%, 40.3 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–6/14. Watchdog reached thermal status 3 at 42.8 °C. End 04:12:21Z: unplugged, 67%, 42.9 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID**. The same b1-control arm has now hit status 3 twice; mark it **VOID** and move on. Its control anchor was never measured, so b1 pair cannot resolve the hypothesis.
- Raw files: `raw/b1-control-retry1-start-attested-bracket.txt`, `raw/b1-control-retry1-end-attested-bracket.txt`, `raw/runs/b1-control-retry1-aborted.status`, `raw/runs/b1-control-retry1-aborted.log`, `raw/runs/b1-control-retry1-aborted.err`, `../governor-nofit/raw/A-b1-control-retry1-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1470 Sep 24 00:08 raw/b1-control-retry1-start-attested-bracket.txt
      34 raw/b1-control-retry1-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 24 00:12 raw/b1-control-retry1-end-attested-bracket.txt
      34 raw/b1-control-retry1-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  306 Sep 24 00:12 raw/runs/b1-control-retry1-aborted.status
       2 raw/runs/b1-control-retry1-aborted.status
-rw-r--r--  1 marco  staff  923 Sep 24 00:12 raw/runs/b1-control-retry1-aborted.log
       9 raw/runs/b1-control-retry1-aborted.log
-rw-r--r--  1 marco  staff  509 Sep 24 00:12 raw/runs/b1-control-retry1-aborted.err
       5 raw/runs/b1-control-retry1-aborted.err
-rw-r--r--  1 marco  staff  1104 Sep 24 00:12 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-control-retry1-watchdog.log
      12 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-control-retry1-watchdog.log

### b1-treatment attempt 1 — INVALID (thermal stop)

- Prediction: fp32 treatment median KLD ≤0.004512 confirms at b1; no completed KLD number.
- Start 2026-09-24T04:15:02Z: unplugged, 66%, 40.9 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–2/14. Watchdog read thermal status 3 at 42.7 °C. End 04:16:31Z: unplugged, 65%, 42.9 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID; no KLD result.** b1-control is already VOID, so the b1 pair cannot resolve the hypothesis.
- Raw files: `raw/b1-treatment-start-attested-bracket.txt`, `raw/b1-treatment-end-attested-bracket.txt`, `raw/runs/b1-treatment-aborted.status`, `raw/runs/b1-treatment-aborted.log`, `raw/runs/b1-treatment-aborted.err`, `../governor-nofit/raw/A-b1-treatment-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 24 00:15 raw/b1-treatment-start-attested-bracket.txt
      34 raw/b1-treatment-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 24 00:16 raw/b1-treatment-end-attested-bracket.txt
      34 raw/b1-treatment-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  308 Sep 24 00:16 raw/runs/b1-treatment-aborted.status
       2 raw/runs/b1-treatment-aborted.status
-rw-r--r--  1 marco  staff  399 Sep 24 00:16 raw/runs/b1-treatment-aborted.log
       5 raw/runs/b1-treatment-aborted.log
-rw-r--r--  1 marco  staff  509 Sep 24 00:16 raw/runs/b1-treatment-aborted.err
       5 raw/runs/b1-treatment-aborted.err
-rw-r--r--  1 marco  staff  460 Sep 24 00:16 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-treatment-watchdog.log
       5 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-treatment-watchdog.log

### b1-treatment retry 1 — INVALID; treatment arm VOID after second thermal stop

- Prediction: fp32 b1 treatment median KLD ≤0.004512 confirms; no completed KLD number.
- Start 2026-09-24T04:20:05Z: unplugged, 65%, 40.7 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–3/14. Watchdog read thermal status 3 at 42.8 °C. End 04:22:15Z: unplugged, 63%, 42.7 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID**. This treatment arm also hit thermal status 3 twice; mark **VOID**. The b1 control/treatment pair is VOID.
- Raw files: `raw/b1-treatment-retry1-start-attested-bracket.txt`, `raw/b1-treatment-retry1-end-attested-bracket.txt`, `raw/runs/b1-treatment-retry1-aborted.status`, `raw/runs/b1-treatment-retry1-aborted.log`, `raw/runs/b1-treatment-retry1-aborted.err`, `../governor-nofit/raw/A-b1-treatment-retry1-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1470 Sep 24 00:20 raw/b1-treatment-retry1-start-attested-bracket.txt
      34 raw/b1-treatment-retry1-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1482 Sep 24 00:22 raw/b1-treatment-retry1-end-attested-bracket.txt
      34 raw/b1-treatment-retry1-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  308 Sep 24 00:22 raw/runs/b1-treatment-retry1-aborted.status
       2 raw/runs/b1-treatment-retry1-aborted.status
-rw-r--r--  1 marco  staff  530 Sep 24 00:22 raw/runs/b1-treatment-retry1-aborted.log
       6 raw/runs/b1-treatment-retry1-aborted.log
-rw-r--r--  1 marco  staff  509 Sep 24 00:22 raw/runs/b1-treatment-retry1-aborted.err
       5 raw/runs/b1-treatment-retry1-aborted.err
-rw-r--r--  1 marco  staff  552 Sep 24 00:21 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-treatment-retry1-watchdog.log
       6 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b1-treatment-retry1-watchdog.log

### b256-control attempt 1 — INVALID (thermal stop)

- Prediction/anchor: b256-control median KLD exactly **0.005412**; no completed KLD number.
- Start 2026-09-24T04:24:56Z: unplugged, 62%, 40.8 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–10/14. Watchdog reached thermal status 3 at 42.3 °C. End 04:26:23Z: unplugged, 62%, 43.2 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID; no KLD result.**
- Raw files: `raw/b256-control-start-attested-bracket.txt`, `raw/b256-control-end-attested-bracket.txt`, `raw/runs/b256-control-aborted.status`, `raw/runs/b256-control-aborted.log`, `raw/runs/b256-control-aborted.err`, `../governor-nofit/raw/A-b256-control-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 24 00:24 raw/b256-control-start-attested-bracket.txt
      34 raw/b256-control-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 24 00:26 raw/b256-control-end-attested-bracket.txt
      34 raw/b256-control-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  308 Sep 24 00:26 raw/runs/b256-control-aborted.status
       2 raw/runs/b256-control-aborted.status
-rw-r--r--  1 marco  staff  1447 Sep 24 00:26 raw/runs/b256-control-aborted.log
      13 raw/runs/b256-control-aborted.log
-rw-r--r--  1 marco  staff  510 Sep 24 00:26 raw/runs/b256-control-aborted.err
       5 raw/runs/b256-control-aborted.err
-rw-r--r--  1 marco  staff  460 Sep 24 00:26 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-control-watchdog.log
       5 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-control-watchdog.log

### b256-control retry 1 — INVALID; b256-control arm VOID after second thermal stop

- Prediction/anchor: b256-control median KLD exactly **0.005412**; no completed KLD number.
- Start 2026-09-24T04:30:58Z: unplugged, 60%, 40.7 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–12/14. Watchdog reached thermal status 3 at 43.1 °C. End 04:32:34Z: unplugged, 59%, 43.1 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID**. This b256-control arm has now hit status 3 twice; mark it **VOID** and move on. Its control anchor was never measured, so the b256 pair cannot resolve the hypothesis.
- Raw files: `raw/b256-control-retry1-start-attested-bracket.txt`, `raw/b256-control-retry1-end-attested-bracket.txt`, `raw/runs/b256-control-retry1-aborted.status`, `raw/runs/b256-control-retry1-aborted.log`, `raw/runs/b256-control-retry1-aborted.err`, `../governor-nofit/raw/A-b256-control-retry1-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 24 00:30 raw/b256-control-retry1-start-attested-bracket.txt
      34 raw/b256-control-retry1-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 24 00:32 raw/b256-control-retry1-end-attested-bracket.txt
      34 raw/b256-control-retry1-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  308 Sep 24 00:32 raw/runs/b256-control-retry1-aborted.status
       2 raw/runs/b256-control-retry1-aborted.status
-rw-r--r--  1 marco  staff  1709 Sep 24 00:32 raw/runs/b256-control-retry1-aborted.log
      15 raw/runs/b256-control-retry1-aborted.log
-rw-r--r--  1 marco  staff  510 Sep 24 00:32 raw/runs/b256-control-retry1-aborted.err
       5 raw/runs/b256-control-retry1-aborted.err
-rw-r--r--  1 marco  staff  460 Sep 24 00:32 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-control-retry1-watchdog.log
       5 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-control-retry1-watchdog.log

### b256-treatment attempt 1 — INVALID (thermal stop)

- Prediction: fp32 b256 treatment median KLD ≤0.003912 confirms; no completed KLD number.
- Start 2026-09-24T04:37:29Z: unplugged, 58%, 40.6 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–12/14. Watchdog reached thermal status 3 at 43.1 °C. End 04:39:06Z: unplugged, 57%, 43.1 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID; no KLD result.** b256-control is already VOID, so the b256 pair cannot resolve the hypothesis.
- Raw files: `raw/b256-treatment-start-attested-bracket.txt`, `raw/b256-treatment-end-attested-bracket.txt`, `raw/runs/b256-treatment-aborted.status`, `raw/runs/b256-treatment-aborted.log`, `raw/runs/b256-treatment-aborted.err`, `../governor-nofit/raw/A-b256-treatment-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 24 00:37 raw/b256-treatment-start-attested-bracket.txt
      34 raw/b256-treatment-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 24 00:39 raw/b256-treatment-end-attested-bracket.txt
      34 raw/b256-treatment-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  310 Sep 24 00:39 raw/runs/b256-treatment-aborted.status
       2 raw/runs/b256-treatment-aborted.status
-rw-r--r--  1 marco  staff  1709 Sep 24 00:39 raw/runs/b256-treatment-aborted.log
      15 raw/runs/b256-treatment-aborted.log
-rw-r--r--  1 marco  staff  510 Sep 24 00:39 raw/runs/b256-treatment-aborted.err
       5 raw/runs/b256-treatment-aborted.err
-rw-r--r--  1 marco  staff  460 Sep 24 00:38 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-treatment-watchdog.log
       5 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-treatment-watchdog.log

### b256-treatment retry 1 — INVALID; treatment arm VOID after second thermal stop

- Prediction: fp32 b256 treatment median KLD ≤0.003912 confirms; no completed KLD number.
- Start 2026-09-24T04:43:55Z: unplugged, 55%, 40.6 °C, thermal 2, low_power 0, Awake, Kalsa resumed. The run reached only chunks 1–11/14. Watchdog reached thermal status 3 at 42.6 °C. End 04:45:31Z: unplugged, 54%, 43.3 °C, thermal 3, low_power 0, Awake, Kalsa resumed. **INVALID**. This b256-treatment arm has now hit status 3 twice; mark **VOID** and move on. The b256 control/treatment pair is VOID.
- Raw files: `raw/b256-treatment-retry1-start-attested-bracket.txt`, `raw/b256-treatment-retry1-end-attested-bracket.txt`, `raw/runs/b256-treatment-retry1-aborted.status`, `raw/runs/b256-treatment-retry1-aborted.log`, `raw/runs/b256-treatment-retry1-aborted.err`, `../governor-nofit/raw/A-b256-treatment-retry1-watchdog.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1477 Sep 24 00:43 raw/b256-treatment-retry1-start-attested-bracket.txt
      34 raw/b256-treatment-retry1-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1506 Sep 24 00:45 raw/b256-treatment-retry1-end-attested-bracket.txt
      34 raw/b256-treatment-retry1-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  310 Sep 24 00:45 raw/runs/b256-treatment-retry1-aborted.status
       2 raw/runs/b256-treatment-retry1-aborted.status
-rw-r--r--  1 marco  staff  1578 Sep 24 00:45 raw/runs/b256-treatment-retry1-aborted.log
      14 raw/runs/b256-treatment-retry1-aborted.log
-rw-r--r--  1 marco  staff  510 Sep 24 00:45 raw/runs/b256-treatment-retry1-aborted.err
       5 raw/runs/b256-treatment-retry1-aborted.err
-rw-r--r--  1 marco  staff  460 Sep 24 00:45 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-treatment-retry1-watchdog.log
       5 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/A-b256-treatment-retry1-watchdog.log

## RESULT

No registered KLD number was obtained. Both b1 arms and both b256 arms are VOID after their same arm reached thermal status 3 twice before all 14 chunks completed. Predictions remain unchanged: b1 control 0.006012, b256 control 0.005412; b1 treatment confirms at ≤0.004512, b256 treatment confirms at ≤0.003912. No pair verdict can be made.
