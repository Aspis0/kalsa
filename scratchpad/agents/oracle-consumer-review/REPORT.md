# Hostile audit — consumer-idiom oracle (GGML_OPENCL_ORACLE), kalsa/kernel-s3-repack

Reviewed: `git diff 9dc1ec0cb..d8b6528e8` (commits `538341999`, `d8b6528e8`) on
`BigMoeOnEdge/third_party/llama.cpp`; oracle kernels; hook sites; and the
implementer's `scratchpad/agents/oracle-consumer/REPORT.md`. Binary provenance
cross-checked against the built `build-android-opencl-s3oracle/` artifacts.

Bottom line: the oracle is *mostly* sound plumbing — verbatim idiom, chunking,
sync, and reference math all check out. But there is one structural blind spot
that can directly poison the diagnosis it was built for (GEMM bin kernels),
one tolerance hole that silently admits small scale/conversion corruption, and
several smaller footprint/regression issues. The report is honest about what it
does not claim; its main omission is the bin-kernel path.

---

## Findings, ranked

### F1 — HIGH — GEMM oracle tests the source-built program; the failing app may run the offline _ila bin kernel (CONFIRMED design gap, device-dependent outcome)

The GEMM consumer dispatch prefers the binary kernel whenever the Adreno blob
library loads:

- `ggml/src/ggml-opencl/ggml-opencl.cpp:20037-20038` — `if (backend_ctx->kernel_gemm_moe_q4_0_f32_ns_bin) kernel = ...f32_ns_bin;` (and again at 20085)
- `:3789-3797` — `kernel_gemm_moe_q4_0_f32_ns_bin` is created from a precompiled binary via `get_adreno_bin_kernel("gemm_moe_q4_0_f32_ns_ila")`; load is gated only by `use_adreno_bin_kernels()` (dlopen of `libadreno-opencl-kernels.so`), **not** by any env or shape condition.

The oracle compiles only the source program (`:3804-3850`, `oracle_gemm_src = gemm_moe_q4_0_f32_ns.cl[.h] + oracle_consumer_q4_0_gemm.cl[.h]`, driver compiler) and never probes the `_ila` binary. Consequences:

