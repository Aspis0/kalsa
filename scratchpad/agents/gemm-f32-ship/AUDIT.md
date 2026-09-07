# AUDIT — gemm f32 product fix, ship chain (33c3817c4 → 513bf4cea → 67c73d26c → 6fc14d1 / c4c5280)

**VERDICT: BANK-WITH-FIXES** (fixes 1–4 below). The kernel change is exactly the measured
variant, propagated byte-identically and vendored cleanly; the defects are in the merge
(topology + dropped catalogue entry) and in undisclosed unmeasured scope.

Hostile angle results: 1 ✓ 2 ✓ 3 ✓(disclosed) 4 ⚠ 5 ✓ 6 ✗ 7 ✓ 8 ✓. Times: all checked,
`cmp`/`diff` exit codes captured directly (no pipes).

## 1. Arithmetic — CONFIRMED (correct)
- Shipped q4_0 site: `gemm_noshuffle_q4_0_f32.cl:70` `c0 += convert_float8(B) * (float)dequantized_weights.s0;` — 16/16 sites identical (`:71-73,77-80,86-89,95-98`).
- q4_K: `gemm_noshuffle_q4_k_f32.cl:75` `c0 += convert_float8(B) * (float)dequantized_weights.s0;` — 16/16 (`:76-78, 84-87, 93-96, 102-105`).
- `convert_float8(B * w)` (probe PREC=1 refuted variant) ≠ shipped: preprocessed diff `ship.i` vs `prec1.i` exit 1, 32 changed lines — shipped is NOT the refuted variant.
- Why it works: half→float is lossless; f32 product of two half values is exact (11+11-bit significands ≤ 24-bit f32), whereas `B * w` in half rounds to 11 bits before accumulate (probe kernel's own PREC docs, `accprobe/.../gemm_noshuffle_q4_0_f32.cl:41` `#define KALSA_GEMM_ACCUMULATE(c, b, w) c += convert_float8(b * w)` — the refuted one).

## 2. Equivalence to measured — CONFIRMED (passed)
clang (`/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang`), `-x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 -E -P`:
- `diff ship.i prec2.i` → **exit 0, 0 lines**. Shipped q4_0 is preprocessor-identical to probe `-DKALSA_GEMM_PREC=2` (the measured variant: `accprobe` kernel `.cl:46` `#define KALSA_GEMM_ACCUMULATE(c, b, w) c += convert_float8(b) * (float)w`).
- Negative control `diff ship.i prec0.i` → exit 1, differs on decl + all 16 sites (e.g. `86c86` `float8 c0` vs `half8 c0`). All three compile runs exit 0, stderr empty.

## 3. q4_K — CONFIRMED honest, one PLAUSIBLE
- Diff `513bf4cea..67c73d26c` (q4k fork) touches only decl + 16 accumulate lines (grep of `[+-]` lines; stat: 21 ins/17 del, 1 file). No epilogue or dequant damage; `- mval.s0` min-offset terms untouched (`gemm_noshuffle_q4_k_f32.cl:73-74`).
- No q4_0 numbers claimed for q4_K: `gemm_noshuffle_q4_k_f32.cl:21-23` "The q4_K fidelity gain and speed cost are NOT measured for this kernel. Do not infer q4_K measurements from q4_0."; same in 6fc14d1 message ("its own fidelity and cost are unmeasured").
- **PLAUSIBLE (severity med)**: q4_K is the kernel of the app's DEFAULT model (`ModelRegistry.ts:197` `default: true` on `:162` `id: "qwen3.5-4b"`, `:165` `quant: "Q4_K_M"`), so an unmeasured 0.659x-throughput-style regression ships to every default install. Disclosed in comments but not in the APK changelog surface. Failure scenario: prefill latency regresses up to ~1.5x on the default path with no measurement gate.

## 4. Scope — CONFIRMED gap (severity med; pre-existing, now half-fixed)
Remaining `half8` accumulators, fork @67c73d26c:
- noshuffle: `gemm_noshuffle_q1_0_f32.cl:32`, `q4_1_f32.cl:35`, `q5_0_f32.cl:32`, `q5_1_f32.cl:33`, `q6_k_f32.cl:37`, `q8_0_f32.cl:35`, `q5_k_f32.cl:55`, `iq4_nl_f32.cl:55` — all `half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;`
- moe_ns: `gemm_moe_q2_k_f32_ns.cl:156`, `q3_k:157`, `q4_0:240`, `q4_1:236`, `q4_k:277`, `q5_0:238`, `q5_1:240`, `q6_k:253`, `mxfp4:283` — `half8 acc8;`
- Reachable from shipped catalogue: MoE model `LFM2.5-8B-A1B` `quant: "Q4_K_M"` (`ModelRegistry.ts:321-324`) dispatches to MoE kernels; `kernel_gemm_moe_q4_k_f32_ns` is built (`ggml-opencl.cpp:875`, source loaded `:4335-4342`) — **the MoE prefill of a shipped model still runs the half-product path this fix was proven to break**. Also `qwen3.5-4b-q3` Q3_K_M in the f32apk catalogue (`ModelRegistry.ts:200`). Default model = fixed kernel: q4_K prefill dispatch at `ggml-opencl.cpp:19524` (`src0t == GGML_TYPE_Q4_K && src1t == GGML_TYPE_F32 && !use_flat_gemv_for_large_m_q4_K(src0)`).

## 5. Vendored diff — CONFIRMED clean
- `git show --stat 6fc14d1`: exactly `native/kalsallama.pin | 4 +--`, `VENDOR_SHA`, `common/build-info.cpp`, the two `.cl` files (stat unfiltered). No unrelated drift.
- Byte-identity: `git show 67c73d26c:...gemm_noshuffle_q4_k_f32.cl | cmp - vendor/...ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl` → exit 0; same for q4_0. Zero `.cl.h` blobs in fork tree (count 0) — embed path regenerates from `.cl` at build (`ggml/src/ggml-opencl/CMakeLists.txt:25-46` DEPENDS), so no stale binary shadow possible. `GGML_OPENCL_EMBED_KERNELS` default ON (`ggml/CMakeLists.txt:265`).
- Cross-fork identity: q4_0 file at 33c3817c4 == 513bf4cea == 67c73d26c (cmp exit 0 both).

## 6. Merge — CONFIRMED defects (severity med/high for process)
- **6a (CONFIRMED, med):** `07a279b` has ONE parent: `git show 07a279b --format='%H %P' -s` → `07a279b2c... 8269aa244...` despite subject "Merge feat/moe-stream into feat/governor-in-app". Merge topology lost; second-parent ancestry unrecoverable from history (reflog: `07a279b HEAD@{2026-09-07 12:36:44}: commit: Merge ...`). Audits/`git bisect`/blame can no longer attribute the moe-stream delta.
- **6b (CONFIRMED, med):** conflict resolution dropped governor-side content in `ModelRegistry.ts`: `qwen3.5-4b-q3` present in base 8269aa2 (grep -c 1), 0 in `feat/moe-stream` tip 9d3db10, 0 in merged c4c5280. The whole entry (`Q3_K_M`, mmproj, `minRamTier` RAM-tier chain, removed block at c4c5280 diff `@@ -194,101 +209,9 @@`) is gone while `sizeClass`/`recommendForTiers` (moe side) survived. No dangling refs to the dropped id in src (git grep empty). Failure scenario: the mid-RAM recommendation tier that resolved to the q3 4B model now resolves to nothing/different model — silent catalogue shrink on a branch claiming to merge both feature sets. Fixes: restore the entry or record the intentional drop.
- **6c (CONFIRMED ok):** logit-oracle/governor machinery survived byte-identical to the parallel pin-bump repo: `governorInputs.ts` (incl. `:14` `const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {`), `benchSampling.ts`, `patches/llama.rn+0.12.8.patch` — c4c5280 blob hashes == 6fc14d1's for all three (c4c `ce49034…`, `16defd6…`, `e8313fd…`). `LlamaService.ts` differs only in comments (c4c5280 diff shows 4 comment-only hunks). Common base verified: `6fc14d1^` == `07a279b^` == `8269aa2` (same SHA in both repos).

## 7. Tracer — CONFIRMED ok
- Both fixed kernels write `float` dst via `vstore4((float4)(c0.s0, …))` epilogues (`gemm_noshuffle_q4_0_f32.cl:108-135`, `q4_k ...:110-137`) — no half-output assumption anywhere.
- Kernel sources come from the audited `.cl` only (embed regeneration or `configure_file` COPYONLY, `ggml/src/ggml-opencl/CMakeLists.txt:25-46`).
- q4_K arg wiring incl. `offsetd` and half-format B image (`ggml-opencl.cpp:18355-18398`, img_fmt `CL_HALF_FLOAT` at `:18358`) — stored-operand precision deliberately unchanged (refuted by measurement). NOT-CHECKED: search for precision-tolerance unit tests covering these kernels (none found in quick pass; no test runs performed, per mandate).

## 8. Removed behaviour — CONFIRMED clean
- `grep -rn "KALSA_GEMM"` over fork `ggml-opencl/*.cpp *.h` → no matches; `kernel_transpose_32_32` → no matches in `ggml-opencl.cpp`. No `prec=` parsers in f32apk `scripts/` or `src/`. Nothing dangles.

## Pre-existing, out of scope
- The other 17 half8-accumulator kernels (scope §4) predate these commits.
- `dequantized_weights` half4 rounding (`((bits & 0xF) - 8) * scale.s0` in half, `gemm_noshuffle_q4_0_f32.cl:66-69`) is untouched by design — the measured reference has the identical form.
- Dispatch ignominies (shape-special-cased local work sizes, `ne0==4096 && ne1==128...` `ggml-opencl.cpp:17178-17185`) predate the fix.

## Fixes required before shipping the merge branch (BANK-WITH-FIXES)
1. Record the real parents of 07a279b (re-merge or annotate); bisect/attribution is currently impossible.
2. Resolve the dropped `qwen3.5-4b-q3` catalogue entry: restore it or document the intentional removal.
3. Gate q4_K: it is the default model's kernel and unmeasured — run the KLD/same-top/throughput measurement for q4_K or disable the default until measured.
4. State in the change notes that MoE + q1_0/q4_1/q5_*/q6_k/q8_0/iq4_nl prefill paths still use the half product (LFM2.5-8B-A1B is in the shipped catalogue).

~140 lines. All claims above carry `path:line` or captured `cmp`/`diff` exit codes as quoted.
---

# Orchestrator adjudication (2026-09-07, every claim re-checked on disk)

The audit's four required fixes do not survive equally. Verdicts below are mine, from the
files, not from the report.

**Fix 1 — merge topology. CONFIRMED, and it was real. FIXED.**
`git show -s --format='%H %P' 07a279b` returned one parent (`8269aa2`). Cause is mine:
`git merge --no-commit --no-ff` followed by `git checkout -b feat/governor-ux` cleared
`MERGE_HEAD`, so the merged content landed as a linear commit and git still believed
`feat/moe-stream` was unmerged — a later merge would have tried to replay all 36 commits.
Repaired additively with `git merge -s ours origin/feat/moe-stream` as **d1e3861**:
parents now `c4c5280 9d3db10`, `git diff c4c5280 HEAD` empty (no file changed),
`git merge-base --is-ancestor origin/feat/moe-stream HEAD` true. The APK build running on
c4c5280 stays valid — identical tree.

**Fix 2 — "the conflict resolution dropped `qwen3.5-4b-q3`". REFUTED in mechanism,
correct in observation, and the observation is the intended product state.**
The catalogue really does shrink: base `8269aa2` has nine entries (`qwen3.5-4b`,
`qwen3.5-4b-q3`, `gemma-4-e2b`, `qwen3.5-2b`, `lfm2.5-2.6b`, `lfm2.5-8b-a1b`,
`lfm2.5-8b-a1b-kexp`, `whisper-tiny`, `multilingual-e5-small`, 488 lines), the merged
branch has four (337 lines). But nothing was lost in my conflict resolution — the single
conflict was six lines around `kvBytesPerToken`, and git auto-applied a deletion that
`feat/moe-stream` had made deliberately: **7b71d18 `refactor(models): C1+C2`, whose own
message reads "Prune gemma/qwen2b/qwen4b-q3/lfm8b(+kexp)"**, with orphan-dir sweeping and
tests alongside. The governor branch simply predates that prune. Taking the deletion is
what a correct merge does.

*(My own first check of this said the entry was absent everywhere and I reported the
finding as hallucinated. That check was wrong — a `printf` with nested command
substitutions corrupted the counts. The direct `git show | sed -n` read is authoritative
and the auditor was right that the catalogues differ.)*

**Fix 3 — q4_K is the default model's kernel and ships unmeasured. CONFIRMED.**
`ModelRegistry.ts` marks `qwen3.5-4b` (`Q4_K_M`) `default: true`, and `getDefaultModel()`
returns it. Nothing about `gemm_noshuffle_q4_k_f32.cl` is measured: not the fidelity gain,
not the throughput cost. It is disclosed in the kernel comment and in both commit
messages, which is necessary but not sufficient. Answered by adding a q4_K arm to the
PREREG rather than by reverting: leaving the default path on a kernel *measured* to
diverge is worse than paying an unmeasured cost on a path measured nowhere.

**Fix 4 — "the MoE prefill of a shipped model still runs the half path". REFUTED for the
product, CONFIRMED for the bench artifact.**
`lfm2.5-8b-a1b` and `lfm2.5-8b-a1b-kexp` were pruned by that same 7b71d18, so they are
absent from `feat/governor-ux`. They remain on `bench/gemm-f32-apk`, which is a
measurement artifact built from the pre-prune base, not the product. The report's cite
`ModelRegistry.ts:321-324` is past the end of the merged file (337 lines, and that region
holds `getDefaultModel`); its line numbers throughout are the 8269aa2 file's, offset ~14
from the merged one.

**The consequence worth stating plainly:** on the product branch the catalogue is two LLMs
— `qwen3.5-4b` Q4_K_M and `lfm2.5-2.6b` QAD-Q4_0 — and after this work **both of their
prefill kernels are fixed**. Coverage on the product APK is complete. The eight remaining
`gemm_noshuffle_*` and ten `gemm_moe_*_ns.cl` kernels are unreachable from it.
