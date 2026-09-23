# Independent audit: q4_K small-batch (_cok) accumulator fix

Audit date: 2026-09-23

Target: commit `319b539377605f6c572e234b28678b74bd78deb5` on branch
`kalsa-opencl-cok-fp32`, parent shipping tip
`1577495b92096fca572f57a35b71607bacac85d5`, worktree
`/Users/marco/Projects/kalsallama-wt-cok`.

This is a read-only review. I did not edit engine, binding, app, or package code and did
not push, tag, or contact a device. This report is written incrementally from the raw
artifacts and preserved build products. Source references include file and line; absolute
paths are given where needed to disambiguate worktrees.

## 1. Pair values and the pre-registered label - CONFIRMED

The archived verification logs reproduce the gate and treatment directly:

- `s23-kld-740-q4-0/raw/cok-control.log:34,57`: median KLD `0.304543`, same-top
  `66.198 +/- 1.122 %`.
- `s23-kld-740-q4-0/raw/cok-treatment.log:34,57`: median KLD `0.006890`, same-top
  `93.138 +/- 0.600 %`.
- Independent comparison point, `s23-kld-740-q4-0/raw/b8-gpu.log:34,57`, is also
  `0.304543 / 66.198 +/- 1.122 %`.

The registered gap is `0.304543 - 0.005412 = 0.299131`. The treatment closes
`(0.304543 - 0.006890) / 0.299131 = 0.995059`, or **99.5059%** of that gap. KLD is
`44.2007x` lower; same-top rises `26.940` percentage points. The treatment is still
`0.000390` above the registered `0.0065` complete-fix line and `0.001478` above the
ship-default `0.005412`. **Partial** is therefore the honest pre-registered label, despite
the 99.51% gap closure.

Commands run:

```sh
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-control.log | sed -n '30,60p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-treatment.log | sed -n '30,60p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/b8-gpu.log | sed -n '30,60p'
awk 'BEGIN { control=0.304543; treat=0.006890; base=0.005412; printf "gap %.6f, closure %.4f%%, ratio %.4fx, top delta %.3f pp, miss %.6f, residual %.6f\n", control-base, 100*(control-treat)/(control-base), control/treat, 93.138-66.198, treat-0.0065, treat-base }'
```

## 2. Source and compiled no-change claims - MIXED

The source diff is limited to two files: `ggml-opencl.cpp` selects the build arm, and the
q4_K kernel source changes only `kernel_gemm_noshuffle_q4_k_f32_cok` (source lines
428-490). The new default uses `float8 acc` and `convert_float8(B) * (float)dq`; the
`KALSA_COK_ACC_F16` branch retains the prior half accumulator and half product. The other
three kernel source bodies are outside the patch.

The retained LLVM IR products let me independently redo the comparisons, though not the
compiler invocation:

- `cmp -s /tmp/cok-accumulator/ir/ship/gemm.ll /tmp/cok-accumulator/ir/new-fp16/gemm.ll`
  returned 0. Both files hash to
  `cfa4c1cdc23417444b40fc20d2871061f817f292bab21f456a83c56acddb159d`.
- The saved default comparison has 302 diff-file lines. Its body changes are in the
  `_cok` definition, which starts at ship IR line 1222; none of the other three kernel
  definitions (ship IR lines 9, 544, 851) change. The OpenCL kernel argument metadata and
  trailing module metadata are unchanged.
- Literal qualification: the default IR diff is **not wholly inside** `_cok`. It also adds
  one module-scope declaration, `convert_float8(<8 x float>)`, at default IR line 1554.
  It is a compiler-emitted overload declaration used by the changed `_cok` body, not a new
  kernel or changed metadata. So the author's broad no-other-kernel/no-metadata claim is
  confirmed, while "all 302 diff lines fall inside `_cok`" is too strong.
- I could not independently regenerate the IR. `/tmp/cok-accumulator/ir/{ship,new-fp16,new-fp32}`
  retains the source and `.ll` products but no compiler logs with full argv. The reported
  NDK directory `/Users/marco/Library/Android/sdk/ndk` is absent, and `find` found no NDK
  clang in the searched user tree; `/usr/bin/clang` is Apple clang 21.0.1, not the reported
  Android NDK compiler. Therefore byte-identity is confirmed against the preserved IR
  products, not by a fresh compile in this audit.

Commands run:

