# REPORT - cok-residual: K-split accumulation order ablation for the dense q4_K
# small-batch (_cok) GEMM

Status: IN PROGRESS - incremental report, written as the work happens. Nothing pushed,
nothing tagged, no upstream contact, no device/adb contact. The push command appears at
the end of this file marked UNRUN.

## 0. Task, base, and branch

Ordered task (audit item 5, `../cok-accumulator-audit/REPORT.md`): the tail-kernel fix
took ne1 2..8 from 0.304543 to 0.006890 median KLD, but the ship default at batch 256
reads 0.005412, so a residual of +0.001478 remains, and the audit's verdict is NOT
VERIFIED as a floor. The audit's named next step: the different K-split accumulation
order between the `_cok` path and the batch-256 kernel in the same file.

- Base: **`319b539377605f6c572e234b28678b74bd78deb5`** (reviewed commit, branch
  `kalsa-opencl-cok-fp32`, worktree `/Users/marco/Projects/kalsallama-wt-cok`).
- Own branch (this session): **`kalsa-opencl-cok-korder`**, created in that worktree with
  `git switch -c` from `319b53937`; start-of-work `git status --porcelain` = 0 lines.
  `git rev-parse HEAD` at start = `319b539377605f6c572e234b28678b74bd78deb5`.
- Shared checkout `/Users/marco/Projects/kalsallama` (on `main`, dirty lines of other
  agents) snapshotted before: `/tmp/cok-residual/shared-status-before.txt`, **12 lines**;
  re-check at the end.
- Files read before writing any code: both predecessor reports, the whole kernel file
  `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl` (516 lines), the selector
  block and q4_K program build site and `_cok` dispatch/launch geometry in
  `ggml-opencl.cpp`.

## 1. The difference, with file:line (written BEFORE any code changed, lines at 319b53937)

Both paths compute the same per-term arithmetic (the previous fix equalized that; audit
item 5 confirms scale/mval/dq half-ness matches the b256 rounding). What they still do
DIFFERENTLY with the K dimension:

**Reference shape - batch-256 kernel, serial in-order K walk:**

- `gemm_noshuffle_q4_k_f32.cl:61` - four f32 accumulators `float8 c0..c3`, one per
  output column of the work-item's 4-column tile.
- `:70` - `for (int i = 0; i < k; i += 32)`: ONE work-item walks the whole K dimension
  **serially in increasing order**; inner adds at `:91` (`for l = 0; l < 32; l += 4`),
  nibble order j=0..3 at `:102-141`.
- `:145-177` - results stored directly; **no cross-work-item K reduction**. So for each
  output element the f32 sum is a strictly sequential chain: block 0, 1, 2, ..., k/32-1.

**The `_cok` path - strided K split across 8 subgroups plus a partial-sum reduction:**

- `:438` - `for (int blk = sg; blk < num_32blk; blk += COK_NSG)`: subgroup `sg` handles
  blocks `sg, sg+8, sg+16, ...` (strided; `COK_NSG` defined at `:394`).
- `:494-505` - the cross-subgroup reduction: subgroups 1..7 store their partial `acc`
  into `reduceLM` (`:496-498`), then `sg == 0` adds them in subgroup order (`:501-505`).

Effective addition order over K blocks in `_cok` today:
`[0,8,16,...] + [1,9,17,...] + [2,10,...] + ... + [7,15,23,...]`
versus the reference's `0, 1, 2, ..., k/32-1`.

