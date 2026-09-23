# REPORT - cok-accumulator: f32 accumulator + f32 product for the dense q4_K small-batch (_cok) GEMM

Status: IN PROGRESS - incremental report, written as the work happens. Nothing pushed,
nothing tagged, no upstream contact, no phone/adb contact. The push command appears at the
end of this file marked UNRUN.

## 0. Task and ship line - verified before anything changed

Ordered task: promote the `_cok` accumulator (and operands if the reading says they
contribute) in `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl` to f32, behind a
selector in the `KALSA_Q8A_SCALE` shape but inverted (corrected behaviour = default, old
behaviour reachable by one env value), prove what did not change, produce the Android
arm64 `llama-perplexity` for the phone's section-35 verification pair, bound the cost at
ne1 = 8, run the seven standing targets.

Ship line verification (before any code changed):

- `git rev-parse refs/heads/kalsa-phone-v1-1-1` = `1577495b92096fca572f57a35b71607bacac85d5`
  (local branch, checked out in `/Users/marco/Projects/kalsallama-wt-phone-line`, clean).
- `git ls-remote origin refs/heads/kalsa-phone-v1-1-1` =
  `1577495b92096fca572f57a35b71607bacac85d5` - **local equals remote, exact match**.
- Not based on `f0811bd31` (q8a-subscale) or `e64352ac1` (q4k-da-fp32) as ordered; the
  base is the shipping tip itself.
- Own worktree **`/Users/marco/Projects/kalsallama-wt-cok`**, own branch
  **`kalsa-opencl-cok-fp32`**, `git worktree add -b` off `1577495b9`; worktree started
  clean (`git status --porcelain` = 0 lines).
- Shared checkout `/Users/marco/Projects/kalsallama` (on `main`, 12 dirty lines belonging
  to other agents) snapshotted before the session:
  `/tmp/cok-accumulator/shared-status-before.txt` (12 lines); re-check at the end.

Why (the measurement being corrected): `../s23-kld-740-q4-0/REPORT.md` section 31b -
batch 8 = **0.304543 median KLD / 66.198 % same-top**, vs 0.005412 at b256 and 0.006012 at
b1 on the same engine. At ne1 in [2,8] all 148 q4_K tensors take `_cok`, whose
accumulator AND product run in half; the app reaches the regime whenever
`prompt_length mod batch` leaves a 2..8-token tail (31 of 606 archived real turns, ~5 %).
Section 35 of the same report pre-registers the phone's verification pair against this
exact binary: control (`fp16` build) must reproduce 0.304543 EXACTLY, treatment (default)
must land <= ~0.0065.

## 1. Inventory and provenance (written BEFORE any code changed, line numbers at `1577495b9`)

- The defect site: `kernels/gemm_noshuffle_q4_k_f32.cl`, `_cok` kernel at `:399`,
  **`half8 acc = 0;` at `:428`**, half operand `half8 B`, half `dq`, four half
  accumulate sites `acc += B * dq;` at `:453`, `:458`, `:463`, `:468`. The cross-subgroup
  reduction at `:476-481` is ALREADY f32 (`local float8 reduceLM`, `convert_float8(acc)`),
  so the promotion touches only the per-subgroup loop.
- The fix template sits in the SAME FILE: the large-batch `kernel_gemm_noshuffle_q4_k_f32`
  keeps `scale`/`mval`/`dq` in half but computes the product and accumulator in f32
  (`float8 c0..c3`, `c0 += convert_float8(B) * (float)dequantized_weights.s0;`), with the
  in-file comment: "the half PRODUCT, not the accumulator, causes divergence. A float
  accumulator alone was measured not to fix it." That measured history answers the task's
  conditional: **the operands of the product contribute; both the accumulator and the
  product must go f32**, while the half dequant scales stay, matching the b256 path's
  arithmetic element for element (only the f32 summation ORDER differs, which is the same
  class of difference the 0.0054 b256 number already carries vs CPU).
- Provenance of the miss: the main GEMM's f32 product was kalsa commit `67c73d26c`
  (2026-09-07, "opencl: compute the Adreno q4_K GEMM product in f32"). The `_cok` kernel
  arrived from upstream PR #26477 (`95ef7fc16`) in the snapshot merge `3f3558b3b`
  (2026-09-16) - AFTER the fix - and `git diff 95ef7fc16 1577495b9 -- <the .cl>` contains
  **0 `_cok` hunks**: the small-batch kernel was merged with the old half-product pattern
  and never fixed. Not a theory, a merge-order finding.