```sh
git -C /Users/marco/Projects/kalsallama-wt-cok show --format= --no-ext-diff --no-renames 319b539377605f6c572e234b28678b74bd78deb5 -- ggml/src/ggml-opencl/ggml-opencl.cpp
git -C /Users/marco/Projects/kalsallama-wt-cok diff --no-ext-diff 1577495b9 319b539377605f6c572e234b28678b74bd78deb5 --
cmp -s /tmp/cok-accumulator/ir/ship/gemm.ll /tmp/cok-accumulator/ir/new-fp16/gemm.ll
shasum -a 256 /tmp/cok-accumulator/ir/ship/gemm.ll /tmp/cok-accumulator/ir/new-fp16/gemm.ll /tmp/cok-accumulator/ir/new-fp32/gemm.ll
wc -l /tmp/cok-accumulator/gates/ir-ship-vs-fp16.diff /tmp/cok-accumulator/gates/ir-ship-vs-fp32.diff
diff -U0 /tmp/cok-accumulator/ir/ship/gemm.ll /tmp/cok-accumulator/ir/new-fp32/gemm.ll
nl -ba /tmp/cok-accumulator/ir/new-fp32/gemm.ll | sed -n '1222,1230p;1534,1560p'
```

## 3. Selector and OpenCL program cache - selector CONFIRMED; author cache explanation REFUTED

I reran the saved selector harness in fresh processes. Unset, empty, and `fp32` return the
fp32/default arm; `fp16` returns the legacy arm; `bogus` prints the error and exits 1. This
matches `ggml-opencl.cpp:1587-1599` and the archived table at
`/tmp/cok-accumulator/sel/truth-table.txt:1-8`.

The cache mechanism prevents an old shipping program from matching either new arm. The
key is SHA-256 over source bytes, compile options, device/driver/platform identity, kernel
set ID, and format version (`cl-program-cache.h:18-29`; implementation at
`cl-program-cache.cpp:239-257,378-412`). CMake derives the kernel set ID from kernel source
hashes (`ggml-opencl/CMakeLists.txt:49-51,265-266`). The source hash changed from
`82c6030ed574dffe275da501d4534508be04c22278582d8ba7fade1bef272fa2` at the ship tip to
`0d8dc8c12b2c5a81f28983bf8e16f20c48087ee8132bb5d6058d825e968fa5de` in the candidate.
The control also adds `-DKALSA_COK_ACC_F16`; the default omits it. An old ship cache entry
cannot have the candidate source key, and the two new arms cannot share a key.

The archived phone traces agree with that selection: control `cok-control.err:295-296`
shows the q4_K program source size `20403B` and an fp16 define prefix in its options;
treatment `cok-treatment.err:149` shows the same candidate source size and no fp16 define.
The trace prints only the first 16 key hex digits and truncates displayed options
(`cl-program-cache.cpp:322-324`), so the full macro is corroborated by the source at
`ggml-opencl.cpp:4482-4488` and the preserved fp16 IR comparison. Treatment is a cache HIT
for the selected no-define build; that hit is compatible with an earlier build of the same
candidate source/options and is not evidence of a ship-blob hit.

One author explanation is not supported by the implementation: the report says the control
trace shows init eagerly compiles both selector variants (`cok-accumulator/REPORT.md:1939-1942`).
The host code selects one `cok_opts` value and calls `build_program_from_source` once, then
creates the four q4_K kernel handles from that one program (`ggml-opencl.cpp:4482-4494`).
The trace shows the selected fp16 build only in the control process. The treatment cache hit
therefore came from a pre-existing matching default key, not both variants being compiled
by control init. This does not undermine cache safety, but the provenance narrative should
be corrected.

Commands run:

```sh
for v in unset empty fp32 fp16 bogus; do case "$v" in unset) env -u KALSA_COK_ACC /tmp/cok-accumulator/sel/harness;; empty) KALSA_COK_ACC= /tmp/cok-accumulator/sel/harness;; *) KALSA_COK_ACC="$v" /tmp/cok-accumulator/sel/harness;; esac; printf '%s rc=%d\n' "$v" "$?"; done
nl -ba /tmp/cok-accumulator/sel/truth-table.txt
rg -n 'cache (MISS|HIT|SAVE).*src=20403B' /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-control.err /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-treatment.err
git -C /Users/marco/Projects/kalsallama-wt-cok show 1577495b9:ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl | shasum -a 256
shasum -a 256 /Users/marco/Projects/kalsallama-wt-cok/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
nl -ba /Users/marco/Projects/kalsallama-wt-cok/ggml/src/ggml-opencl/cl-program-cache.h | sed -n '18,31p'
nl -ba /Users/marco/Projects/kalsallama-wt-cok/ggml/src/ggml-opencl/cl-program-cache.cpp | sed -n '239,257p;378,412p'
```

## 4. Runtime price, real-prefill estimate, and decode - MEASURED TAIL PRICE CONFIRMED

The two raw speed stderr captures report `16.30` and `17.66` seconds per pass at
`batch_size=8` (`cok-speed-fp16.err:7-8`, `cok-speed-fp32.err:7-8`). The increase is
`(17.66 - 16.30) / 16.30 = 8.3436%`, `2.32x` the coder's static `+3.6%` instruction
estimate, and in the pre-registered 5-10% "notable" band. This is the stress case where
every chunk is 8 tokens; it is the right bound for the affected tail, but not the cost of an
ordinary full prefill.