Floating-point addition is not associative, so this order difference leaves a numerical
delta even with identical per-term precision. That is the candidate for the +0.001478
residual. (Audit item 5's own words: "assigns K blocks to eight subgroups (:438-450) and
then adds subgroup partial sums in the sg == 0 reduction (:494-504); the large-batch
kernel walks K through its four f32 accumulators in a different order (:61-70,91-105)".)

## 2. Why the ablation IS expressible behind a selector without changing other shapes

Exact replication of the reference order requires a strictly sequential add chain per
output element (any parallel partial-sum scheme changes the grouping). Inside `_cok` that
is expressible with `#ifdef` only:

- the `:438` loop header becomes: `sg == 0` iterates ALL K blocks in increasing order,
  `sg 1..7` iterate none (loop bound trick, same line, same body);
- the `:494-505` reduction is replaced by: `sg == 0` stores its own `acc` directly (the
  path the reduction already funnels through - only `sg == 0` ever stores, `:506-514`).

Nothing else moves: same entry point (`kernel_gemm_noshuffle_q4_k_f32_cok`), same kernel
arguments, same buffer sizes, same launch geometry - dispatch and
`ggml-opencl.cpp:22990-22998` (global `(ne01, 8, 1)`, local `(64, 8, 1)`) are untouched.
The idle subgroups in the corrected arm are the ablation's price, not a shape change.
Therefore the stop-case does not apply and the ablation proceeds.

## 3. PREDICTION - stated BEFORE the build (2026-09-23 03:25 EDT, before any code edit)

The deciding experiment is the phone's b8 reference pair, same binary, three arms:

1. `KALSA_COK_ACC=fp16` (unchanged control) must reproduce **0.304543 / 66.198 %**
   exactly - it pins the shipped half/split kernel byte for byte (gates in section 5).
2. `KALSA_COK_KORDER=split` with the default fp32 arithmetic (this commit's control =
   last commit's treatment) must reproduce **0.006890 / 93.138 %** exactly.
3. Default (no env = fp32 + serial order) is the treatment.

**If the K-split accumulation order is the residual's cause, the treatment lands at or
below the ship default's neighbourhood, about 0.0054** (the serial `_cok` arm then walks
K exactly as the b256 kernel does, element for element), i.e. the +0.001478 residual
closes to ~0.

**Stop rule (pre-registered):** the harness is digit-for-digit reproducible on repeat
(`../s23-kld-740-q4-0/REPORT.md:358-359`: a repeat run reproduced the earlier number
identically), so the measurement's own spread on the median is 0 at displayed precision.
If the treatment does not move materially off 0.006890 - i.e. it stays within noise of
the current value instead of reaching the ~0.0054 neighbourhood - then the residual is
something else; we say so and stop. No third attempt at the same 0.0015.

Honest caveats fixed in advance: (a) even if the order is confirmed, batch-8 runs may
still differ from batch-256 by batch-dependent paths outside this kernel (the b1 number
0.006012 vs b256 0.005412 shows a 0.0006 class of such difference on this engine), so
"neighbourhood of 0.0054", not "exactly 0.0054", is the pass line; (b) the serial arm
makes the `_cok` kernel 8x less K-parallel - the phone speed pair (both selector values,
same binary) gates any ship decision, and this cell runs no device timing.

## 4. The change (written after the prediction above)

(build section written as it happens)
### 4.1 What was built

Two files, +52 insertions / -1 deletion (`git diff --stat`), ASCII-clean (`git diff |
perl -ne 'print if /[^\x00-\x7F]/'` = 0 lines), only these two files changed
(`git diff --name-only`):

| file | change |
|---|---|
| `kernels/gemm_noshuffle_q4_k_f32.cl` | `_cok` only, +22 lines: the `:438` loop header and the `:494-515` reduction/store tail are now behind `#ifdef KALSA_COK_KSPLIT`. With the define (shipped shape): byte-identical text to 319b53937 - strided split `for (blk = sg; blk < num_32blk; blk += COK_NSG)` plus the `reduceLM` reduction. Without the define (corrected default): `for (blk = sg == 0 ? 0 : num_32blk; blk < num_32blk; blk++)` - sg 0 walks ALL K blocks in increasing order exactly like the b256 kernel's `:70` loop, sg 1..7 iterate zero blocks, no `reduceLM`, no barrier, sg 0 stores its own sum directly (the store block the reduction already funnels through). The accumulator/precision `#ifdef KALSA_COK_ACC_F16` block and the whole loop body are untouched. |
| `ggml-opencl.cpp` | +31/-1: new `kalsa_cok_korder_split()` next to `kalsa_cok_acc_f32()` (same lambda-getenv-shape; values `serial`\|`split`, default serial, bogus = ERROR + exit 1); new `kalsa_cok_k_split()` = `kalsa_cok_korder_split() \|\| !kalsa_cok_acc_f32()` - **the fp16 arm is pinned to the split order**, so `KALSA_COK_ACC=fp16` alone still means the shipped kernel byte for byte (section-35 control stays one env value); at the q4_K program build site, `-DKALSA_COK_KSPLIT` appended when `kalsa_cok_k_split()`, and the load WARN now prints both arms: `q4_K small-batch accumulator: %s (KALSA_COK_ACC), K order: %s (KALSA_COK_KORDER)`. Dispatch, launch geometry (`:22990-22998`), buffer sizes, kernel handles: untouched. |

Selector truth table (harness: the three functions awk-extracted from the file bytes,
compiled `clang++ -std=c++17`, fresh process per value; `/tmp/cok-residual/sel/truth-table.txt`):

| env | result |
|---|---|
| all unset / empty / `KALSA_COK_ACC=fp32` / `KALSA_COK_KORDER=serial` | **fp32 + serial, no defines - the DEFAULT (corrected)** |
| `KALSA_COK_KORDER=split` (one value) | `-DKALSA_COK_KSPLIT` only - fp32 + split = **this commit's control arm = 319b53937's default treatment** |
| `KALSA_COK_ACC=fp16` (one value, with or without KORDER) | `-DKALSA_COK_ACC_F16 -DKALSA_COK_KSPLIT` - **shipped v1-1-1 kernel** |
| `KALSA_COK_KORDER=bogus` / `KALSA_COK_ACC=bogus` / wrong case / numbers | ERROR `unrecognized ...`, exit 1 |

## 5. Gates (NDK clang 21, full argv logged at /tmp/cok-residual/gates/commands.txt - the predecessor's empty argv logs were an audit finding, fixed here)

Compile line: `cd <srcdir> && /opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang -x cl -cl-std=CL3.0 -Xclang -finclude-default-header -target spirv64 -O2 -S -emit-llvm [defines] -o ... gemm_noshuffle_q4_k_f32.cl` (plus `-fsyntax-only` pass). Sources: ship = `git show 1577495b9:...`, 319b = `git show 319b53937:...`, new = working tree; sha256 match the audit's recorded values (ship `82c6030ed...`, 319b `0d8dc8c12...`, new `a9cba686a...`). All 6 IR builds and 6 syntax gates **rc=0, 0-byte logs (no warnings)**.

Identity gates (byte-compare of .ll, `cmp -s`):

| comparison | rc | meaning |
|---|---|---|
| new + `-DKALSA_COK_ACC_F16 -DKALSA_COK_KSPLIT` vs 319b + `-DKALSA_COK_ACC_F16` | **0** | `KALSA_COK_ACC=fp16` arm = last session's control kernel |
| new + F16 + KSPLIT vs **ship blob 1577495b9** (no defines) | **0** | fp16 arm still byte-identical to the shipped kernel -> reproduces 0.304543 |
| 319b + F16 vs ship blob | **0** | (re-derived this session, links the sessions) |
| new + `-DKALSA_COK_KSPLIT` vs 319b default (no defines) | **0** | `KALSA_COK_KORDER=split` arm = 319b53937's treatment kernel -> reproduces 0.006890 |
| my fresh ship/319b builds vs predecessor's retained IR (`/tmp/cok-accumulator/ir/*`) | 0-line diffs | session chain (first attempt used absolute paths, which only changed the ModuleID/source_filename header lines; recompiled with the predecessor's bare-filename invocation) |