- In the prescribed test-backend-ops run (`adb push` list without `libadreno-opencl-kernels.so`), the blob cannot load → the source GEMM runs → the oracle's GEMM verdict matches the running program. **Sound for that run.**
- On the production S23 app, which ships the blob (the daily log's failure analysis explicitly lists "opaque `_ila` GEMM bin kernels (q4_0/q4_1/q4_K/mxfp4)" as a suspect for q4_0 GEMM), the failing GEMM may be the *offline-compiled* binary while the oracle green-flags the *driver-compiled source*. A green `ORACLE_SUMMARY` would then actively exonerate the consumers the app actually runs — exactly the "poisons the diagnosis" failure mode this audit exists to prevent.
- GEMV has no bin variant, so the GEMV verdict does transfer to the app.

The report's residual-risk section ("same-source/same-opts, not same compiled program") covers the source-vs-oracle program difference but **never mentions the bin-kernel alternative**. This is the single biggest omission.

Failure scenario: S23 with blob lib present; `all_ok=1` on the oracle; MUL_MAT_ID still wrong in the app; the bin GEMM is the culprit and no probe exists to implicate it. The session ends with a green diagnosis and the wrong next step (e.g., rewriting source idioms).

### F2 — HIGH — the comparison band silently admits small scale / conversion corruption (CONFIRMED arithmetic, device-dependent trigger)

Compare logic at `:7633` (`tol = 0.25f * ad`) and `:7533-7538` (`recover_q`).

Let the device's effective scale be `d' = d(1+ε)` (fp16→fp32 conversion error, denormal FTZ, or any multiplicative corruption; `-cl-fast-relaxed-math`, which the real consumers and the oracle share by default, expressly permits denormal flushing on the device):

- Nibble check — `lround(gf/d + 8)` misses whenever `|(n−8)·ε| < 0.5` for every nibble n.
- Magnitude check — `|gf−wf| > max(1e-3, 0.25|d|)` misses whenever `|n−8|·|ε| ≤ 0.25`.

Arithmetic for the worst case, n = 8 (zero value, worst for nibble check) through n = 11:

| ε (scale error) | max |n−8|·ε over all nibbles | verdict |
|---|---|---|---|
| 0.001 (0.1%) | 0.008 | both checks pass for **every** nibble → `all_ok=1` |
| 0.01 (1%) | 0.08 | both checks pass for **every** nibble → `all_ok=1` |
| 0.10 (10%) | 0.8 | nibbles n=5..11 (|n−8|≤3) pass nibble check and mag check (0.3 ≤ 0.25? no — 3·0.1=0.3 > 0.25 → n=5..11: n=5,6,10,11 → 0.2·... see below) |

Corrected table for ε=0.10: nibble error |n−8|·ε ≥ 0.5 only for |n−8| ≥ 5 (n = 0,1,2,3,13,14,15); mag error > 0.25 only for |n−8| > 2.5 (n outside 5..11). So for ε=10%: n∈{5,6,7,9,10,11} **and n=8 pass both checks silently**; the rest are caught. For ε≤3%, **nothing** is caught.

The stated purpose of the band (GEMM fp16 rounding) needs only ≤ 0.0039·|d| (0.5 ulp of an fp16 product at magnitude ≤ 8|d|); 0.25·|d| is ~64× wider than needed to serve that purpose, and the excess is exactly the blind band. Additionally the raw d bytes are never dumped (only q words are), so scale corruption has no independent detection channel.

This is asymmetric with the intended target: nibble smears (the known Adreno bug class) produce ~8|d| errors and are always caught; small scale/conversion corruption is invisible. Note also a mis-attribution flip side: if the device FTZ-flushes a denormal scale, ALL values of that block flip to 0 → oracle reports `pattern=nibble_diff` (every nonzero nibble recovers to 8) — which the read table would blame on "compiled dequant defect, shift/sign-smear class" when it is actually a scale-range artifact.

### F3 — MEDIUM — no HOST_REPACK detection; attribution ambiguity when the producer is the GPU convert (CONFIRMED)

`ggml_opencl_oracle_q4_0` (`:7454`) never checks `GGML_OPENCL_HOST_REPACK`. The hook (`:8001`) sits after the producer if/else, so with HOST_REPACK unset the oracle operates on the `trans4_ns` GPU-converted buffer — the *other* suspect. All four kernels then report raw+float mismatches, and `ORACLE_SUMMARY all_ok=0` reads as "consumer dequant defect" unless the reader manually does the report's table-diff (which is only in the REPORT.md, not in the log). The prescribed command sets HOST_REPACK=1, so the shipped procedure is safe; the code itself neither enforces it nor logs its absence. One log line (`ORACLE{... producer=host|gpu}`) would close this.

### F4 — MEDIUM — `GGML_OPENCL_ORACLE=0` / `false` / `off` enables the probe (CONFIRMED)

`getenv("GGML_OPENCL_ORACLE")` presence checks at `:3808` and `:7462`. Any deployment config that sets the var to `0` "to be safe" triggers: (a) two extra device program builds at backend init with a fatal `exit(1)` on any compile hiccup (`build_program_from_source` is fatal, `:1136-1138`), and (b) the full chunked comparison on every name-matching q4_0 tensor at model load — a multi-minute stall on a production inference session, or a hard abort if the concatenated program fails to compile on-device. Value semantics would be `atoi(env) == 1`.

### F5 — MEDIUM — the tensor gate is a name heuristic that can silently skip the failing tensor (CONFIRMED)

`use_adreno_moe_kernels` (`:6531-6536`): requires `("ffn" AND "exps")` OR `"as"` in the tensor name, plus `ne01 % 32 == 0`. Verified behavior:

- test-backend-ops `test_mul_mat_id` names its weight `"as"` (`tests/test-backend-ops.cpp:4302`) → **oracle fires, and the fused consumers are dispatched** (the vehicle is valid; earlier suspicion that it was empty is retracted).
- Real KALSA MoE tensors (`blk.N.ffn_gate_exps.weight` etc.) match "ffn"+"exps" → oracle fires.
- Any q4_0 MoE weight named otherwise (e.g. `mlp.gate.exps.weight` has "exps" but not "ffn" and no "as") → oracle skips **silently** — no per-tensor "skipped=name" log line. Running the very tensor that fails in the app and seeing no ORACLE line is indistinguishable from "all clear" except by absence. A skip-reason log per non-matching q4_0 tensor is cheap and would close this.

### F6 — MEDIUM — unconditional `CL_CHECK(err)` on `clCreateImage` changes the normal path (CONFIRMED)

`:7994` — added unconditionally (not gated by the oracle env): an image-creation failure for any q4_0 MoE tensor now aborts the process at upload, where previously `err` was ignored and execution continued (a GEMV-only workload that never touches the image would have run). On devices where a large tensor exceeds `CL_DEVICE_IMAGE_MAX_BUFFER_SIZE`, this converts a previously-tolerated upload into a hard crash even with GGML_OPENCL_ORACLE unset. In practice the image size for the tested shapes (33.2M elements) is under typical limits, so low exposure; still a normal-path delta attributable to this patch.

### F7 — LOW/MEDIUM — runtime cost and 4× redundant reference computation (CONFIRMED by arithmetic)

For the biggest MUL_MAT_ID instance (2880×2880×32): nblocks = 90·2880·32 = 8,294,400 → 127 chunks of 65536. Per chunk per kernel: 2 `clEnqueueFillBuffer` + 1 ND-range + 2 **blocking** reads (8 MiB f32 + 1 MiB raw). Totals per tensor: 508 kernel launches, 1016 full-pipeline drains, and 4× (once per kernel) re-dequantization + re-repack of the entire tensor on the host — 4 × 8.29M blocks = 1.06 G dequantized values and 1.06 G float comparisons (the reference build at `:7606`/`:7612` sits inside the *kernel* loop and could be hoisted out). Rough order: tens of seconds per 2880-case, a few minutes for the MUL_MAT_ID filter, and a stop-the-world slowdown for any accidental full-suite run or real-app load with the env set. Not a correctness bug; unreported in the REPORT.md.

### F8 — LOW — UB and micro-accuracy nits (CONFIRMED, trivial)

- `:7537` — `std::lround(Inf/NaN + 8)` on a corrupted/Inf lane is undefined behavior; in practice it still flags the mismatch, so benign, but it is formally UB in the diagnostic path.
- `:3668` — `backend_ctx->moe_compile_opts = CL_moe_compile_opts;` is a dead store; the oracle uses the local string directly. Harmless.
- REPORT.md: "Enqueue, clFinish, blocking readback" — the code has blocking reads and no `clFinish` (sound on the in-order queue, props=0 at `:5660-5668`); the report itself corrects this in the chunking section. Wording nit only.

---

## Report-vs-code cross-check (implementer's claims)

| Claim (REPORT.md) | Verdict |
|---|---|
| Same source text concatenated, wrappers call the helper/macro, no second copy | CONFIRMED. Embedded `.cl.h` sources in the built `.so` are byte-identical (CRLF-normalized) to HEAD's `.cl` for all four files; wrappers contain no redefinition of `q4_0_to_fp32_packed8`/`dequantize_q4_0`; GEMM wrapper's two `as_ushort4(uint2)` halves mirror the consumer's two per-step `read_imageui` pairs. |
| Same compile opts | CONFIRMED. Both use `CL_moe_compile_opts` (`:3655-3667`, consumers at `:3757-3801`, oracle at `:3804-3850`); `GGML_OPENCL_MOE_OPTS` override applies identically. |
| Fail-fast compile | CONFIRMED (`build_program_from_source` fatal, `:1136-1138`). |
| Chunking / skip-alloc logs / no OOM | CONFIRMED. `skipped=clCreateBuffer_*` paths release the other buffer; buffer/variant allocation sized `chunk_n`; partial-last-chunk math and lane early-return verified against `dst_f32[local*32+j]` ↔ `want_f[off*32+i]` (the store index is gid-local, the reference slice is sblk-relative — consistent because `sblk = block_begin + gid`). |
| "Hashes are the chunked binary" | CONFIRMED. `libggml-opencl.so` sha256 matches `8da5316f…`; the .so contains chunked-only strings (`skipped=clCreateBuffer_f32/raw`) absent from the first commit's source. (Oddity: the .so mtime 10:37:37 predates the chunking commit's time 10:40:35 — the artifact was built from a working tree carrying uncommitted chunking; content proves the chunked code is baked in.) |
| "Does not claim to have measured the defect"; "do not sell a green oracle as the GEMM ISA is proven" | CONFIRMED and appropriate. |
| Global caveat list | Accurate, with ONE omission: the `kernel_gemm_moe_q4_0_f32_ns_bin` alternative program (F1). |

---

## Verified SOUND (silence is not ambiguity)

- **Verbatim-ness**: GEMV helper and GEMM macro are called from the concatenated same-compilation-unit wrapper; no shadowing, no duplicate symbols, no differing arg types; kernel-name → clCreateKernel strings match (`:3820-3848`); fp16 pragmas inherited from the prepended consumer sources.
- **Addressing**: oracle `block_offset = expert_offset*4 + i00*ne01*4 + i01 (+ w·ne01)` and scale index `i00*ne01 + i01 + expert_offset` reproduce both consumers exactly and match the HOST_REPACK/DUMP_Q write contract (`:7865-7915`); the oracle enumerates a superset of the router's expert selection.
- **Chunking/slicing**: buffer sizes, `block_begin` (uint, ≤ 8.3M), per-chunk want/got slices, off-by-one-free boundary condition (`off + nchunk <= nblocks`), first-bad indices `off*32+i` / `off*4+i`, source-byte diagnostic index `sblk*18+2+(j<16?j:j-16)` all verified; image path reads GLOBAL word offsets (image spans the full buffer; offset reads are legal and used by the real GEMM too).
- **Sync**: in-order queue (props=0), blocking fills/writes/reads, sequential clSetKernelArg with fully drained kernels — no races, no missed-store blindness (NaN/0xDEADBEEF sentinels + bounds-checked early return make un-written lanes visible as mismatches).
- **Reference**: `dequantize_row_q4_0` is called (single-multiply form `x0*d`, bit-exact vs the GEMV device path) and `host_repack_words` is byte-identical to the established DUMP_Q contract.
- **Resources**: both buffers released on success and on the `dst_raw` failure path; no per-chunk leaks; failures mid-loop abort loudly via CL_CHECK (debug-appropriate).
- **Inertness with GGML_OPENCL_ORACLE unset**: all additions are compile-time/no-op at runtime except the single unconditional `CL_CHECK(err)` at `:7994` (F6).
- **Binary provenance**: embedded sources in the built .so match HEAD after CRLF normalization; oracle kernel names and log strings present; link symbol `dequantize_row_q4_0` resolves against `libggml-base.so` (string + ELF checks on the ARM artifacts).

## What the report is missing, in one sentence
A green oracle run proves the driver-compiled source GEMM/GEMV dequant idioms are correct on a host-repacked buffer — it says nothing about the offline `_ila` GEMM binary the production app may actually execute, and its 0.25·|d| band is 64× wider than the stated fp16-rounding rationale, silently hiding scale/conversion corruption below ~3%.
---

# Re-review a97f7bd0c (audit fixes F1–F8)

Scope: `git diff d8b6528e8..a97f7bd0c` (248± lines in ggml-opencl.cpp; +13/+19 in the two oracle .cl files). All line numbers are from the post-fix tree. The built `libggml-opencl.so` sha `3f3df26af2375d3b…` matches the report's table; embedded `.cl.h` wrappers are byte-identical (CRLF-normalized) to the tree; new strings (`raw_d_mismatch`, `ORACLE_PATHINFO`, `skipped=name_gate`, `hostrepack=`) are present in the binary. The artifact is genuinely the audited commit.

## F1 (bin-kernel blind spot) — PARTIAL (disclosure fixed; gap structurally unfixable)

- `:3872-3873` — `ORACLE_PATHINFO{gemm_bin_loaded=%d}` logged once at backend init, inside the oracle compile gate (only when oracle was truthy at init) — correct placement.
- `:7518` — summary's `gemm_bin_loaded` reads `backend_ctx->kernel_gemm_moe_q4_0_f32_ns_bin != nullptr`; that member is initialized (`= nullptr` at :3789) and possibly set (:3797) **before** the oracle program block (:3828+) and before any set_tensor — timing and symbol are correct. No stale read.
- The oracle still cannot probe the offline `_ila` binary — no code change can fix that — but the report's new "Blind spot" section states it plainly and the prescribed push list correctly omits the blob so the test-backend-ops run sees `gemm_bin_loaded=0` and the source GEMM is what runs. This is the right mitigation. Residual watch-item: nothing enforces `gemm_bin_loaded=0` on the device; a user who pushes the blob (or runs the app) gets an oracle GEMM verdict that does not transfer, now explicitly labeled.

## F2 (tolerance band + raw_d) — FIXED for normal range, with one real subnormal edge (PARTIAL)

- Derivation verified line by line (`:7708-7715` comment): GEMM stores `(half)(nibble-8)·(half)d`; `|y| ≤ 8|d|`; for `8|d| ∈ [2^e, 2^{e+1})` fp16 ulp is `2^{e-10}`, half-ulp `2^{e-11}`; `|d| ≥ 2^e/8` gives `2^{e-11}/|d| ≤ 2^{-8} = 0.00390625` — and the binade argument is airtight because `|y|` never reaches the next binade (`8|d| < 2^{e+1}` excludes `ulp = 2^{e-9}`). `tol = 0.00390625f*ad` (`:7717`) is therefore a true 0.5-ulp upper bound for every normal-range product; the strict `>` compare means a legitimate half-ulp rounding is not a false positive.
- Blind-band arithmetic from the first audit: with the new band, any multiplicative scale error ε is caught by nibble or magnitude check for every nonzero nibble once `|n−8|·ε > 0.0039` — i.e. ε > ~0.5%, a 6× improvement over the old 3%, and the new raw_d channel closes the rest (see below). The n=8 (zero-value) rows remain inherently scale-blind, but a scale error now surfaces as `raw_d_mismatch` regardless.
- d=0: `tol=0`, `nibble_bad` gated on `d!=0`, zero-vs-zero passes, device-nonzero-vs-zero flags — correct.
- **Residual edge: subnormal `d`** — the derivation assumes `8|d|` is in the normal fp16 range. For `|d| ≲ 2^-20` (~1e-6), fp16-subnormal product rounding (≤ 2^-25, or total flush under `-cl-fast-relaxed-math`, which both programs share) can exceed `tol = 2^-8|d| = 2^-28…` → the GEMM half path reports `mag_only`/`nibble_diff` on blocks with near-zero scales — a genuine signal (the device does flush them) but one the read-table would mislabel as a shift/sign-smear defect. GEMV (f32, exact) is never affected. Not reachable with the prescribed random test data (scale ≈ 0.06–0.12); reachable with real sparse/pruned weights. The comment does not mention this regime. Not a fix requirement, but it must be known before a device run.
- Removed 1e-3 floor: no false positives — GEMV is bit-exact; GEMM error is always ≤ 2^-8|d|, which is < 1e-3 for small |d|, so the floor only ever masked genuine errors. Removal is correct.
- raw_d plumbing, checked in both .cl files (`oracle_consumer_q4_0_gemv.cl:16` / `oracle_consumer_q4_0_gemm.cl:9` store `dst_d[local] = as_ushort(hs|s)` with `local` = gid): kernel buffers/variants all append `__global ushort * dst_d` as arg 8 (`gemv_buffer`, `gemv_image`, `gemm_buffer`, `gemm_image`); host sets arg 8 (`:7669`), fills/reads `nchunk·sizeof(uint16_t)` (`:7654-7663`), compares `got_d[s] != want_d[s]` with `want_d` taken from the AoS block's first 2 bytes (`:7604`) — index math is consistent (`s` is chunk-local, matching `dst_d[local]`; global block id `off + s` for the first-bad report). Buffer released on success and on the new `dst_d` allocation-failure path (`:7543-7549`), which also releases the two earlier buffers. No new leak, no off-by-one.

## F3 (hostrepack attribution) — FIXED

- `:7517` computes `hostrepack` with the same presence test the producer uses (getenv), so the stamp matches reality. `:7520-7525` emits `ORACLE_WARNING` once per process (static bool), after the null/shape/nelem skip returns — i.e. only when an oracle run is about to happen. `hostrepack=` is stamped on every ORACLE line and the SUMMARY (`:7800, :7805`). Attribution ambiguity is now explicit in-log. Fixed.

## F4 (env parsing) — PARTIAL

- `ggml_opencl_oracle_enabled()` (`:1195-1215`): unset, `""`, `"0"`, `"false"` (ASCII case-insensitive, ≤7 chars) are off; everything else on. The original footgun (`=0`) is fixed and the compile gate `:3828` plus hook gate `:7487` consistently use it.
- Residuals: `"0 "`/`"FALSE "`/`"off"`/`"no"`/`"disabled"` all still **enable** the probe; the comment's stated contract ("unset, empty, 0, false") is self-consistent but narrower than the finding's original wording; a trailing newline from a config file (`export GGML_OPENCL_ORACLE=0⏎`) silently enables. Trivial to fix by trimming; low severity.

## F5 (name-gate silent skips) — FIXED (with a minor mislabel)

- `:8105-8111` — one `skipped=name_gate` line per distinct tensor name (static unordered_set; `<unordered_set>` already included at `:51`), only for q4_0 tensors with `ne[2] > 1` that missed the gate, only when the oracle is enabled, only in the Adreno build. Placement is inside the q4_0 branch, after the moe-branch return, before the `#endif` — correct. Nits: (a) the label says "name_gate" but the gate is `(name pattern) && ne01%32==0` — a tensor failing only the ne01 condition gets the same message; (b) `ne[2]==1` q4_0 tensors are never logged even though they can also fail the gate; (c) the log fires once per *name* even if the gate failure reason differs per shape of that name. Cosmetics, no diagnostic harm.

## F6 (unconditional CL_CHECK) — FIXED

- `:8088-8092` — `if (ggml_opencl_oracle_enabled()) { CL_CHECK(err); }` — with the oracle unset this compiles to the pre-oracle statement sequence (`clCreateImage` + proceed ignoring `err`); the only remaining unconditional deltas in the whole diff are includes, struct members, the dead-store-now-used `moe_compile_opts`, and the early-returning hook call. Normal path restored byte-for-byte.

## F7 (cost) — FIXED

- Reference build (`dequantize_row_q4_0` + `host_repack_words`) hoisted out of the 4-kernel loop to once per chunk (`:7601-7605`); per-tensor reference work drops 4×. The chunk structure, sentinel fills, kernel queueing, and index math survive the reordering intact (verified line-by-line; the outer/inner loop swap with persistent `Acc` per kernel preserves first-bad and counter semantics).

## F8 (lround UB + dead store + report wording) — FIXED

2. **Trailing-whitespace/`off` env values enable the probe** (above, F4).
3. **`skipped=name_gate` label accuracy** when only the ne01 condition fails (above, F5); plus the strict-`>` tolerance boundary means a legit half-ulp-max error exactly at the bound passes — this is the intended semantics, not a defect.

No regression found in the 82 deleted lines: they were the old per-kernel loop/accumulator text, fully re-expressed without semantic drift; all log format strings re-verified (17/17 and 9/9 specifier/argument counts match).

## Report-vs-code (updated claims)

| Claim | Verdict |
|---|---|
| sha `3f3df26a…` is the audit-fixed binary | CONFIRMED — .so sha matches; new strings present; embedded wrappers == tree |
| **"No clFinish"** sentence | CONFIRMED — code has blocking reads only, queue in-order (props=0) |
| Bin-kernel blind-spot section and `gemm_bin_loaded=` stamp | CONFIRMED — placement/timing verified; text accurate |
| `GGML_OPENCL_ORACLE=0`/`false`/`""` leave the probe off | CONFIRMED for those exact values (residuals above) |
| "Sibling hooks still presence-only" | CONFIRMED — HOST_REPACK/DUMP_Q untouched |

Bottom line: every actionable finding from the first review was addressed in-code except the genuinely un-fixable one (F1's bin kernel), which is now disclosed loudly instead. Residual risks are bounded, documented, and confined to edge regimes the prescribed test cannot hit.
---

# Review 2bdef5c7d — GGML_OPENCL_GEMV_AUDIT (in-situ production n=1 GEMV probe)

Scope: `git diff a97f7bd0c..2bdef5c7d` — 564+/5−, ggml-opencl.cpp only, no new .cl. Disk artifact verified first: `build-android-opencl-s3oracle/bin/libggml-opencl.so` sha `a8f1e2354f87564d470fe1d8399f7495af659799c604aba31199a7d9ce331fe2`, 7,921,880 B, mtime 12:40 — matches the report's table exactly. Embedded kernels unchanged (no .cl edits). The instrument is host-only; every finding below is about the host observation logic.

## Findings, ranked

### 1. HIGH — SIGN_SMEAR classifier has no discriminating power on the prescribed vehicle (CONFIRMED, arithmetic)

`ggml-opencl.cpp:20253-20264` (row_ge80 precompute) + `:20490` (`n_bad_noge80 == 0 && n_bad_ge80 > 0` ⇒ SIGN_SMEAR).

A row is flagged ge80 if **any** of its qs bytes is ≥ 0x80 (`:20256-20261`). For uniform random nibbles P(byte ≥ 0x80) = P(high nibble ≥ 8) = 1/2; a row has nb×16 bytes, nb = k/32 = 8 for the smallest prescribed case ⇒ P(row not ge80) = 2^-128 ≈ 0; for the 768/1792 grid cases nb = 64 ⇒ 2^-1024. On the test vehicle **every row of every weight is ge80**, so `n_bad_noge80 == 0` holds trivially whenever any row is bad — the "errors only in ge80 rows" condition is vacuous, and SIGN_SMEAR is appended to **every** failing case regardless of cause. The ~50% byte base rate is not accounted for.

Impact is exactly the "mislabeled pattern sends the next step down the wrong branch" case: a memory/sync defect, routing defect, or reduction defect will all be reported as `pattern=SIGN_SMEAR+…`, and the sign-smear hypothesis gets tested first. Only the additive `append_pat` structure prevents an *exclusive* mislabel, but the signal is noise on random data. Needs a per-byte expectation (bad-rate on ge80 bytes vs not, within the 16-bytes-per-block structure, with the base rate) to be meaningful.

### 2. MEDIUM — "12 cases" claim is wrong: 14 (CONFIRMED; two large hidden stashes)

The report (REPORT.md ~482-498) says the filter `-o MUL_MAT_ID -p 'type_a=q4_0.*,n=1,k='` selects exactly the 12 m=512/k=256 cases from tests/test-backend-ops.cpp:8867-8873 (Q4_0 is in base_types, :7851). It also matches two more default-list cases:

- qwen3-30b grid `:9744-9746`: `test_mul_mat_id(Q4_0, F32, 128, 8, false, 768, bs, 2048)` with bs=1 ⇒ n=1, k=2048 ⇒ vars string contains `,n=1,k=` ⇒ audit fires (k=2048, m=768, n_ex=128). AoS stash = 2048·768·128/32·18 = **113.2 MB**.
- qwen3 grid `:9764-9766`: `test_mul_mat_id(Q4_0, F32, 32, 4, false, 1792, bs, 2048)` with bs=1 ⇒ n=1 ⇒ audit fires. Stash = 2048·1792·32/32·18 = **66.1 MB**.

So the run logs 14 GEMV_AUDIT lines (not 12) and the two hidden cases push ~179 MB of AoS stash into the process — survivable on the S23 but not what the report's volume estimate implies. The `-p` filter correctly excludes the 2880×32 GEMM case (n=32) and the fusion tests (`-o` matches the root-op name), as claimed.

### 3. MEDIUM — AoS stash: no cap, no eviction, capacity retained across tests (CONFIRMED quantification)

`ggml-opencl.cpp:8008-8017` — stash = `ggml_nbytes(tensor)` memcpy'd into the pooled extra when the audit env is on and the tensor passes the name gate; release only via reset() on reuse/buffer-free, and `std::vector::clear()` **retains capacity** (`:5951`). Consequences:

- The stash is taken at set_tensor **regardless of ne12** — a GEMM-only weight (the 2880×2880×32 "as" tensor = 8,294,400 blocks × 18 B = **149.3 MB**) is fully copied even though the audit's own skip-log rejects every dispatch from it (ne12=32). Only a full-suite risk (the filtered run never uploads it).
- No cap: the audit's `too_large` guard (`:20096-20104`) limits the *readback* vectors, not the stash. A big model load with the env accidentally on = hundreds of MB of dead copies; clear()-retained capacity persists for the process lifetime. Bounded (~150-330 MB) on the S23; not an OOM in the prescribed run.
- "Zero cost when the env is off" is accurate; no behavior change off.

### 4. MEDIUM — env semantics: "1 on" is actually "anything-not-0/false/empty on" (CONFIRMED, inherited)

`ggml_opencl_env_value_enabled` (`:1196-1214`) — same behavior as the ORACLE helper it replaces; `"2"`, `"yes"`, `"off"`, `"0 "` (trailing space) all enable the probe. The report's own table ("any other non-empty string on", :391) is more accurate than the commit message's "1 on". Bit-identical to the previous ORACLE behavior: the refactor deleted exactly 5 lines (3 comment, signature, getenv) and kept the body — verified against the a97f7bd0c source. No semantic drift. MAX_DETAIL/_DUMP parse via sscanf("%d") with clamp 0-64 and default on non-numeric (`:1224-1239`).

### 5. LOW — LANE_MOD{32,64,128} divisors always co-fire (CONFIRMED by construction)

`mod_tot/bad` at `:20477-20482`, thresholds at `:20512-20525` (rmax ≥ 0.80, rmin ≤ 0.20, n_res ≥ 2). A 64-period defect makes rows `i01 ≡ r0 (mod 64)` fully bad; the mod-32 residues {r0 mod 32, (r0+32) mod 32} are then also 100% bad ⇒ LANE_MOD_32 fires alongside LANE_MOD_64; mod-128 sees 50% and stays silent. Divisors always co-fire. Additive output prevents an exclusive mislabel, but a MOD_32 tag on a 64-period defect can send the next probe at the wrong granularity (e.g., "subgroup 32" experiments).

### 6. LOW — REDUCTION_OR_SCALE clustering can silently vanish on mixed maps (CONFIRMED by construction)

Clustering test (`:20500-20509`) requires frac_near ≥ 0.80 AND (mad ≤ 0.08·|med| OR mad ≤ 0.05). A mixed map (60% rows ratio 1.0, 40% rows ratio 0.25) gives med = 1.0 with tiny MAD ⇒ |med−1| ≤ 0.08 ⇒ **no label**, even though 40% of rows are quartered. The 0.25 cluster is then reachable only through lane/routing tests. For the known failure mode (dropped subgroup contribution) the label can vanish. Heuristic; documented as such in the report.

## What is SOUND (verified against code and arithmetic)

- **Item 1 (5 deleted lines / shared env helper)**: ORACLE semantics bit-identical (old body == new helper body; edits were comment, signature, getenv(name) only); ORACLE and GEMV_AUDIT share the parse. `:1196-1232`.
- **Item 2 (inertness)**: env unset ⇒ hook (`:20685-20695`) is one call + one getenv per GEMV dispatch, returns before clFinish; no AoS resize, no vectors; case_id statics live after the early return. Not cached, but getenv-per-dispatch is negligible for a debug gate; the report's "returns before clFinish" claim is accurate.
- **Item 4 (host reference)**: the call site passes the **same locals** the arg-setting/enqueue used — offset1/offset2/offsetd, ne00/ne01/ne11/ne12/ne20/ne21, global_size/local_size, all from ggml_cl_mul_mat_id's gemv branch (`:20684-20695`); no re-derivation. ids interpretation correct (expert_id = ids[i20], i11 = i20 % ne11), OOB guarded (counted, want=0, ROUTING_OOB). AoS row pointer `(e·ne01 + r)·nb·18` reproduces the dispatch block indexing exactly (verified against the HOST_REPACK layout). Double accumulation order-insensitive at k ≤ 2048 (~1e-13 relative, four orders under the bound). Read sizes match the kernel's write extent (dst n_elem = ne01·ne20 at offsetd; src1 = ne00·ne11·ne12 at offset1 with GGML_ASSERT(ne00==ne10) upstream; ids = ne20·ne21 at offset2). The audit runs before the sub-buffer releases and reads the parent buffers at the same offsets — equivalent. The "glue=logged_not_verified" disclosure is honest and correct.
- **Item 5 (error bound)**: gamma_k = k·u/(1−k·u), u = 2^-24 — correct Higham; k=256 ⇒ 1.526e-5, k=2048 ⇒ 1.222e-4; abs_ok = 8·γ·Σ|xy| + 32·u·|want| + 1e-5. True kernel-vs-reference divergence is ~3·u·Σ per term (per-product f32 roundings + scale-multiply point), about 1.8e-7·Σ at k=256 — the 8× factor leaves ~1000× headroom: no false positives for legit f32-vs-double drift, and a 0.45-class error is ~1000× above the bound — flags. d-subnormal and y≈0 rows fall under the 1e-5 floor; NaN/Inf always bad. ku < 0.5 guard holds. Sound.
- **Item 7 (log volume)**: bounded — 1 GEMV_AUDIT_BOUND, ~14 summary lines, ≤ 4×12 GEMV_AUDIT_BAD, plus one skip line per non-matching MUL_MAT_ID case (zero extra in the filtered run, since all 14 match) — tens of KB; unfiltered suite adds a few hundred skip lines. Readback vectors capped at 8M/8M/1M elements. Sound.
- **Item 8 (readback safety)**: guards before allocation; clFinish then three blocking CL_TRUE reads on the in-order queue (props=0); each read failure logs skipped=read_* and returns **before any comparison** — no partial garbage consumed; vectors RAII-released. The audit's clFinish is on the same queue as enqueue_ndrange_kernel (`:967-980`). Sound.
- **Item 9 (report claims vs code / sha)**: sha matches disk; "no new .cl" correct; trigger ne12==1 correct; "before subbuffer release" correct; per-case detail budget (first 4 failing cases) correct; "GEMV has no bin variant" correct. Factual slips: the 12-vs-14 count and the implied memory footprint (items 2-3).

No new defects in the deleted lines (there were none beyond the env-helper extraction).

Bottom line: the instrument's core — same-variable glue, double reference dot, Higham bound, readback safety, timing — is sound and honestly documented. The two things that can actually misdirect the investigation are the vacuous SIGN_SMEAR test (item 1) and the underestimated case count/memory (items 2-3); the lane-module co-firing and ratio-clustering gaps are secondary but real.
---

# Re-review 6c822d826 — classifier + stash fixes (my 2bdef5c7d F1/F3/F5/F6)

Scope: `git diff 2bdef5c7d..6c822d826` — 242+/113−, ggml-opencl.cpp only. Disk artifact verified: `libggml-opencl.so` sha `ab8e9c64e7f4ac9ffb0640ac6fd06e6587d149fdf8f110c823bc21e4ca3fead3`, 7,918,048 B, mtime 13:02 — matches the report's table. The updated REPORT.md STEP-3 already incorporates most prior findings (14 cases, 113.2 MB peak, stash swap-empty, env semantics).

## Findings

### 1. SIGN_SMEAR per-nibble rework — PARTIAL (vacuous firing FIXED; motivating-signature reachability NOT-FIXED, report overstates at line 480)

Mapping index-correctness (CONFIRMED): per value t, `src_byte = rowb[(t/32)*18 + 2 + (j<16 ? j : j−16)]` with `j = t%32` (`:20352`) — value j<16 = low nibble of qs[j], value j+16 = high nibble of qs[j−16] — matches the ggml q4_0 layout and the oracle's established mapping. The class split is "byte ≥ 0x80", i.e. **only values 16..31 whose nibble ≥ 8**; values 8..15 (low-nibble top-bit set, the other half of the mask/shift-smear class) are counted as lt80 — a scope note, consistent with the earlier "src_ge_0x80 only on j≥16" caveat.

The `rate_ge80/rate_lt80` collapse argument is now sound **against false positives** (CONFIRMED FIXED): rates are dst-mismatch inherited onto each contributing nibble; an all-bad map gives both rates ≈ 1.0 and correctly does not fire SIGN_SMEAR. Good.

But the gate is **unreachable for its own motivating signature through a k-dot** (CONFIRMED by arithmetic): the historic DUMP_Q/ORACLE signature (value corrupted ∨ 0xF0 iff byte ≥ 0x80) was measured on *individual dequantized values* where value↔byte is 1:1. Through the GEMV dot, a row's error is `Δ = 240·d·Σ_{t: ge80} act[t]` — independent of the row's ge80 *fraction* (≈ 0.5±0.03 for k=256 iid nibbles). The flagged-row set is then a threshold on |Σ act| ≈ N(0, (k/2)σ²), a random ~50% selection with a ~50/50 nibble mix in every row ⇒ rate_ge80 ≈ rate_lt80 ≈ global bad rate — the 0.80/0.20 split needs bad-row membership ≥4× ge80-enriched, which is ~10σ for iid data. So on the prescribed random-data vehicle the label **cannot fire** — for the smear, for a lane defect, or for anything. It can only fire on structured weights (ge80-clean vs ge80-free rows separable by error threshold). The report's line 480 ("Justification: the historic signature … rate_ge80=1, rate_lt80=0") implies the threshold catches that signature; line 505 correctly discloses the blindness for random q4_0. The "Justification" sentence is overstated and should be replaced by a statement of what the label *can* fire on (real weights with magnitude-separated rows) — otherwise the green-absence of SIGN_SMEAR will be misread in the wrong direction (reader concludes "no sign smear" when the instrument cannot see it).

### 2. LANE_MOD largest-divisor logic — REGRESSED (deterministically wrong for periods 32 and 64)

`for (mi = 2; mi >= 0; --mi)` (`:20510`) checks 128 first and fires the first modulus that passes the rmax≥0.80/rmin≤0.20 split. A period-64 defect (rows ≡ r0 mod 64 bad): at mod-128 there are **two** fully-bad residues (r0 and r0+64 mod 128) and 126 zero residues ⇒ rmax=1.0, rmin=0, n_res=128 ≥ 2 ⇒ **passes** ⇒ fires `LANE_MOD_128`. A period-32 defect passes mod-128 with four fully-bad residues ⇒ also `LANE_MOD_128`. For every m ≥ 512 in the run (512/768/1792), **any** 32/64/128-period dst pattern is tagged LANE_MOD_128; the tag conveys only "some lattice exists" and points the next step at 128-lane structure that need not exist. This is strictly worse than the additive version it replaces (which emitted 32+64 and let a reader infer the period). The min/max thresholds cannot infer the period: the correct statistic is the *count* of fully-bad residues at the largest tested modulus (period = m/count; period-64 at m=128 shows 2 ⇒ 64). The report's line 460 ("A 64-period defect is LANE_MOD_64 only, not also 32") is factually false as implemented — 64-period yields LANE_MOD_128.

### 3. Ratio clustering on bad-only elements — FIXED

`ratios_bad` collects ratios of bad rows with |acc|>1e-4 only (`:20325-20331`); per-constant hit counts within the same 8% relative band (`ggml_opencl_gemv_audit_ratio_near`, `:20094-20098`); `frac ≥ 0.30` records as REDUCTION_OR_SCALE:name(frac=x), 1.0 clusters excluded, `ratio_clusters` string reports all ≥0.05 clusters (transparent). The F6 mixed-map example (60% ok + 40% quartered) now yields nrb = 40% of rows, all at ≈0.25 ⇒ frac = 1.0 ⇒ label fires. CONFIRMED FIXED. Constant list/band unchanged from before (0.25/0.5/0.75/2/4/8/16/32/64/128/1±/32/64/128), windows mutually disjoint at 8%. Minor: with nrb large and scattered random ratios, expected frac in any 8% window ≈ 0.08 < 0.30 ⇒ no spurious fires; fine.

### 4. Stash cap plumbing — FIXED

- Process-global `g_gemv_audit_stash_used` + per-extra `aos_accounted` (`:1242-1245`, `:5927`); reset() decrements and **swap-with-empty** (`std::vector<uint8_t>().swap(aos_host)`, `:5962-5974`) — releases capacity, fixing the RSS-pinning objection; accounting guard `used >= accounted` clamps properly.
- Cap `GGML_OPENCL_GEMV_AUDIT_STASH_MB` (default 512, clamp 0-4096, `:1245-1249`), skip logs `skipped=not_gemv_shape` / `skipped=cap` with bytes/used/cap (`:8031-8058`); `nbytes > cap || used > cap − nbytes` is short-circuit-safe (no underflow when nbytes > cap).
- The 14-case run needs ≤ 113.2 + 66.1 + 12×0.59 ≈ 186 MB ≪ 512 MB ⇒ none skipped. `not_gemv_shape` (ne00%32≠0, non-positive ne, ne[3]≠1) cannot skip any of the 14 (k=256/2048, 3D) — CONFIRMED.
- Accounting edge: re-set of an already-uploaded tensor uses a fresh pooled extra (alloc per set_tensor), so no double-count; cap enforced per set_tensor once. Sound.

### 5. Deleted-lines regression check and report claims — no regression; two report inaccuracies stand

The 113 deletions are all classifier/ratio/stash internals (row_ge80 precompute, old median clustering, old pattern builder, old log line); the reference dot, dequant, readback, bounds, and glue remain untouched — verified hunk-by-hunk. New GEMV_AUDIT format string verified 44 specifiers / 44 args (`:20625-20638`). Report claims: 14 cases ✓ (`:516-528`), 113.2 MB peak ✓ (`:528`), env "any other non-empty string on" ✓ (`:562`), sha ✓ (`:540`), stash skip behavior ✓ (`:511-512`). Inaccuracies: line 460 (LANE_MOD, item 2 above) and line 480 (SIGN_SMEAR justification, item 1 above). The ranked `>` pattern ordering (`fire()` sequence: ROUTING_OOB > SIGN_SMEAR > REDUCTION_OR_SCALE > LANE_MOD > BLOCK_RUNS > ROUTING_EXPERT > ROUTING_SLOT > UNSTRUCTURED, `:20485-20595`) is defensible as primary-tag arbitration — a ratio/reduction explanation precedes lane structure.

## Verdict summary

| 2bdef5c7d finding | Verdict |
|---|---|
| Item 1 SIGN_SMEAR vacuous firing | FIXED (collapse to global rates correct); reachability of the motivating signature via a k-dot: NOT-FIXED — label unreachable on random data; report line 480 overstates |
| Item 2 LANE_MOD divisor co-firing | REGRESSED — largest-modulus-first emits LANE_MOD_128 for every 32/64/128-period pattern (m ≥ 512); report line 460 false |
| Item 3 ratio clustering / mixed map | FIXED |
| Item 4 stash memory | FIXED |
| Item 5 deleted lines / report claims | No regression; 44/44 fmt args; claims accurate except lines 460 and 480 |

## Recommendation — NO-GO on the current binary for branch-deciding use

The observation layer (raw per-case numbers, `ratio_clusters`, bad-row dumps, both rates) is trustworthy and worth having on the device. But the classifier's LANE_MOD tag is now **deterministically wrong for the exact defect classes this instrument was built to localize** (the daily log's leading hypotheses are reduction/lane/sign-smear; a dropped-subgroup or lane-structure defect will be reported as LANE_MOD_128, and SIGN_SMEAR will never fire on the random-data vehicle). A green-absence of SIGN_SMEAR plus a LANE_MOD_128 tag would send the investigation to analyze 128-lane structure that does not exist — the precise failure mode this audit exists to prevent. The fix is small (infer the period from the count of fully-bad residues at the largest modulus, or emit all passing moduli with residue counts; and either drop the SIGN_SMEAR gate to a logged-enrichment statistic or state the reachability bound on the log line itself — e.g. `sign_smear=n/a_random_iid`). Re-build and re-verify (fresh sha) before the S23 session, then GO.
---

# Final check d77e82347 — LANE_MOD period inference + SIGN_SMEAR note

Scope: `git diff 6c822d826..d77e82347` — 37+/32− in ggml-opencl.cpp. Disk sha verified: `acb41c32692cae4cd95176a154b07cc2a7b3af8fc6012a0e1e79808ce8299351` — matches the claim. The diff is two hunks only: (a) BOUND text + new GEMV_AUDIT_NOTE; (b) the LANE_MOD classifier replacement (old largest-divisor loop ~32 lines → new period-inference block). Nothing else changed.

## 1. Period inference — FIXED for the named and the two named-adversarial cases; one residual mislabel class remains (PARTIAL)

Traced through the actual code (`:20497-20537`):

- **Your three synthetic cases (all CONFIRMED)**: period-32 defect → 4 fully-bad residues at mod 128 → `128%4==0`, period 32 → `LANE_MOD_32` ✓. Period-64 → 2 → `LANE_MOD_64` ✓. Period-128 → 1 → `LANE_MOD_128` ✓. Each uses rate≥0.80/tot≥4 per residue; all other residues at 0.0; `n_partial==0`; `period>=2` passes.
- **Adversarial A — 3 fully-bad residues (non-divisor)**: `128%3=2≠0` → guard blocks → no LANE tag, falls through to BLOCK_RUNS/ROUTING/UNSTRUCTURED ✓ no mislabel.
- **Adversarial B — partial (0.5-rate) residues**: a period-96 lattice at m=512 gives residues with rate 0 or 0.5 only (rows r, r+128, r+256, r+384: two pairs congruent mod 96) → `n_partial>0` → blocked ✓; a contiguous-half map (rows 0..m/2) gives ~64 partial residues → blocked ✓ (BLOCK_RUNS fires instead — correct class).
- **m < 128 (CONFIRMED conservative)**: residues need `mod_tot ≥ 4` observations; for m in [128, 512) each residue has 1-3 rows → skipped → `n_full_bad==0` → no tag. For m < 128 all residues skipped → no tag. Graceful; the run's m ∈ {512, 768, 1792} all qualify (every residue gets ≥4 rows).
- **All-bad map**: `n_full_bad=128`, period=1, blocked by `period>=2` ✓ (falls to BLOCK_RUNS — a single maximal run; the reader sees n_bad==n_elem).

**Residual mislabel (NEW, not in the named set) — the count-only inference ignores residue *spacing*.** The inference `period = 128/n_full_bad` is only valid when the fully-bad residues form one equidistributed coset `{r0 + k·period}`. Two realistic patterns satisfy all guards but are not single cosets:

1. **Contiguous band**: rows 32..63 of every 512-row window (a single 32-row store-band, 6.25% of rows) → residues 32..63 fully bad → `n_full_bad=32` → `128/32=4` → **LANE_MOD_4** — a confident period-4 claim for a pattern with no such period (a true period-4 map would hit {r0, r0+4, …}, uniformly spaced; the band is contiguous). Co-fires with BLOCK_RUNS (the band is a contiguous run ≥16), so a careful reader sees MOD_4 + RUNS and can discount it.
2. **Union of two offset classes**: rows ≡ k1 (mod 64) ∪ rows ≡ k2 (mod 64) with k1≢k2 (mod 64) — two independent hardware-lane classes → 4 fully-bad residues at mod 128 → **LANE_MOD_32**, though the true structure is two 64-period classes. **No contradicting tag** — indistinguishable from a genuine 32-period lattice by the current logic. This is the same class of error as the previous bug, one level down, and it is precisely the hardware-lane scenario the instrument is meant to catch.

The fix is the classic equidistribution check: verify the fully-bad residue set's gaps are all equal to the inferred period (or gcd of gaps == period) before emitting the tag. Without it, LANE_MOD_N asserts a period only proven for single-coset maps. Absent that, the honest wording is "LANE_MOD remains trustworthy for single-coset lattices; multi-class/band patterns can be under- or mis-labeled" — worth one line in the report.

## 2. GEMV_AUDIT_NOTE — CONFIRMED (emitted once, correct, not missable)

The note is inside the same `if (!bound_logged)` static-gated block as GEMV_AUDIT_BOUND (`:20147-20160`): any run that emits even one GEMV_AUDIT line necessarily emits exactly one GEMV_AUDIT_NOTE, once per process, before the first case's summary. Text: `sign_smear=label_reachable_only_on_structured_weights; absence_on_random_iid_excludes_nothing` — matches the code's behavior and the report's can/cannot table.

## 3. REPORT.md corrections — CONFIRMED

Lines previously flagged: the LANE_MOD row (old line 460 "64-period → LANE_MOD_64 only") is replaced by the period-inference description with all guards and the synthetic table — accurate against the code. The SIGN_SMEAR justification (old line 480) is replaced by the full can/cannot analysis including the k-dot collapse arithmetic, the ~10σ reachability bound, and the explicit "absence excludes nothing" — accurate. The can/cannot table for the iid vehicle is accurate (SIGN_SMEAR cannot; everything else can). Minor: the report's LANE_MOD row does not disclose the band/union residual from item 1 — one line to add.

## 4. Deleted-lines check — CONFIRMED no collateral damage

All 32 deletions are the old largest-divisor loop, its comment, and the old BOUND field; both hunks re-expressed 1:1. The reference dot, dequant, readback, stash plumbing, ratio clustering, and log formats from 6c822d826 are untouched; the new format strings were already verified 44/44 and are unchanged by this commit. No behavior change outside the LANE block and the BOUND/NOTE text.

## Recommendation — GO (conditional) for the device session

The decision-critical layers are now sound for the live hypothesis set: REDUCTION_OR_SCALE (ratio clusters on bad dst) is reliable and covers the two leading remaining hypotheses (dropped-subgroup/reduction-scale; the ORACLE already cleared the dequant idioms themselves); routing/run/unstructured classes are correct; SIGN_SMEAR's reachability is explicitly bounded in-log; the LANE_MOD period inference is correct for single-coset lattices — the natural shape of a per-lane hardware defect (slid-based, one residue class). The residual band/union mislabels require non-single-coset patterns and either co-fire with BLOCK_RUNS (band) or sit an order of likelihood below the current hypotheses (dual-lane) — and the raw per-case numbers, `ratio_clusters`, and bad dumps are all on the log for a reader to override a suspect tag. Condition: the session reads (and greps) `^GEMV_AUDIT_NOTE` first, treats LANE_MOD_N as "single-coset lattice at period N" not as an exclusive verdict, and checks BLOCK_RUNS+LANE_MOD co-occurrence before trusting the modulus. GO with that condition; add the equidistribution check (≈10 lines) before any second device session.
---

# Review b0684a2b6 — glue audit (semantic vs args-consistent triple compare)

Scope: `git diff d77e82347..b0684a2b6` — 267+/1− in ggml-opencl.cpp, no new .cl. Disk sha verified: `2ab3624c8f68b79aa70b74234f9b7912e0d9e275d93a4c8d85e92238ae6fcf62` — matches the report. run5/run6 logs verified on disk (`results/oracle_consumer_s23/run5/run6.log`): 12 GEMV_AUDIT lines, 1 NOTE, e2e `ERR = 0.36–0.70 > 0.000500` on all 12, per-element `max_abs ≤ 2.1e-6`, `pattern=ok` — the empirical anchor below.

## Findings

### 1. Semantic reference fidelity — CONFIRMED faithful, two coverage caveats (PARTIAL)

The cited ggml-cpu.c lines are correct in this tree: `:1685-1703` (one_chunk: `i11 = id % ne11`, `i12 = row_mapping.i2`, `dst_col = dst->data + i1*nb1 + i2*nb2`) and `:1924-1933` (grouping: `i02 = ids->data + iid1*nb[1] + id*nb[0]`). The mirror (`:20741-20758` comment; `read_id_sem` at `:20778-20786`) implements the same: `expert = stash[view_offs + token*nb1 + slot*nb0]` with token=0 (n=1), `col_sem = slot % ne11`, `di_sem = row + slot*dst_str1` with `dst_str1 = dst->nb[1]/4`. Correct: ids ordering, expert→slot, src1 column for both b variants (ne11=1 broadcast ⇒ col 0; ne11=ne20 ⇒ col=slot), dst placement `id*nb1 + iid1*nb2`. The dequant+double-dot for the semantic row uses the **stashed** src1 when present — the layout-independent source — exactly the point.

Caveats (both CONFIRMED by code reading):
- **Silent fallback collapse** (`:20813-20830`): if the src1 stash is empty, `act_sem` falls back to `act.data() + col_sem*ne00` — the same readback the args-consistent reference already uses. Since `col_sem == col_used` structurally, the semantic compare then degenerates to the args compare and `n_divergent = 0` by construction — a silent non-test (looks like "everything agrees"). In the prescribed run the src1 stash is always present (F32, tiny), so not reachable there; but nothing logs the fallback. One log line would close it.
- **Shared glue dims** (`:20840-20921`): the semantic loop reuses the same `ne20/ne11/ne00/ne01` the kernel dispatch used. A wrong-but-consistent `ne20` (truncated n_used) truncates both the kernel's slots and the semantic's slots identically — the ids/semantic compare only covers slots [0, ne20) — the truncation is invisible. The instrument cannot detect a wrong glue *dimension*, only wrong glue *values/offsets* within the dimensions it is told. State that boundary in the report ("glue dims are not independently verifiable here").

### 2. The reasoning item — what GREEN args-consistent has already exonerated, and what remains

Anchored in the actual run5/6 data (12/12 `n_bad=0`, `max_abs ≈ 1.7–2.1e-6`, `ratio_clusters=none`, `pattern=ok` vs e2e NMSE 0.36–0.70): the kernel's per-element output matches the glue-based reference to ~2e-6 — while the test's CPU reference disagrees by ~60% of signal energy. These two facts are **only** jointly satisfiable if the kernel and the audit's reference share a systematic mapping the CPU does not. Spelling out what the green verdict has already excluded, at file:line evidence:

- **SoA buffer contents** (q words + d): exonerated — oracle raw checks (ORACLE raw_mismatch=0) + the args-ref would be red otherwise.
- **Kernel per-expert weight addressing** (expert_offset = ids[i20]·ne00·ne01/32, word/d strides): exonerated — the args-ref derives the same bytes from the stash; a q4_0-specific offset bug would be red.
- **Dequant idiom**: exonerated — ORACLE green on all 4 paths.
- **src1 values as the kernel reads them** and **ids values**: exonerated — args-ref uses the same readback values; green.
- **dst write positions** and **offset1/offset2/offsetd as passed**: exonerated — kernel and audit read the same regions; a wrong-but-shared offset would be green (common-mode), but a wrong-and-unshared one would be red.
- **The arithmetic** (dot, 4-subgroup join, scale mult): exonerated to 2e-6 per element — a dropped-subgroup (0.75) or lane defect would red-flag massively.

What remains after a green triple-compare: **nothing in the kernel or the dispatch glue** — only (a) the glue *dimensions* (caveat above), (b) the producer (empty under HOST_REPACK=1, oracle-verified), (c) the test harness's expected layout/semantic itself. The implementer's framing ("quant-specific glue bug") is now contradicted by the logs: q4_0-specific addressing is byte-verified, shared glue is q6_K-green (`kernel_gemv_moe_q6_k_f32_ns` at `:22261`), and the per-element arithmetic matches the contract — so any residual defect must be a mapping the args-reference shares with the kernel — which is exactly the semantic/layout domain this instrument now measures. If the semantic compare comes back GREEN too, the defect is outside the GPU kernel entirely (harness/CPU-reference geometry) — that would be a genuine, publishable negative result for the kernel, and the run would have earned its keep.

### 3. ids stash — CONFIRMED sound

I32/F32 gate (`:5893`), partial-write accumulation (`:5900-5915`: resize-to-nbytes then memcpy at offset — handles `init_mul_mat_id_tensors`'s per-row ids writes), bounds guards (`size==0 || offset>nbytes || size > nbytes-offset`), cap accounting shared with the AoS counter (`g_gemv_audit_stash_used` decremented per-extra on reset), view resolution via `src2->view_src->extra` with fallback (`:20760-20769`), OOB read returns 0x80000000 (`:20783`). The test's ids view has view_offs=0 so the slot lookup `view_offs + slot*nb0` is exact. Sound.

### 4. src1 stash — CONFIRMED, memory quantified

The generic stash captures ALL I32/F32 tensors set on the backend (not just ids/src1). For the 12-case run: ids ≤ 8×4 B, src1 ≤ 2048×4×4 B ≈ 32 KB per case — negligible; total with the AoS stash ≈ 186 MB (113.2 + 66.1 + small) < 512 MB cap ⇒ every case gets complete stashes and GLUE_AUDIT never skips. **Risk (unfiltered runs only)**: big F32 weight matrices (4096×14336×4 = 235 MB each) in earlier tests can exhaust the shared cap → later ids/src1 stashes fail with `skipped=cap` → GLUE_AUDIT logs `skipped=no_ids_or_aos_stash` — graceful and logged, but a user running the full suite with GEMV_AUDIT on will see the glue instrument silently go dark for later cases. Documented in the code comment; worth a report line.

### 5. Triple-compare plumbing — CONFIRMED sound

Semantic compare uses the same justified Higham bound (`abs_ok = 8γ·sab + 32u|want| + 1e-5`) — appropriate (same float-vs-double question, same arithmetic). Divergence = `bad_sem && args_ok` (`:20905`) — the correct discriminator; `n_off_div` is structurally 0 for the test shapes (dst nb1 = ne01·4, so `di_sem == di_used` always) — dead code for this vehicle but harmless; `dst_str1` fallback to ne01 guards pathological strides. Format strings verified: GLUE_AUDIT 21/21 specifiers/args, GLUE_AUDIT_DIV 13/13. Log volume: 1 GLUE_AUDIT + ≤12 DIV + ≤16 IDS per case — bounded. `bcast` classification (`ne11==1 && ne20>1` ⇒ 1; `ne11==ne20` ⇒ 0; else −1) matches the kernel/CPU for both b variants; col_sem formula identical to the kernel's i20%ne11, so `n_col_div` can only fire via a semantic-vs-kernel column disagreement that cannot occur — it exists for completeness, harmless.

### 6. q8_0/q6_K path claims — CONFIRMED at file:line

Q8_0 MUL_MAT_ID dispatches to `kernel_mul_mv_id_q8_0_f32_flat` (`:21813-21875`) with a different arg set (explicit nb01/nb02/nb11/nb12/nb21/ne0/ne1 strides, offsets passed as args — stride-based, not the packed-i20-slot glue). Q6_K dispatches to `kernel_gemv_moe_q6_k_f32_ns` (`:22261`) with the identical packed-ids sub-buffer glue as q4_0 (origin=offset2, i20 slots, src1 image from offset1 sub-buffer). The implementer's read-only answer is verified true: shared glue between q4_0 and q6_K; q8_0 is a different family. Combined with q6_K passing 3/3, a shared-glue defect is disfavored — consistent with finding 2's conclusion (the residual is semantic/layout, quant-independent).

### 7. Inertness — CONFIRMED

Generic stash: one call + env check + type check per set_tensor, returns immediately when the env is off (`:5890-5893`); the audit signature grew (src1/src2/dst) with the call site updated at `:21089+3`; the GLUE block runs inside the audit gate only. No change to GEMV_AUDIT/ORACLE behavior, no new kernels, no behavior change off.

### 8. New defects / report deltas

- **Silent fallback collapse** (item 1) and **glue-dimension blindness** (item 1) — the two real coverage gaps; neither reachable in the prescribed run.
- The report's "12 cases, not 14" DEVICE RUN note (`:578`) is now empirically confirmed against this binary's filter — the two qwen3-grid n=1 cases are absent from this exe's eval list; the GLUE AUDIT section keeps the same filter. Correct.
- Report's sha table (`:740-754` old, `:46` new) matches disk and the size/mtime values; "no new .cl" correct.

## Recommendation — GO for the next S23 window

The instrument is sound for the hypothesis space the run5/6 data has already narrowed: green args-exonerated the kernel's values, addressing, dequant, ids, src1 reads, and dst writes — the only live question is the semantic/layout mapping, and the triple compare measures exactly that with an independently-sourced (stashed) reference and correct divergence logic. Conditions: (1) grep `GLUE_AUDIT` for `skipped=` first — a stash-cap skip voids the semantic leg; (2) if the semantic compare is green too, treat that as a strong negative for the GPU kernel and pivot to the test harness / CPU-reference geometry rather than re-chasing the kernel; (3) remember the glue *dimensions* are not independently verifiable — a wrong ne20/ne11 needs the IDs-per-slot dump to be conclusive. GO.
---

# Review B6 — working-tree dst-readback hook (on top of b0684a2b6)

Scope: `git diff` (working tree, uncommitted) — +287/−1 in ggml-opencl.cpp. Disk sha verified: `0111c70d0e6b6141baa7e0638777c3794c8cb43e15159e22c14a85ba564ed692`. The single deleted line is `GGML_UNUSED(tensor);` in `enqueue_ndrange_kernel`'s non-profiling branch (`:980`), replaced by the unconditional post-enqueue hook call — the only hot-path delta.

## Findings

### 1. Outcome reachability — CONFIRMED: the hook distinguishes the three reachable states, but the "decisive" (1,0) combination is structurally unreachable here; offset divergences surface via the log fields instead

Hook wiring verified: `ggml_backend_opencl_buffer_get_tensor` runs the REAL `clEnqueueReadBuffer(queue, extra->data_device, CL_TRUE, extra->offset + view_offs + offset, size, data, …)` first, then calls `ggml_opencl_gemv_check_dst_readback(queue, mem, get_off, get_size, data, size)` (`:10897-10905`) — so `returned` is computed from the caller's buffer **after** the real get filled it, and `raw` from the hook's **own** `clEnqueueReadBuffer` at `s.off` (`:1417-1430`). A `cl_mem` equal-offset/size comparison uses `get_off == s.off && get_size == s.size`; a strict-nesting fallback handles partial coverage; anything else returns `returned_match=-2` (`:1440-1455`).

For this vehicle the snap offset (`offsetd = extrad->offset + dst->view_offs`) equals the get offset (`extra->offset + view_offs + 0`), so the achievable outcomes are:

| raw_match | returned_match | meaning |
|---|---|---|
| 1 | 1 | memory at snap range intact AND the caller received exactly the audited bytes — readback path clean |
| 0 | 0 | memory **changed between audit and get_tensor** (a second writer, or a producer that rewrote the range before the test read) |
| 0 | 1 | changed in the tiny window between the get's read and the hook's re-read (near-impossible; would itself be the signal) |
| 1 | 0 | **structurally unreachable** when offsets are equal — both reads hit the same bytes; a (1,0) cannot occur |

So the prompt's "decisive (1,0)" cannot fire in the normal flow. That is not a hole for THIS question, because the decisive information arrives as: (1,1) = readback exonerated; (0,0) = a clobber exists before the harness reads dst — which is the only remaining kernel-adjacent suspect. The offset-divergence scenario is still visible: the log prints `get_off/get_size/snap_off/snap_size` (and sets `returned_match=-2` when the ranges don't nest), so any offset mismatch between the audit's read and the get's read appears directly in the line rather than as a degenerate match. The first4/last4 snap/raw/ret triples give a human-verifiable fingerprint when checksums disagree. Verdict: the instrument answers the readback question; the (1,0) framing in the spec should be corrected to "read the offsets + the three reachable matches."

### 2. Snapshot lifecycle — CONFIRMED sound for 12 sequential cases

- Register happens after the audit's dst readback and its error check (`:20569-20573`); snaps capped at 64 (`:1336`); each test yields exactly one get_tensor on the output (`test-backend-ops.cpp:1446-1447`, one read) → 12 snaps, 12 consumes, all consumed in order. At the end `emit_overlap_map` runs once (gated `overlap_logged`, `:1294`) — n_live=0, n_overlaps=0 for clean runs.
- cl_mem not retained (no `clRetainMemObject`) — the handle is only used while the owning buffer is provably alive (the get_tensor's own read just succeeded on the same handle) — no dangling-read path.
- Recycling: all prior snaps are consumed before a later case's snap is registered, and consumed snaps are skipped in every scan — a recycled cl_mem cannot false-match a live snap. Partial-overlap reads are guarded (raw reads the full snap range — safe, it is within the dst tensor; returned falls to -2 or the nested-slice branch).
- The `n_post_enq/n_post_bind` counters and POST_ENQUEUE log only scan LIVE snaps and are capped (32 lines) — bounded. The honest limitation (kernel-arg lists can't be enumerated; the wrapper matches the tensor, not the bound cl_mem) is stated in the code comment and is acceptable: for this vehicle the dst is output-only, so any legal enqueue should NOT overlap a live dst snap; an overlap is a real anomaly.

### 3. Checksum — CONFIRMED sound

FNV-1a 64 (`:1265-1272`) over host byte arrays from the same device-endianness (all three sources are host copies of the same little-endian bytes) — collision risk negligible for a byte-difference detector. Size arithmetic consistent (`register(off=offsetd, size=n_elem*4, got, n_elem)`; `check` reads `s.size` bytes). `ends4` handles n_elem < 4. Sound.

### 4. Inertness — CONFIRMED

Env off ⇒ snaps stays empty (register is env-gated) ⇒ `ggml_opencl_gemv_log_post_enqueue` returns at the `empty()` check **before the getenv** (`:6113-6115`) — the hot path pays one empty-vector test per enqueue. Env on but non-audited case ⇒ same empty short-circuit. No change to the GLUE/GEMV/ORACLE logic; the only −1 line is the UNUSED macro. The POST_ENQUEUE guard `!ggml_is_quantized(tensor->type)` (`:6130`) avoids type-punning quantized extras. Sound.

### 5. All-green semantics — the report MUST state this in advance

If the device run shows, for all 12: `raw_match=1, returned_match=1`, `get_*==snap_*`, no POST_ENQUEUE/OVERLAP — then: the device memory the kernel wrote is byte-identical at get_tensor time, the single writer preserved it, and the harness received exactly the audited bytes. Combined with the already-green semantic/args/ids/src1 compares, the GPU kernel and the OpenCL readback are fully exonerated, and e2e-red then implicates **the harness side**: either (a) the CPU reference (`ggml-cpu` MUL_MAT_ID for this shape — relevant because this tree carries S3 `ggml-cpu` experiments, i.e., the CPU path is not pristine upstream), (b) the NMSE computation/array sizing, or (c) the harness graph geometry. The next single observation that discriminates a vs b/c: dump the harness's own `out1` (CPU) and `out2` (GPU) buffers for one failing case and compare each against the audit's semantic reference — the side that disagrees with the semantic is the culprit, and (a) is re-testable on PC with a CPU-only run of the same `test_mul_mat_id(Q4_0,…,512,1,256)` case (no OpenCL at all) against the stored run5 ids/src1. This must be written into the session plan so the run cannot end uninterpretable.

## Load-bearing source-walk claims — verified (CONFIRMED) at working-tree lines

- Single enqueue on dst + generic path unreachable: the q4_0 `use_adreno_moe_kernels` branch covers both gemv (`:21328`) and gemm (`:21388`) and ends in a `return;` (`~:21512`, before the `} // fallback to generic Q4_0 MoE kernel`); the fallback (`kernel_mul_mv_id_q4_0_f32_8x_flat`) is unreachable for name-gated MoE tensors. The gemm branch's reorder kernel writes `prealloc_act_trans`/`src2_emap` (not dst). No second writer on dst — CONFIRMED.
- Harness: one `ggml_backend_tensor_get` per output tensor per test (`test-backend-ops.cpp:1446-1447`); run5/6 logs show exactly one GEMV_AUDIT line per case — single dispatch, single read — CONFIRMED.

## Verdict summary

| attack item | verdict |
|---|---|
| 1 outcome distinguishability | CONFIRMED (three reachable states + offset fields; (1,0) unreachable — spec wording should say so) |
| 2 snapshot lifecycle | CONFIRMED sound (12/12 consume, no recycling false positives, partial-overlap guarded) |
| 3 checksum/arithmetic | CONFIRMED sound |
| 4 hot-path inertness / −1 line | CONFIRMED (empty-vector short-circuit precedes getenv; only the UNUSED line removed) |
| 5 all-green semantics | must be pre-stated: exonerates kernel + readback; next discriminating step = dump out1/out2 vs semantic, PC CPU-only rerun |

## Recommendation — GO to commit (with one edit) and GO for the next S23 window

Commit-worthy as-is; the only required change is textual: the hook's comment/spec should describe the three reachable match outcomes and the offset fields as the real decision surface (not the (1,0) idealization), so the reader on the device doesn't wait for an outcome that cannot occur. Then: GO for the S23 window — the instrument cleanly decides "readback/kernel exonerated vs a pre-read clobber," and the session plan must include the out1/out2 dump (and the PC-only CPU reference check) so that the all-green branch ends in a concrete, pre-planned next step rather than a dead end.
---

# Review RESTORE FIX PLAN — Adreno MoE get_tensor restore design (no code yet)

Scope: REPORT.md ~1018-1215 (design only). Verified against cvt.cl, ggml-opencl.cpp, ALIVE.md, both local memory roots, and the roundtrip log quoted in the plan.

## 1. Blast-radius map — CONFIRMED (all citations verified)

- **The 5 as_ushort8 occurrences are exactly the 5 the plan names**: `cvt.cl:382-383` (q4_0), `574-575` (q4_1), `789-790` (q5_0), `1020-1021` (q5_1), `1612-1613` (mxfp4) — grep confirms these are the ONLY scalar-private `as_ushort8` restore aliases in cvt.cl. K-quants are array-backed (`uint4 qv[8]` / `uint4 qlv[8]` at 1060, 1125, 1185, 1266, 1313, 1395), exactly as claimed. The q5_0/q5_1 qh paths are byte-wise (`(uchar)(qh>>(8k))` at ~774-777, ~1004-1010) ✓ "qh is not the culprit" ✓.
- **Producer dispatches**: q4_0 `kernel_convert_block_q4_0_trans4_ns` at `:8366`; restore selections in the MoE get_tensor path at `:9914` (q4_0), `:10015` (q4_1) and analogues; program_cvt family wired at `:1658-1712`; iq4_nl restore is a separate no-shuffle kernel (`:1712`) with direct global-copy / byte-wise unpack at `cvt.cl:2339-2357` / `2384-2405` — genuinely outside the trans4 blast radius ✓. MoE gate at `:6960-6964` ✓.
- **Producer contract comments**: present at the cited regions with the exact byte formulas (`byte[i] = (qs[2i]&0x0F)|((qs[2i+1]&0x0F)<<4)`, `byte[i+8] = ((qs[2i]&0xF0)>>4)|(qs[2i+1]&0xF0)`, "low nibbles fill words 0-1, high words 2-3") — verified at 323-329, 512-522, 710-724, 939-952, ~1545-1562 (plan's line numbers are within ±8 of the actual); the producer comments even state the plan's diagnosis ("assembling uint words in registers first is miscompiled"). All map rows CONFIRMED.

## 2. The proposed rewrite — loop is the EXACT inverse (CONFIRMED by hand), but the `uint4 q_block[1]` shape is the one genuine risk (see crux)

**The loop arithmetic is byte-for-byte the loop the current restore ALREADY runs** — the only change is `ushort8 post_block = as_ushort8(q_block)` → `uint4 q_block[1]` + alias. So its correctness is brute-force established by the existing code: task no. Hand-trace with value k=3 and k=19, QK=32:

- Contract: k → word ⌊k/8⌋, nibble k%8. Producer fills word0 bytes0-3 (out[0..3]) with nibbles of values 0-7, word1 with 8-15, word2/3 with 16-31. Value 3 = out[1] high nibble; value 19 = out[9] high nibble.
- Proposed: i=1 → `lo = packed[1] = out[1]`, `hi = packed[9] = out[9]`; `dst_qs[2] = (out[1]&0x0F)|((out[9]&0x0F)<<4)` = value 2 low, 18 high ✓; `dst_qs[3] = ((out[1]&0xF0)>>4)|(out[9]&0xF0)` = value 3 low, 19 high ✓. General inverse verified algebraically: producer `out[i] = (qs[2i]&0x0F)|((qs[2i+1]&0x0F)<<4)` ⇔ restore `qs[2i] = (out[i]&0x0F)|((out[i+8]&0x0F)<<4)`, `qs[2i+1] = ((out[i]&0xF0)>>4)|(out[i+8]&0xF0)` — the proposed loop is this exact inverse. ✓
- The `packed[i]/packed[i+8]` split maps low-nibble words 0-1 (bytes 0-7) vs high words 2-3 (bytes 8-15) — consistent with the ne01-strided loads (`src_q[offset + w·ne01]`, w=0..3). QK/4 = 8 for all five quants (QK5_0/QK5_1/QK_MXFP4 = 32). q5's qh untouched. ✓

**THE CRUX — `uint4 q_block[1]` is not provably safe and is the one spot I would not ship as written.** OpenCL C imposes no memory-semantics guarantee on a single-element local array; the Qualcomm front-end that turned `as_ushort8`'s private register into a broken byte view can equally scalarize `uint4 q_block[1]` back into the same private alias (the byte pointer over a register-mapped blend). The precedent used to justify "safe" (q4_K/q6_K) is `[8]`-element arrays, and the proven-correct *producer* avoids the alias entirely with straight byte-wise global stores. Recommended safest formulations, in order:

1. **No alias at all** — read the SoA bytes directly as the producer writes them (uchar loads from `src_q` viewed as bytes at `offset*4 + 4w + j` and `offset*4 + (2+w)*4 + j` for w=0..1, j=0..3), then run the identical loop. Mirrors the proven-safe producer exactly; removes the entire private-alias surface.
2. If aliasing must be kept for minimal diff, use a genuinely multi-element array (`uint4 q_block[4]`, even with only [0] used) to match the measured-clean [8] shape — **do not ship `[1]`**; it is an unverified middle ground and the retrial would not distinguish it from the broken scalar form.
3. Explicit per-byte integer extracts from the four words (no `u_char*` anywhere) — always correct but the least readable.

The plan currently argues `[1]` as "the q6_K-style safe idiom"; that is overstated — q6_K's `qlv[8]` is a different shape. Verdict: PARTIAL — inverse correct, array size selection the one real risk; the change is ~10 lines either way, so take formulation 1 or 2.

## 3. bitselect reconstruction — CONFIRMED correct and honestly labeled

`lo = bitselect((x0&0x0F), ((x1&0x0F)<<4), 0xF0)` selects bits 0-3 from a, 4-7 from b ⇒ `(x0&0x0F)|((x1&0x0F)<<4)` = producer byte[i] ✓; `hi = bitselect(((x0&0xF0)>>4), (x1&0xF0), 0xF0)` = byte[i+8] ✓. `bitselect` is an OpenCL C builtin defined for uchar (since CL 1.0; CL3.0/Adreno 740 fine), per-bit ternary on uint-promoted operands cast back — well-formed. "Reconstruction, not recovery" is accurate (no historical blob is being copied; it is re-derived from the contract). ✓

## 4. Retrial matrix — two forensic gaps (CONFIRMED absent), one PLAUSIBLE expectation

**(a) The probatory f1/f2 link is NOT in the matrix — flag, it is the missing retrial.** None of the six retrials dumps the judge's consumed `out1` (CPU) / `out2` (GPU) buffers for a failing case and re-derives the ERR from those exact bytes. Without it, the chain "get_tensor bytes → judge's out2 → reported ERR" is still inferred, not demonstrated — the same gap my B6 review flagged (item 5) and which the implementing session needs before calling the all-green-with-red-e2e result interpretable. Add retrial 7: for one failing case, dump out1/out2 raw and compare each against the (stashed) semantic reference; whichever disagrees with the semantic is the culprit.

**(b) Production-unaffected demonstration on the BMoE engine is NOT in the matrix.** The fix touches only restore kernels, so inference cannot use them; but nothing in the matrix proves the real engine (BMoE app) is byte-identical after the change. Add (or explicitly defer) a single BMoE inference smoke with the corrected .so — cheap and closes the "did the fix touch a hot path" question. Flag as missing.

**(c) Expected mismatch `94208/294912` under GPU producer — PLAUSIBLE, not derived.** 94208 and 61440 were measured with the BROKEN restore (`roundtrip_AB_stats.log:31,80`, quoted at the top of the plan). A corrected restore reads the same corrupt words but reconstructs qs bytes differently — the exact pattern/count of mismatches against the original AoS is a property of the *restore* as much as the producer, so 94208 is an expectation, not a consequence; the retrial should say "expected ≈94208 (re-measure; the broken-restore number is not a bound)". The fixtures' math is right (256·512·4 elements /32 ·18 = 294,912 bytes ✓) and the plan correctly insists the 94208 class is a producer violation, not a restore regression — but the count itself must be re-derived at runtime.

## 5. Paper-trail list — CONFIRMED complete for the accessible stores; the `adreno-moe-two-defects` reconciliation is left to the human

- **ALIVE.md:427-460** verified — the section says exactly what the plan attributes: "real defect finally located", "every narrow quant ... numerically wrong in production", "two independent defects and they partially cancel", "The binding defect is in the compiled gemv/gemm consumers", the −55% table as shipped-fix, and the `0.4497` HOST_REPACK "proof". The plan's rewrite targets for ALIVE.md are accurate. ✓
- **PLAN.md blocks**: the plan enumerates 396-620 and 1045-1324 with specific claims; spot-checked against what ALIVE.md and the plan narrative carry — the targets are real. (A full PLAN.md read is outside this scope; the cited line ranges are consistent with the roundtrip evidence.)
- **`adreno-moe-two-defects` memory record**: I searched `~/.pi/agent/memory` (MEMORY.md, SCRATCHPAD.md, all daily logs incl. 2026-08-19), and `~/.pi/memory/memory.db` (semantic/lessons tables, FTS) for `adreno`, `moe`, `restore`, `get_tensor`, `two-defects`, `producer`, `consumer` — **zero hits in every store**. The plan's "no matching record in this workspace / local file-backed memories DB" is CONFIRMED against both local roots. The caller's statement that this record "was ALREADY rewritten today" cannot be confirmed against the accessible stores — either it lives in a third (external/not-visible) memory system, or it was a transient note that was never persisted. This is a genuine unresolved discrepancy between the reviewer/plan and the caller: flag it for the human to reconcile, and note the plan's conditional instruction ("if that external record exists, its rewrite target is X") is the right hedge — but the plan should not claim the sweep is exhaustive if a non-local memory backend is in use.
- **The −55% re-grounding** (retrial 6) is correctly designed: keep the measured deltas, remove the causal label, split producer/reverse/e2e arms. ✓

## Verdict summary

| item | verdict |
|---|---|
| 1 blast-radius map | CONFIRMED (every cited line, the 5-as_ushort8 discriminator, the array-K-quants, iq4_nl exclusion, producer comments) |
| 2 proposed rewrite / crux | loop is the exact inverse (hand-traced, k=3/19); `uint4 q_block[1]` is the one real risk — recommend no-alias byte-wise or ≥[2]-element array, not [1] |
| 3 bitselect | CONFIRMED correct, portable, honestly labeled |
| 4 retrial matrix | two gaps: probatory f1/f2 dump missing (add), BMoE production-unaffected smoke missing (add or defer); 94208 expectation PLAUSIBLE not derived |
| 5 paper trail | CONFIRMED for local stores; `adreno-moe-two-defects` absent everywhere accessible — the caller's "rewritten today" is unverifiable here — reconcile externally |

## GO / NO-GO for implementation

**GO to implement the fix — with three required amendments before the S23 run:** (i) change `uint4 q_block[1]` to the no-alias byte-wise global-read form (formulation 1) or at minimum a ≥[2]-element array — the [1] shape is the single place the whole diagnosis could silently reproduce; (ii) add retrial 7 (out1/out2 dump vs semantic) and retrial 8 (BMoE inference smoke, or an explicit deferral line); (iii) rewrite retrial 1's "expected 94208" to "expected ≈94208, re-measured". With those three, the design is correct and the evidence chain (round-trip byte proof, forensic audit, and the verified blast radius) supports implementation. NO-GO on the *current text* only because of the [1]-array crux and the two matrix gaps — none of which block the kernel edit itself, only the interpretation of the retrials.