For a concrete few-thousand-token prefill, take 3,080 tokens with `n_ubatch=256`: twelve
full chunks account for 3,072 tokens, and only the final 8-token chunk uses `_cok`. Its
column-work share is `8/3,080 = 0.2597%`. Multiplying that share by 8.3436% gives `0.0217%`
only if the old wall time per token is equal in the tail and full chunks. The archived
throughputs show that is not a good wall-time assumption: the b8 pass covers 14 eight-token
chunks in 16.30 seconds, while the shipped b256 path measured 76.36 tokens/second
(`s23-kld-740-q4-0/REPORT.md:1324-1338`). Using those rates, one old 8-token tail averages
`16.30/14 = 1.164` seconds; the fixed tail averages `17.66/14 = 1.261` seconds; the 3,072
full tokens take about `3,072/76.36 = 40.230` seconds. The estimated prefill moves from
`41.395` to `41.492` seconds, or **+0.235% overall**; the tail is 2.81% of old wall time and
costs +8.34%. This is a cross-measurement estimate, not a measured full prefill, and the
app's q8_0/q4_0 plus FA-auto configuration can shift it. A 2-token tail should cost less if
time scales with tail work. Prompts whose remainder modulo 256 is outside 2..8 do not use
this path. The prior archive counts 31/606 records (5.1%) with a 2..8 tail, with the
report's stated duplicate-record caveat (`s23-kld-740-q4-0/REPORT.md:1871-1885`).

Decode has no cost from this change: `ne1 == 1` enters the GEMV branch at
`ggml-opencl.cpp:22580`, while the `_cok` GEMM dispatch is in the `else` path beginning at
line 22779 and selects `_cok` only there (`:22948,22963-22966`). The decode-path cost is
therefore exactly 0% for this edit.

The device pair does not yet match the app configuration end to end. Its archived command
uses the `LFM2.5-2.6B-Q4_K_M.gguf` test model with `-fa off` and no q8_0/q4_0 KV flags
(`raw/run-scripts/cok-pair.sh:1-21`). The app catalog includes `Qwen3.5-4B-Q4_K_M.gguf`
with q8_0/q4_0 KV (`/Users/marco/Projects/kalsa/src/engine/ModelRegistry.ts:204-226`), and
`LlamaService.ts:2400-2402` sets flash attention to `auto` and passes those cache types.
The COK treatment result in the app's exact model/KV/attention setup remains unmeasured.
That is a release-evidence gap, even though the worst-case tail price and its small
compute-weighted prefill estimate are clear.

Commands run:

```sh
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-speed-fp16.err
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-speed-fp32.err
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/REPORT.md | sed -n '1324,1338p'
awk 'BEGIN { printf "slowdown %.4f%%\n", 100*(17.66-16.30)/16.30; for (t=2;t<=8;t+=6) { printf "tail %d: fraction %.4f%%, projected whole-prefill %.4f%%\n", t, 100*t/3080, 100*(t/3080)*(17.66-16.30)/16.30 } }'
awk 'BEGIN { tail_old=16.30/14; tail_new=17.66/14; bulk=3072/76.36; baseline=tail_old+bulk; printf "old tail %.6fs, new tail %.6fs, bulk %.6fs, total old %.6fs, delta %.6fs, tail wall share %.4f%%, prefill slowdown %.4f%%\n", tail_old, tail_new, bulk, baseline, tail_new-tail_old, 100*tail_old/baseline, 100*(tail_new-tail_old)/baseline }'
nl -ba /Users/marco/Projects/kalsallama-wt-cok/ggml/src/ggml-opencl/ggml-opencl.cpp | sed -n '22580,22586p;22774,22782p;22935,22966p'
nl -ba /Users/marco/Projects/kalsa/src/engine/ModelRegistry.ts | sed -n '204,226p'
nl -ba /Users/marco/Projects/kalsa/src/engine/LlamaService.ts | sed -n '2398,2403p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/run-scripts/cok-pair.sh | sed -n '14,25p'
```

## 5. The 0.001478 residual - NOT VERIFIED AS A FLOOR

The remaining KLD distance from the ship-default number is `0.006890 - 0.005412 =
0.001478`. Nothing in this pair establishes that as a floor. The treatment still computes
`scale`, `mval`, and `dq` in half (`gemm_noshuffle_q4_k_f32.cl:435-450,458`), but the
large-batch reference kernel also rounds scale/minimum/dequantized weights to half before
its f32 product and accumulation (`:63-64,88-105`). Promoting those values is therefore not
the obvious missing step for matching the b256 arithmetic.