Change census - new default (serial) vs 319b default IR (`gates/ir-319b-fp32-vs-new-serial.diff`,
24 hunks, 557 diff lines): every hunk is either (a) inside `kernel_gemm_noshuffle_q4_k_f32_cok`
(old body 1221..1555 of a 1592-line module; `_cok` starts at old line 1222), (b) the
module-scope `@..._cok.reduceLM` global removal (old line 5-6), or (c) the module-scope
`declare ... @...barrier` removal (old 1556-1558) - both exist only because `_cok` used
them (no other kernel calls `barrier`, which is why the declare disappears whole).
The three other kernel definitions (old 9, 544, 851), the kernel argument metadata
`!4-!7`, the attribute groups and the trailing module metadata are unchanged (0 hunks).
The `_cok` definition's inferred attributes change (`norecurse` -> `nofree ...
memory(read, argmem: readwrite)`, consequence of dropping the local-array/barrier), it now
refs attribute group `#5` (already present, used by `_r1`) - no new attribute group.

## 6. Commit, Android arm64 build (llama-perplexity), embedded strings, sha256

- Load check before configure+build (03:29): separate `pgrep -fl` for `ninja`, `ld.lld`,
  `clang`, `gradle`, `cmake` - no matches; **load 1.51 / 1.37 / 1.38**. Configure
  single-threaded (plain `cmake -B`), build `ninja -j 3` exactly.