- Dispatch site `ggml-opencl.cpp:22922-22945`: `use_cok = q4k_gemm_cok && (ne1 <= 8)`,
  default ON (`GGML_OPENCL_Q4K_GEMM_COK` unset = on), picks
  `kernel_gemm_noshuffle_q4_k_f32_cok` - **no dispatch change needed by this task** (the
  selector changes the program build, not the entry point).
- Program build site `ggml-opencl.cpp:4455-4472`: all four q4_K noshuffle kernels (main,
  `_r1`, `_kimg`, `_cok`) come from ONE program built with the shared `compile_opts`.
- The selector contract to copy: `kalsa_q8a_scale_f32()` at `ggml-opencl.cpp:1566-1582`.
- Sibling defect NOT touched: `kernel_gemm_noshuffle_q6_K_f32_cok`
  (`kernels/gemm_noshuffle_q6_k_f32.cl:158`, same half pattern) - but its dispatch is
  opt-in OFF by default (`GGML_OPENCL_Q6K_GEMM_COK`, `ggml-opencl.cpp:23329-23332`) and
  the dense q6_K route defaults to dp4a at this tip; out of scope, flagged to the owner in
  section 9.
- Program-cache safety (read from `cl-program-cache.h` at this commit): the cache key is
  `sha256(source_bytes || compile_opts || device || driver || platform || kernel-set-id ||
  format-version)`. This change alters BOTH source bytes (the `.cl` grows the `#ifdef`)
  and, in the legacy arm, `compile_opts` (`-DKALSA_COK_ACC_F16`), so both arms get fresh
  cache keys; the kernel-set identity hash is taken from the `.cl` at configure time
  (`ggml-opencl/CMakeLists.txt`, `file(SHA256 ...)`), so the build-verdict key moves too.
  A phone that cached the stock binary cannot load a wrong-arm program.

## 2. The change as built

Two files, +22 kernel lines and +24 host lines, nothing else (`git diff --name-only
1577495b9` = `ggml-opencl.cpp`, `kernels/gemm_noshuffle_q4_k_f32.cl`; ASCII check on the
diff: 0 non-ASCII lines):

| file | what changed |
|---|---|
| `kernels/gemm_noshuffle_q4_k_f32.cl` | `_cok` only: the accumulator declaration goes `float8 acc` (default) or `half8 acc` under `-DKALSA_COK_ACC_F16` (legacy), and the four accumulate sites go `acc += convert_float8(B) * (float)dq;` (default) or the old `acc += B * dq;` (legacy) - the exact product shape the large-batch GEMM in the same file already uses. `scale`/`mval`/`dq` stay half in BOTH arms, on purpose: the b256 path rounds them identically, so the treatment arm's per-term arithmetic equals the b256 path element for element. The f32 cross-subgroup reduction was already f32 and is untouched. |
| `ggml-opencl.cpp` | new `kalsa_cok_acc_f32()` next to `kalsa_q8a_scale_f32()` (same lambda-getenv-shape, inverted default); at the q4_K program build site: `cok_opts = compile_opts + " -DKALSA_COK_ACC_F16"` when the selector returns false, and a one-line `GGML_LOG_WARN("ggml_opencl: q4_K small-batch accumulator: %s (KALSA_COK_ACC)\n", ...)` at load, WARN level so it survives the bench stderr filter like the `q8_1 activation scale` lines do. Dispatch site, buffer sizes, kernel handles: untouched (same entry point both arms). |

Design note, stated: the legacy build is the one that carries the extra flag
(`-DKALSA_COK_ACC_F16`), so the DEFAULT build's compile opts are byte-identical to stock;
the only difference in the default arm is the kernel source itself.

## 3. Selector truth table (harness: function awk-extracted from the file bytes, compiled
with `clang++ -std=c++17`, fresh process per env value; log
`/tmp/cok-accumulator/sel/truth-table.txt`)