There is a clear path-specific difference left to test: `_cok` assigns K blocks to eight
subgroups (`:438-450`) and then adds subgroup partial sums in the `sg == 0` reduction
(`:494-504`); the large-batch kernel walks K through its four f32 accumulators in a
different order (`:61-70,91-105`). That changed f32 summation order can leave a numerical
delta even after product and accumulator precision match. This is a candidate explanation,
not a proven cause or floor. A deciding experiment would hold the current f32 term arithmetic
fixed, change only the K partition/reduction order toward the large-batch order, then rerun
the same b8 reference pair on the same device; compare repeated results and, if possible,
intermediate output error. No such ablation is in the archive.

Commands run:

```sh
nl -ba /Users/marco/Projects/kalsallama-wt-cok/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl | sed -n '61,105p;428,505p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-treatment.log | sed -n '34,57p'
```

## 6. Missing WARN and runtime provenance - SUFFICIENT BY TRIANGULATION, WARN REFUTED

The WARN format string is present in the built Android executable at the reported binary
SHA-256 (`60591d0b6dae91376d9b7903b07cda6267b601a106d917e1182457f5fdef1bcb`), and source
line `ggml-opencl.cpp:4487` emits it while loading the q4_K program. It is absent from all
four archived stderr captures: control, treatment, fp16 speed, and fp32 speed. That part of
the author's report is confirmed; the promised live-kernel line cannot be cited.

The replacement evidence is adequate to establish which arm the benchmark loaded and used:
(1) the fp16 control reproduces the logged pre-fix b8 metrics to displayed precision;
(2) its q4_K program cache key is created with the F16 define, while treatment's q4_K key
has no such define and has the candidate source size; (3) source dispatch at `ne1=8`
selects `_cok` (`ggml-opencl.cpp:22948,22963-22966`); and (4) the treatment changes the
result to `0.006890 / 93.138%`. The cache key hashes the full current source/options, even
though the debug print truncates its displayed key/options. This is enough by triangulation
for the archived pair, not a direct per-dispatch trace. The missing WARN remains a logging
and auditability defect, but it does not invalidate the arm identity.

Commands run:

```sh
strings -a /Users/marco/Projects/kalsallama-wt-cok/build-android-ocl-cok-acc/bin/llama-perplexity | rg 'q4_K small-batch accumulator|unrecognized KALSA_COK_ACC'
shasum -a 256 /Users/marco/Projects/kalsallama-wt-cok/build-android-ocl-cok-acc/bin/llama-perplexity
for f in /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-control.err /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-treatment.err /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-speed-fp16.err /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-speed-fp32.err; do if rg -q 'q4_K small-batch accumulator' "$f"; then printf 'found %s\n' "$f"; else printf 'absent %s\n' "$f"; fi; done
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-control.err | sed -n '295,296p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-treatment.err | sed -n '149p'
nl -ba /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-kld-740-q4-0/raw/cok-push-sha.txt
```

## Per-item verdicts

| Item | Verdict |
|---|---|
| 1. Archived pair arithmetic and label | **CONFIRMED** |
| 2. No-change claims | **REFUTED as literally stated**: the fp16 IR is identical, other kernels and metadata are unchanged, but the default IR also adds one module-scope conversion declaration. |
| 3. Selector and cache | **CONFIRMED** for the truth table and stale-ship-cache exclusion; **REFUTED** for the claim that control init compiled both selector variants eagerly. |
| 4. Price | **CONFIRMED** for the measured +8.34% b8 tail cost and 0% decode cost. The +0.235% whole-prefill figure is a cross-measurement estimate, not a measurement. |
| 5. Residual | **NOT VERIFIED** as a path floor; K-split accumulation order is the obvious remaining ablation. |
| 6. Provenance | **CONFIRMED** by the exact control metrics, compile-option trace, source/cache mechanism, and dispatch; the promised WARN line is absent. |

I would not ship this into a user-installable build yet: the b8 pair shows a 44.2x KLD improvement and the batch-rate-weighted tail penalty estimates to about 0.24% for a 3,080-token prefill, but it remains a registered partial fix and its measurement used a different model/KV/attention setup from the app. Before the pin chain moves, require an app-shaped control/treatment and tail-speed run on a catalogued Q4_K_M model such as Qwen3.5 4B with the app's q8_0/q4_0 KV and flash-attention `auto`, plus a decode check; record an explicit decision on the partial 0.0065 threshold and the unresolved residual; then verify that each engine, binding vendor, and app package pin points to the exact reviewed SHA from the preceding link, build the final APK from that exact chain, verify its embedded engine commit and SHA-256, install that same APK, and capture the runtime arm/cache identity and measured result from it. The artifact to clear is that final APK, not the separately measured `llama-perplexity` executable.