- Commit: **`7965f43e07b454af20954400b8429428d746bf2c`** (short `7965f43e0`) on branch
  **`kalsa-opencl-cok-korder`**, one commit above the reviewed `319b53937`
  (`git merge-base --is-ancestor 319b53937 HEAD` holds; `git rev-list --count HEAD` =
  **11203**). Worktree clean after (`git status --porcelain` = 0 lines).
  `git rev-parse @{upstream}` -> fatal, no upstream; `git tag --points-at HEAD` empty.
- **Configure rc=0** (3.0 s, `/tmp/cok-residual/android-configure.log`), recipe =
  `../phone-engine-v2/REPORT.md` section 5 line by line, own build dir
  **`build-android-ocl-cok-korder`**: summary `-- Including CPU backend`,
  `-- Including OpenCL backend`, **`-- ggml commit:  7965f43e0`**; 0 lines matching
  `error`; cache verified `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`, the two explicit OpenCL paths set.
- **ninja rc=0, 651/651 steps** (2 m 45 s, `/tmp/cok-residual/android-build.log`). The
  single `error` grep hit is the known configure-time UI-download message
  (`b11203 ... HTTP response code said error`), not a compile error. The log shows
  `[144/651] Generate .../autogenerated/gemm_noshuffle_q4_k_f32.cl.h` (embed picked up the
  new kernel) and `[226/651] Building CXX object .../ggml-opencl.cpp.o` (host-side compile
  gate for the edit). Warnings in `ggml-opencl.cpp` are the stock ones only (lines 1537 /
  8424 / 8568 / 9643 / 13191 / 13392 / 13496 - the 8424/8568 pair is the stock 8395/8539
  pair shifted by my +31 lines; none inside the edited regions 1584-1631 and 4495-4510).
- **Embedded commit string / build number** (`build-android-ocl-cok-korder/common/build-info.cpp`):

```
int LLAMA_BUILD_NUMBER = 11203;        (== git rev-list --count HEAD, re-checked)
char const * LLAMA_COMMIT = "7965f43e0";
char const * LLAMA_BUILD_TARGET = "Android aarch64";
-> runtime prints: version: <llama_version()> (build 11203, commit 7965f43e0)
```

  `strings` exact-match counts inside the ELF: `7965f43e0` = **1**, `319b53937` = 0,
  `1577495b9` = 0. New selector strings present: `unrecognized KALSA_COK_KORDER` = 1,
  `unrecognized KALSA_COK_ACC` = 1, `q4_K small-batch accumulator` = 1,
  `K order: %s (KALSA_COK_KORDER)` = 1.
- **sha256 of the binary (the path is `build-android-ocl-cok-korder/bin/llama-perplexity`
  under the worktree root `/Users/marco/Projects/kalsallama-wt-cok`):**

```
6ff4124b4c8a6449cca7e880556f94a3a2d90cb233151411d0439664e328c747  build-android-ocl-cok-korder/bin/llama-perplexity
```

  size **119,682,840 bytes**; `file`: `ELF 64-bit LSB pie executable, ARM aarch64,
  version 1 (SYSV), dynamically linked, interpreter /system/bin/linker64`,
  BuildID `865369a7ca46d27000b69ac51553f70bd296e162` (not runnable on this Mac - all
  evidence read from the artifacts).

**The phone pair - three arms, same binary** (prediction pre-registered in section 3;
control 1 gates control 2 gates the treatment):

```sh
# 1 - SHIPPED control: must reproduce 0.304543 / 66.198 % exactly
#     (kernel IR byte-identical to 1577495b9, section 5 gate 2)
KALSA_COK_ACC=fp16 ./llama-perplexity -c 256 -b 8 -ngl 99 -fa off -s 42 --temp 0 ...

# 2 - 319b control: must reproduce 0.006890 / 93.138 % exactly
#     (kernel IR byte-identical to 319b53937's default, section 5 gate 4)
KALSA_COK_KORDER=split ./llama-perplexity -c 256 -b 8 -ngl 99 -fa off -s 42 --temp 0 ...

# 3 - TREATMENT: no env (shipping default) = fp32 terms + serial K order.
#     Pass: at or below ~0.0054 neighbourhood (residual +0.001478 closes).
#     Fail per section 3 stop rule: sits on 0.006890 -> residual is something
#     else, report and stop, no third attempt.
./llama-perplexity -c 256 -b 8 -ngl 99 -fa off -s 42 --temp 0 ...
```