Byte-compare of the neighbour selector, working tree vs `1577495b9`:
`kalsa_q8a_scale_f32` = **cmp rc=0, 14 lines, byte-identical** (untouched, zero hunks
inside it).

### `KALSA_COK_ACC` (the new selector; `fp32` return = corrected default build, `fp16` return = legacy build)

| `KALSA_COK_ACC` | returns | build | arm |
|---|---|---|---|
| unset | 1 | no define | **fp32 - the DEFAULT: f32 accumulator + f32 product (the corrected behaviour)** |
| `""` (empty) | 1 | no define | fp32 (default) |
| `fp32` | 1 | no define | fp32 (default) |
| `fp16` | 0 | `-DKALSA_COK_ACC_F16` | fp16 = the v1-1-1 half accumulator/product, the control arm |
| `bogus` | rc=1 | - | `ggml_opencl: unrecognized KALSA_COK_ACC='bogus' (use fp32\|fp16)`, `exit(1)` |
| `FP16` (wrong case) | rc=1 | - | same rejection |
| `0` / `1` | rc=1 | - | same rejection (values are `fp32\|fp16` words, not numbers) |

Exact table as ordered: unset/empty/fp32 -> corrected default; fp16 -> old behaviour;
anything else -> error + exit 1. `KALSA_Q8A_SCALE`, `KALSA_Q6K_DENSE`,
`GGML_OPENCL_Q4K_GEMM_COK` and every other env are unread by this selector (the function
getenvs only `KALSA_COK_ACC`), so no cross-interference exists by construction.

## 4. Proof of what did NOT change (evidence, not assurance)

**4.1 Source scope.** `git diff --name-only 1577495b9` over the whole tree = exactly the
2 files above. Over `ggml/src/ggml-opencl/kernels/` = exactly 1 file. Every other
kernel's source is byte-identical to the shipping blob by git's own object comparison -
no hash needed, the tree says it directly.

**4.2 Compiled output - house standard form** (each variant compiled from its own
directory under the identical basename to LLVM IR at `-O2` for `spirv64`, NDK r29 clang
21, `-x cl -cl-std=CL3.0 -Xclang -finclude-default-header -target spirv64 -S -emit-llvm`;
logs `/tmp/cok-accumulator/gates/`, diffs `ir-ship-vs-*.diff`):

| comparison | result |
|---|---|
| new source + `-DKALSA_COK_ACC_F16` (the CONTROL arm) vs ship blob `1577495b9` | **whole-file diff rc=0, 0 lines - the legacy build is the committed kernel, byte for byte at IR level** |
| new source, no define (the DEFAULT arm) vs ship blob | 302 diff lines, **every hunk inside `kernel_gemm_noshuffle_q4_k_f32_cok`** (hunk ship-side lines 1262..1544; the four `define spir_kernel` functions sit at 9 = main, 544 = `_r1`, 851 = `_kimg`, 1222 = `_cok`; zero hunks before 1222) |
| syntax gate, 3 variants (ship blob, new no-define, new fp16-flag) | rc=0 / rc=0 / rc=0 |

Nature of the 302-line delta (machine-censused): the accumulator `phi <8 x half>` ->
`phi <8 x float>` and the product/accumulate chain moves from `<8 x half>` fmul/fadd to
`<8 x float>` (diff census: `<8 x half>` lines removed 17 / kept 4 - the 4 are the `B`
image loads, which stay half; `<8 x float>` lines added 39). No signature, no arg
metadata, no other function, no dispatch-relevant property changes - which is why no
host-side handle or dispatch edit is needed.

**4.3 Program-cache safety on the phone.** Both arms produce cache keys distinct from
every prior binary: the default arm's key moves because the source bytes moved; the
control arm's key moves because `-DKALSA_COK_ACC_F16` moves `compile_opts`
(`cl-program-cache.h` key = sha256(source || opts || device || driver || platform ||
kernel-set-id || format-version); the kernel-set-id hash is taken from the `.cl` at
configure time). A phone with a stock binary cache cannot load a wrong-arm program for
either arm.

## 5. What the default arm changes numerically (the point of the task)