All three arms print `ggml_opencl: q4_K small-batch accumulator: %s (KALSA_COK_ACC),
K order: %s (KALSA_COK_KORDER)` at load; invalid values exit 1. The serial default makes
the `_cok` kernel 1-of-8 subgroups active (section 2) - the phone's b8 speed pair
(arm 3 vs arm 2, same binary) is the pre-declared price gate and is NOT run by this cell.

## 7. Native build (standing config) + the seven standing targets

- Load check before configure+build (03:33): no ninja/ld.lld/clang/gradle/cmake;
  load **3.18 / 2.94 / 2.11** (decaying from this session's own Android build, no foreign
  build running). Configure single-threaded, `ninja -C build -j 3`.
- Configure (standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`,
  `GGML_BLAS=ON`, Ninja, in-tree `build/`): **rc=0**
  (`/tmp/cok-residual/native-configure.log`), stamp **`-- ggml commit:  7965f43e0`**,
  cache verified on all four keys, 0 error lines.
- `ninja -C build -j 3`: **rc=0, 142/142 steps** (`/tmp/cok-residual/native-build.log`),
  0 FAILED lines; the single `error` grep hit is the known UI-download message
  (`b11203 ... HTTP response code said error`). Native `build/common/build-info.cpp`:
  `LLAMA_BUILD_NUMBER = 11203`, `LLAMA_COMMIT = "7965f43e0"` (the OPENCL=OFF native
  build does not compile `ggml-opencl.cpp`; the Android build in section 6 is the
  host-side compile gate).
- Fixture: `build/tinyllamas/stories15M-q4_0.gguf` -> symlink to the shared checkout,
  sha256 **`66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739`** (same bytes
  as every predecessor session). Runs from the worktree root, real `$?`, args typed
  directly (the predecessor's zsh word-splitting lesson heeded), logs
  `/tmp/cok-residual/targets/`:

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
(`governor-devices: SKIP no GPU backend available (exit 77)` - METAL=OFF/OPENCL=OFF;
`governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)`). PASS markers present
(`governor_v0_token_check=PASS (8 tokens)`, `governor_commit_full_state=PASS`,
`governor_chunked_prefill=PASS`, `governor_hot_prefill_pause=PASS`, ...).

## 8. Load discipline log (owner rule)

Working form per `../q4k-da-fp32/REPORT.md` section 8 (macOS `pgrep -fl` rejects the
alternation literal `ninja|ld.lld|...`; separate patterns used):

| check | when | result |
|---|---|---|
| 1, before Android configure+build | 03:29 | no matches for ninja/ld.lld/clang/gradle/cmake; load **1.51 / 1.37 / 1.38** |
| 2, before native configure+build | 03:33 | no matches; load **3.18 / 2.94 / 2.11** (own previous build just finished) |

Both configures single-threaded (plain `cmake -B`), both builds `ninja -j 3` exactly.
The edit, IR gates and selector harness ran before check 1 - single-invocation phases,
not heavy builds. Nothing waited for: no foreign build was observed at any check.

## 9. Boundaries: tip sha, refs, and the push command - UNRUN

Tip: **`7965f43e07b454af20954400b8429428d746bf2c`** (branch `kalsa-opencl-cok-korder`,
worktree `/Users/marco/Projects/kalsallama-wt-cok`, linear descendant of the reviewed
`319b53937` - `git merge-base --is-ancestor 319b53937 HEAD` rc=0):

```
7965f43e0  this: KALSA_COK_KORDER serial K order for the dense q4_K small-batch GEMM  <- tip (new, unpushed)
319b53937  reviewed commit (unchanged; its branch kalsa-opencl-cok-fp32 still points here)
1577495b9  ship tip
```

- `git rev-parse @{upstream}` -> fatal, no upstream configured; `git tag --points-at HEAD`
  = empty; no `git tag`, no `git fetch`, no `git push` was run this session.
- Shared checkout `/Users/marco/Projects/kalsallama` untouched: status snapshotted before
  (`/tmp/cok-residual/shared-status-before.txt`, 12 lines) and after
  (`shared-status-after.txt`) - compared at session end.

**NONE of the block below was executed:**

```sh
# fast-forward the phone branch onto this line (owner's call, owner's hands)
cd /Users/marco/Projects/kalsallama-wt-cok
git push origin 7965f43e07b454af20954400b8429428d746bf2c:refs/heads/kalsa-phone-v1-1-1

# verify after running (expect the phone ref moved to 7965f43e0...)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1
```