With `KALSA_COK_ACC` unset (default), every ne1 in [2,8] q4_K GEMM term is now computed
as: half dequant (unchanged, same rounding as b256) -> half activations loaded from the
same `b_img_trans` image the b256 kernel reads (unchanged) -> PRODUCT in f32 and
ACCUMULATION in f32 (new) -> f32 cross-subgroup reduction (was already f32). The
remaining half-ness (operand storage, dequant scales) is bit-identical to the batch-256
path by construction, so the b8 default now differs from the b256 path only in f32
summation order - the same class of difference the b256 number 0.005412 itself carries
vs the CPU reference. That is the code-level reason to expect the section-35 treatment
arm to land in the b256 neighbourhood rather than merely improve.

## 6. Commit, Android arm64 build (llama-perplexity), embedded strings, sha256

- Commit: **`319b539377605f6c572e234b28678b74bd78deb5`** on branch `kalsa-opencl-cok-fp32`
  (exactly one commit above `1577495b9`; `git merge-base --is-ancestor 1577495b9 HEAD`
  holds). Worktree clean after (`git status --porcelain` = 0 lines).
  `git rev-list --count HEAD` = **11202** (ship tip was 11201). 2 files changed,
  47 insertions(+), 1 deletion(-).
- Load check before configure+build (01:56): `pgrep` for ninja / ld.lld / gradle / clang =
  no matches; uptime load **16.46 / 12.64 / 8.48** (below the ~30 wait line, no build
  running). Configure single-threaded, `ninja -j 3`.
- **Configure rc=0** (`/tmp/cok-accumulator/android-configure.log`), recipe =
  `../phone-engine-v2/REPORT.md` section 5 line by line, own build dir
  `build-android-ocl-cok-acc`. Summary: `-- Including CPU backend`, `-- Including OpenCL
  backend`, **`-- ggml commit:  319b53937`**. Cache verified: `BUILD_SHARED_LIBS:BOOL=OFF`,
  `GGML_OPENCL:BOOL=ON`, `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`.
- **ninja rc=0, 329/329 steps** (`/tmp/cok-accumulator/android-build.log`), **0 lines
  matching `error`**. Final lines: `[328/329] Linking CXX static library
  tools/perplexity/libllama-perplexity-impl.a`, `[329/329] Linking CXX executable
  bin/llama-perplexity`. The log shows `[144/329] Generate
  .../autogenerated/gemm_noshuffle_q4_k_f32.cl.h` (the embed picked up the new kernel
  source) and `[225/329] Building CXX object .../ggml-opencl.cpp.o` - this build is also
  the host-side compile gate for the edit. The only warnings in the touched file are the
  stock ones (lines 1537 / 8395 / 8539, none in the edited regions).
- **Embedded commit string / build number** (`build-android-ocl-cok-acc/common/build-info.cpp`):

```
int LLAMA_BUILD_NUMBER = 11202;        (== git rev-list --count HEAD, re-checked)
char const * LLAMA_COMMIT = "319b53937";
char const * LLAMA_BUILD_TARGET = "Android aarch64";
-> runtime: version: <llama_version()> (build 11202, commit 319b53937)
```

  `strings` exact-match counts inside the ELF: `319b53937` = **1**, `1577495b9` = 0.
  Selector strings present: `unrecognized KALSA_COK_ACC` = 1,
  `q4_K small-batch accumulator` = 1 (the load-time WARN format string, WARN level so it
  survives the bench stderr filter like the `q8_1 activation scale` lines), and the
  existing `KALSA_Q8A_SCALE` / `unrecognized KALSA_Q8A_SCALE` strings unchanged.
- **sha256 of the binary (for the phone's section-35 pair):**

```
60591d0b6dae91376d9b7903b07cda6267b601a106d917e1182457f5fdef1bcb  build-android-ocl-cok-acc/bin/llama-perplexity
```

  size 119,678,936 bytes; `file`: `ELF 64-bit LSB pie executable, ARM aarch64, version 1
  (SYSV), dynamically linked, interpreter /system/bin/linker64`,
  BuildID `f52e1ba39ab9fe60137cbdd335bbca71cab26842` (not runnable on this Mac - all
  evidence read from the artifacts).

**The two phone arms, same binary** (per the section-35 pre-registration in
`../s23-kld-740-q4-0/REPORT.md`; control FIRST, it gates the treatment):

```sh
# 1 - CONTROL: KALSA_COK_ACC=fp16 builds the kernel with the v1-1-1 half
#     accumulator/product - IR-BYTE-IDENTICAL to the shipped 1577495b9 kernel
#     (section 4.2, diff rc=0, 0 lines). Must reproduce 0.304543 / 66.198 % exactly.
KALSA_COK_ACC=fp16 ./llama-perplexity -c 256 -b 8 -ngl 99 -fa off -s 42 --temp 0 ...

# 2 - TREATMENT: no env at all (the shipping default). f32 product + f32 accumulator.
#     COMPLETE FIX if <= ~0.0065; 0.0065 < x < 0.30 = PARTIAL, report the closed gap
#     fraction (0.304543 - x) / (0.304543 - 0.005412).
KALSA_COK_ACC=fp32 ./llama-perplexity -c 256 -b 8 -ngl 99 -fa off -s 42 --temp 0 ...
```

Both arms print `ggml_opencl: q4_K small-batch accumulator: fp32|fp16 (KALSA_COK_ACC)` at
load, so the stderr record shows which kernel ran; an invalid value exits 1 at load with
`unrecognized KALSA_COK_ACC='...' (use fp32|fp16)`.

## 7. Native build (standing config) + the seven standing targets

- Load check before configure+build (01:59): no ninja / ld.lld / gradle / clang; load
  **9.35 / 12.12 / 9.16**. Configure single-threaded, `ninja -j 3`.
- Configure (standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`,
  `GGML_BLAS=ON`, Ninja, in-tree `build/`): **rc=0**
  (`/tmp/cok-accumulator/native-configure.log`), stamp **`-- ggml commit:  319b53937`**.
- `ninja -C build -j 3`: **rc=0, 479/479 steps** (`/tmp/cok-accumulator/native-build.log`),
  0 FAILED lines.
- Fixture: `build/tinyllamas/stories15M-q4_0.gguf` -> symlink to the shared checkout,
  19,077,344 bytes, sha256 `66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739`
  (same bytes as every predecessor session). Runs from the worktree root, real `$?`, logs
  `/tmp/cok-accumulator/targets/`. Operator note, recorded not hidden: the first run of
  the seven printed `1 1 1 77 1 1 0` because zsh does not word-split an unquoted variable
  (the binary received `"-m <path>"` as ONE argument and answered
  `error: invalid argument: -m ...`); the second run had the same defect through a
  variable path. The counts below are from explicit invocations, args typed directly.

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven counts: **0 0 77 77 0 0 0** - the standing sequence, identical to
`../q4k-da-fp32/REPORT.md`, `../phone-engine-v2/REPORT.md`, `../q8a-subscale/REPORT.md`
et al. `grep -c FAIL` = 0 in all seven logs. The 77s print their registered skip reasons
(`governor-devices: SKIP no GPU backend available (exit 77)` - METAL=OFF/OPENCL=OFF build;
`governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)`). PASS markers present
(`governor_v0_token_check=PASS (8 tokens)`, `governor_v0_turns=PASS turns=3 generated=18`,
`governor_chunked_prefill=PASS`, `governor_hot_prefill_pause=PASS`, ...).

## 8. The price at ne1 = 8 - bounded here, measured by the phone pair

No on-device wall-clock was taken by this cell (no adb, no device contact, and the
ordering rule in section 35 puts the speed pair on the phone AFTER control+treatment).
What was done instead, so the number is not a guess:

**8.1 Local execution is impossible, machine-proven.** This Mac's only GPU is an
Apple M1 Max; a probe program (`/tmp/cok-accumulator/clprobe.c`) shows the OpenCL
backend creates a context, CREATES the `image1d_buffer_t` the kernel needs (err=0), and
compiles the kernel source (err=0), but `clCreateKernel` fails with CL_INVALID_KERNEL
(-48) for **all four** kernels in the file (`newComputePipelineState failed` - Apple's
implementation rejects these Adreno-tuned kernels wholesale, the stock main GEMM
included). So no local GPU can run either arm; this is a property of Apple's OpenCL, not
of the fix.

**8.2 Static instruction bound (exact, from the section-4.2 IR).** Per 4-weight step the
inner loop's math changes from one fused `llvm.fmuladd.v8f16` to one `fpext` (half->f32
activations) plus one fused `llvm.fmuladd.v8f32`: the multiply-ADD count is IDENTICAL,
one extra convert per 8 elements. Whole-function static instruction count: **225 -> 233
(+3.6 %)**. Everything else the loop does is untouched: the 10 bytes/element of traffic
(2 B weight + 8 B activation via the same image reads) is identical in both arms, the
K-split/reduction shape is identical, and `dq` stays half (2 `fmuladd.f16` remain in both).

**8.3 Register footprint bound.** The accumulator grows from `half8` (4 packed 32-bit
regs) to `float8` (8 regs); the transient product is another 8. For scale: the batch-256
main GEMM in the same file already runs FOUR `float8` accumulators (32 regs) per thread
at the shipped 76 t/s; `_cok`'s new peak is well under that. Occupancy risk is bounded by
the b256 kernel's proven footprint.

**8.4 Reading.** Bounded cost: +3.6 % static instructions in a memory-latency-bound
kernel with identical traffic, register delta below a configuration that ships - i.e.
expected in the few-percent class at ne1=8, inside the section-35 pre-registered
"<= 5 % slower = no meaningful cost" band. The honest number is the phone's
`llama-perplexity -b 8 -ngl 99 -fa off` wall pair (both selector values, same binary,
fresh fp16 baseline in the same session per section 35.3); nothing above contradicts
that protocol, it only predicts where it should land.

## 9. Out of scope, flagged

`kernel_gemm_noshuffle_q6_K_f32_cok` (`kernels/gemm_noshuffle_q6_k_f32.cl:158`) carries
the same half-accumulator/product pattern, but at this tip its dispatch is opt-in OFF
(`GGML_OPENCL_Q6K_GEMM_COK`, default unset = off) and the dense q6_K route defaults to
dp4a - it is unreachable in the shipping configuration and was left untouched. If it is
ever made default, it needs this same treatment; the selector here covers the q4_K site
only, by order.

## 10. Load discipline log (owner rule)

Working form per `../q4k-da-fp32/REPORT.md` section 8 (macOS pgrep rejects the
alternation literal; separate patterns used):

| check | when | result |
|---|---|---|
| 1, before Android configure+build | 01:56 | no ninja/ld.lld/gradle/clang; load 16.46 / 12.64 / 8.48 |
| 2, before native configure+build | 01:59 | no matches; load 9.35 / 12.12 / 9.16 |

(The kernel edit and the clang gates ran before any check - they are single-invocation
phases, not heavy builds; both heavy phases were checked immediately before starting.)
Waited for: nothing - no other build was observed at any check and load never
approached 30. Configure steps single-threaded, both builds at `ninja -j 3` exactly.

## 11. Boundaries: tip sha, refs, and the push command - UNRUN

Tip: **`319b539377605f6c572e234b28678b74bd78deb5`** (branch `kalsa-opencl-cok-fp32`, own
worktree `/Users/marco/Projects/kalsallama-wt-cok`, linear descendant of the shipping
tip; the push below would be a fast-forward of the phone branch - no force needed):

```
319b53937  this: f32 accumulator/product for the dense q4_K small-batch GEMM  <- tip (new, unpushed)
1577495b92  ship tip (unchanged, still equals the remote phone ref, verified at start)
```

- `git rev-parse @{upstream}` for the new branch = none (no upstream configured);
  `git tag --points-at HEAD` = empty; no `git tag` was run.
- Shared checkout `/Users/marco/Projects/kalsallama` untouched: status snapshotted before
  (`/tmp/cok-accumulator/shared-status-before.txt`, 12 lines) and after
  (`shared-status-after.txt`) - diff rc=0, same 12 lines.
- Read-only `git ls-remote origin` at session start: `refs/heads/kalsa-phone-v1-1-1` =
  `1577495b92096fca572f57a35b71607bacac85d5` (== local). Nothing else touched, no fetch,
  no push, no tag.

**NONE of the block below was executed:**

```sh
# fast-forward the phone branch onto the fixed line (owner's call, owner's hands)
cd /Users/marco/Projects/kalsallama-wt-cok
git push origin 319b539377605f6c572e234b28678b74bd78deb5:refs/heads/kalsa-phone-v1-1-1

# verify after running (expect the phone ref moved to 319b53937...)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1
```


