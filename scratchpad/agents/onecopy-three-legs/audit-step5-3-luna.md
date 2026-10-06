# Hostile audit: one-copy three-leg step 5.3

Date: 2026-10-06  
Target: /Users/marco/Projects/kalsallama-gov-onecopy, branch feat/governor-onecopy  
Range: 2b8b39ca3..8b2d864f4. The actual log contains eight commits (9512003a7, 93d7dab85, f21f5b539, e6e3ed854, 19d8d9cbe, 340461655, a9ed9adaf, 8b2d864f4), not seven.  
Read-only. No source edits, builds, tests, device access, or adb. Existing untracked CMakeUserPresets.json was left untouched.

At the final status check, the target checkout had new unstaged edits in seven tracked files (plus the pre-existing untracked preset). They were absent from the initial status check, appeared during this audit, and were left untouched. Findings below apply to the requested committed range, not those out-of-range working-tree edits.

## Executive result

For ordinary finite default parameters, the two-model path’s selected engine and hop rule match v1 across finite CPU/NPU headrooms, any unknown CPU/NPU headroom, window 0, later windows, safety states, a disabled NPU lane, and decode_hop_tokens == 0. The default mask is NPU+CPU; GPU headroom is ignored. The old and new logs are not byte-identical: the new finite-headroom message prints a GPU value. The decision itself matches.

The C++ binding call with two arguments remains source-compatible when compiled against the new staging header: its third argument is supplied by the default. This is not binary compatibility; rebuild consumers against the new declaration and implementation. The extension header explicitly permits C++ and breaking changes, so the default argument is legal in this header.

The principal new correctness risks are sticky floor demotion, permitting an empty candidate mask, per-turn GPU-headroom state not being reset, and throughput floors using decode timings that exclude the hop commit.

## Earlier step-5.2 audit fixes

These are source reviews only; nothing was built or run.

| Prior item | Verdict on claimed fix | Evidence read |
|---|---|---|
| F-01 leg count/null/duplicates | CONFIRMED closed | src/llama-governor-legs.cpp:25-39: “requires a leg array”; “at most three”; duplicate engine check. |
| F-02 shared YaRN params | CONFIRMED closed | src/llama-governor-legs.cpp:51-55: compares rope scaling, frequency scale, and original context before constructing legs. |
| F-04 shared KV | CONFIRMED closed | src/llama-governor-legs.cpp:42-45: rejects non-null ctx_other. |
| F-05 constructor cleanup | CONFIRMED closed | src/llama-governor-legs.cpp:59-64, 115-123: reserve before context creation; placement lookups are inside the cleanup try; catch frees all recorded contexts. |
| F-07 forced safety bypass | CONFIRMED closed | src/llama-governor.cpp:397-408: returns any nonzero select_decode result before calling forced_rotate. |
| F-08 forced GPU on two-model form | CONFIRMED closed | src/llama-governor.cpp:53-59: two-model constructor rejects forced rotation. |
| F-09 short reference | CONFIRMED closed for gate | tools/governor-bench/governor-bench.cpp:266-281: fails if reference rows are fewer than run rows. Both paths use --gen; the L path collects the prompt row plus each of generate_tokens - 1 generated rows (governor-bench-run.cpp:423-424, 434-477), matching run_turn’s row count. |
| F-10 informational-only KLD | CONFIRMED closed | tools/governor-bench/governor-bench.cpp:283-294: nonzero divergence or mean above threshold returns 1. |
| F-11 allocation before file validation | CONFIRMED for original case; residual cap finding below | tools/governor-bench/governor-bench-logits.cpp:83-110: bounds dimensions and checks exact file length before resize. A valid near-2-GiB file can still request a near-2-GiB allocation. |
| F-12 generic device selection | CONFIRMED closed for arm L | tools/governor-bench/governor-bench-run.cpp:68-76, 129-130: exact names HTP0 and GPUOpenCL. Other arms retain their generic accelerator selection. |
| F-13 cadence/hybrid proof | CONFIRMED closed | tests/test-governor-legs.cpp:128-140, 171-203: asserts hybrid memory, expected context each step, and exact hop count. Test was not run. |

## Findings

### H-01 — Two-model policy parity and third argument

**CONFIRMED · P3 — selected decisions are byte-identical under the default two-leg inputs.**

At v1 (git show 2b8b39ca3:src/llama-governor-policy.cpp:448-493):

> const bool headroom_rule = std::isfinite(decode_cpu_headroom_c_) && std::isfinite(decode_npu_headroom_c_);
>
> if (window == 0) { decode_hop_leg_ = llama_governor_engine::NPU; }
>
> if (other - current >= k_hop_hysteresis_c) {
>
> decode_hop_leg_ = window % 2 == 1 ? llama_governor_engine::NPU : llama_governor_engine::CPU;

At v2 (src/llama-governor-policy-hop.cpp:43-47, 91-124):

> bool decode_leg_present_[3] = { true, false, true }; (declared at src/llama-governor-policy.h:185-187; enum indexes are CPU, GPU, NPU)
>
> if (!std::isfinite(headroom_of(present[i]))) { all_known = false; }
>
> if (window == 0) { decode_hop_leg_ = present[0]; }
>
> effective_of(present[best]) - effective_of(decode_hop_leg_) >= k_hop_hysteresis_c
>
> decode_hop_leg_ = present[(window + n_present - 1) % n_present];

With default heat weight and heat values both zero (src/llama-ext.h:330-336), the new effective-headroom comparison has the same 4 C inclusive edge. With the mask {NPU, CPU}, any CPU/NPU NaN or infinity selects the same fallback: even window CPU, odd window NPU. The third GPU value is ignored because GPU is absent. The active/lane/safety gate and window calculation are unchanged at src/llama-governor-policy.cpp:418-449; both reset the active rule to CPU when the hop is inactive. The policy test samples these paths, but does not compare binaries or exhaust all float inputs.

There are two qualifications to the “byte-identical” comment:

- Log bytes differ. V1 prints CPU and NPU headroom; v2 prints CPU, NPU, and GPU at src/llama-governor-policy-hop.cpp:129-139.
- This proof assumes finite heat parameters. With decode_heat_weight == 0 but a NaN/Inf per-leg heat field, 0 * heat is NaN at line 87, so the finite headroom check passes but the effective comparison does not behave like v1. The new params are public and are not validated here. This is outside the default configuration.

**Default argument / binding:** src/llama-ext.h:3-5 says this is a C++ staging header where breaking changes are allowed; its new declaration is at lines 633-637. The binding source still calls two arguments (~/Projects/llama.rn-kalsa-gov-platform/cpp/rn-governor.cpp:117-122). C++ default arguments are legal and that unchanged call compiles against the new declaration. It supplies NaN for GPU. The current binding vendor still has the old two-argument header (vendor/llama.cpp/src/llama-ext.h:508-511), so this branch does not itself update the shipped binding. An already-compiled consumer is not ABI-compatible with a changed function signature; rebuild it.

### H-02 — Finite-logit KL formula is corrected; extreme finite maxima can overflow

**CONFIRMED · P3 ·** tools/governor-bench/governor-bench-logits.cpp:31-58

> const double log_z = std::log(sum_cur) - std::log(sum_ref) + (max_cur - max_ref);
>
> const double log_p_q = static_cast<double>(ref[i]) - static_cast<double>(cur[i]) + log_z;

For finite ordinary logits, the sign is now correct:
log p - log q = (ref - cur) + LSE(cur) - LSE(ref).
The normalizer term at line 50 has the right sign.

Residual edge: max_cur and max_ref are floats, so (max_cur - max_ref) is evaluated in float before being promoted into the double expression. Opposite-signed finite extreme float maxima can overflow this subtraction to infinity, although the mathematical difference and KL fit in double. Lines 145-147 then treat that as a divergent row. Real model logits are unlikely to reach this range, hence P3.

-inf behavior is otherwise deliberate: zero-probability reference entries are skipped; a positive-reference-probability entry with current logit -inf yields infinite KL and is rejected; all--inf rows become non-finite and are rejected.

### H-03 — KL test has a vacuous random case and no non-finite cases

**CONFIRMED · P3 ·** tests/test-bench-logits.cpp:36-55, 142-150

> // rows may legitimately diverge (argmax mismatch); every compared row must still be non-negative
>
> if (mean < 0.0 || max < 0.0) {

check_nonnegative never requires n_compared > 0. For the 128000-class random case, an argmax mismatch at row zero is overwhelmingly likely, so it can pass with the initialized zero mean/max without exercising the KL accumulation. The two-class closed form, identity, range equivalence, and shift-invariance cases are useful; there is no explicit NaN, -inf, +inf, or extreme-finite test for the code’s stated rejection paths.

### H-04 — Floor demotion can strand a leg permanently

**CONFIRMED · P2 ·** src/llama-governor-legs.cpp:193-213; src/llama-governor.cpp:386-394; src/llama-governor-runtime.cpp:229-283

> return static_cast<float>(tokens) * 1000000.0f / static_cast<float>(us) >= floor_tps;
>
> if (!legs.empty()) { refresh_decode_legs(); }
>
> void llama_governor::reset_prefill_stats() {
>
> stats_.decode_us_cpu = 0; (this reset is in clear_cache, not reset_prefill_stats)

The floor decision uses cumulative per-leg samples and refreshes the mask at construction and at a new multi-token prefill. reset_prefill_stats, called per completion, resets the hop clock but not the per-leg totals. A leg demoted below floor stops being selected in free-running mode, so its accumulated rate cannot recover from later fast windows. It remains dropped until cache clear/reinitialization or an external mask change. One slow initial decode can be enough if it leaves the cumulative rate below floor. Thermal waits and prefill timing do not enter these decode counters; the first actual decode/warm-up does.

The “every turn” refresh is also not guaranteed for a fully cached turn whose first batch is one token: the refresh site is only the is_prefill && last_phase != Prefill branch at lines 386-394.

### H-05 — Empty availability mask contradicts the CPU-always-present invariant

**CONFIRMED · P2 ·** src/llama-governor-legs.cpp:199-213; src/llama-governor-policy-hop.cpp:49-65; src/llama-governor-policy.cpp:441-449

> leg_ctx(llama_governor_engine::CPU) != nullptr && candidate(..., p.decode_floor_tps_cpu)
>
> return nullptr; // unreachable: the CPU leg is always present

The CPU context is mandatory, but the floor can set its mask bit false; the public llama_governor_set_decode_legs also accepts all-false (llama-governor-runtime.cpp:311-316). If every floor rejects its leg, hop_decide returns null without changing decode_hop_leg_. select_decode then still returns that stale engine. The CPU fallback may run despite its floor, or an ineligible physical leg may keep running and be counted under its old engine. There is no fail-closed or “keep CPU” rule for this state.

### H-06 — GPU headroom is not reset with the other per-turn samples

**CONFIRMED · P3 ·** src/llama-governor-policy.cpp:495-502; src/llama-governor-policy.h:182-184

> // The headroom sample is per-turn state like the window: dropped with it
>
> decode_cpu_headroom_c_ = ...quiet_NaN();
>
> decode_npu_headroom_c_ = ...quiet_NaN();

The new decode_gpu_headroom_c_ field is not reset. The comment is now false for the third leg. Usually a fresh three-value sample replaces it, and a missing file initializes all three locals to NaN, so this is latent; with a one-leg GPU candidate and no fresh sample, a prior turn’s GPU value can still be treated as current.

### H-07 — Leg floors omit hop commits, while bench window throughput includes them

**PLAUSIBLE · P2 ·** src/llama-governor.cpp:464-485, 529-550; tools/governor-bench/governor-bench-run.cpp:453-461

> if (!commit_side(last_ctx, target, *src, *state, direction)) {
>
> const int64_t t0 = ggml_time_us();
>
> const uint64_t decode_us = static_cast<uint64_t>(ggml_time_us() - t0);
>
> const int64_t t0 = ggml_time_us();
>
> const uint64_t dt = static_cast<uint64_t>(ggml_time_us() - t0);

Governor per-leg decode_us starts after the commit and is used by refresh_decode_legs to decide whether a leg meets its tok/s floor. The bench’s observed window dt wraps the entire llama_governor_decode, including policy and KV commit. Thus reported window tps and the floor’s rate measure different work; a costly incoming hop is excluded from floor eligibility. The governor timing also ends after record_side, so it includes a small amount of post-decode bookkeeping. This is appropriate only if the floor intentionally means raw context decode throughput rather than experienced per-window throughput.

The timer/stat instrumentation adds a start and end clock read plus per-leg counter updates on each decode; the previous decode path only started this timer for prefill. No performance measurement was run.

### H-08 — KLD helpers divide before validating current vocabulary size

**CONFIRMED · P3 ·** tools/governor-bench/governor-bench-logits.cpp:120-125, 162-173

> if (n_vocab_ref <= 0 || ref.size() < cur.size()) {
>
> 0, cur.size() / n_vocab_cur,

logits_kld divides by n_vocab_cur before the callee’s validation rejects a zero or mismatched vocabulary. n_vocab_cur == 0 can cause division by zero when the helper is called directly. The production bench obtains a positive model vocabulary, but the helper should reject invalid dimensions first. The range helper also checks row_begin + row_count without overflow protection at lines 123-124; adversarial size_t inputs can wrap the bound check before pointer arithmetic.

### H-09 — Logits reader still permits a very large valid allocation

**CONFIRMED · P2 ·** tools/governor-bench/governor-bench-logits.cpp:90-110

> n_tokens <= (INT32_MAX / static_cast<int32_t>(sizeof(float))) / n_vocab;
>
> if (std::fseek(in, 0, SEEK_END) != 0 || std::ftell(in) != expected_bytes) {
>
> rows.resize(static_cast<size_t>(n_tokens) * n_vocab);

The prior small-file/malicious-header case is fixed by checking exact file length before allocation. There is still no reasonable maximum file or row count: a valid dump close to 2 GiB passes and is allocated in one vector, so an accidental or hostile large reference can exhaust memory. This is a residual resource bound, not a failure of the specific prior fix.

### H-10 — In-place headroom-file updates can yield a mixed but parseable sample

**PLAUSIBLE · P3 ·** tools/governor-bench/governor-bench-run.cpp:374-389

> const int parsed = std::fscanf(in, "%f %f %f", &cpu, &npu, &gpu);
>
> if (parsed != 3) { cpu = npu = gpu = ...quiet_NaN(); }
>
> llama_governor_set_decode_headroom(governor, cpu, npu, gpu);

Missing files and fewer than three parsed values correctly feed NaN (the setter is outside the fopen block); NaN/Inf values trigger alternation through isfinite. But a concurrent in-place writer can expose three parseable fields from a partially replaced line, including a mixed old/new sample. The reader has no atomic-snapshot protocol or trailing-input check. An atomic rename writer avoids this; no writer contract is enforced here.

### H-11 — Leg-thread overrides are L-only, accepted and unreported on other arms

**CONFIRMED · P3 ·** tools/governor-bench/governor-bench.cpp:107-113; tools/governor-bench/governor-bench-run.cpp:177-193, 223-228, 487-508

> } else if (arg == "--leg-threads") {
>
> const int npu_threads = opts.leg_threads_npu > 0 ? opts.leg_threads_npu : opts.n_threads;
>
> const auto params = context_params(opts);
>
> state.governor = governor_ptr(llama_governor_init(..., params, params));

The --leg-threads option changes only arm L; it is silently accepted and ignored by two-model arm G (and the other arms). At default settings, L’s NPU thread count equals -t, matching G’s prefill context, and G’s decode context also gets -t. Custom leg counts intentionally have no effect on two-model arms. L’s output summaries do not print the actual NPU/GPU/CPU thread counts, making an overridden run hard to reproduce from its output.

### H-12 — Hop test relies on transitive declaration of strcmp

**PLAUSIBLE · P3 ·** tests/test-governor-v02-hop-v2.cpp:11-15, 93, 142

> #include <cmath>
>
> #include <cstdio>
>
> std::strcmp(opening.hop_rule, "headroom")

The new policy test calls std::strcmp without including <cstring>. A transitive include may make it compile on the current toolchain, but that declaration is not guaranteed by the listed headers. The test does not modify environment variables, so there is no save/restore hygiene issue in the changed tests.

## Requested angle checks

- **Headroom edges, state, and clock:** finite/default two-leg and NaN behavior matches v1 as described in H-01; exactly 4 C is inclusive in both. Window 0, window division, npu_lane_live, safety, and zero hop-token gating remain in select_decode and are unchanged. The extracted test has no explicit npu_lane_live == false or decode_hop_tokens == 0 case, though the source gate is shared.
- **KL:** correction sign is right for finite ordinary values; see H-02 through H-03 and H-08.
- **Floors:** H-04 and H-05 are the material defects. A thermal pause or prefill poll itself is not charged into per-leg decode timing; first actual decode/warm-up is.
- **Stats/pairs:** per-leg decode time is accumulated after successful llama_decode; decode-to-decode pair indexes match the documented NPU-GPU / NPU-CPU / GPU-CPU order (llama-governor-legs.cpp:178-190). clear_cache resets per-leg/pair counters (llama-governor-runtime.cpp:246-266); per-completion reset_prefill_stats does not (:269-283). Commit bytes/us are also recorded separately.
- **Bench labels:** the printed window engine is observed from the active context after each decode (governor-bench-run.cpp:458-461), and row 0 is correctly reserved for post-prefill logits (:432-443). Missing-file handling is correct; in-place concurrent writes remain as in H-10.
- **Tests/environment:** no test was executed. Changed tests only read KALSA_HYBRID_GGUF; they do not mutate environment state. Their strongest gaps are H-03, H-12, and the explicit two-leg edge coverage noted above.
- **Races/lifetime:** no new race or context-lifetime defect found in the committed range. The governor header requires decode, headroom updates, and stats reads to stay on the decode thread (src/llama-governor.h:30-36); the constructor cleanup claimed in F-05 is now correctly scoped. The bench reader is synchronous.
- **File responsibilities/dead code/comments:** keeping general thermal/prefill policy in the 514-line policy file and extracting hop selection into the 142-line hop file is a reasonable split. I found no new unreferenced helper. The false “CPU leg always present” invariant (H-05) and “all per-turn headroom dropped” wording (H-06) should be corrected.

## Terse summary (one line per finding)

- H-01 — CONFIRMED P3 — default two-model engine decisions match v1; diagnostics differ and custom non-finite heat params escape parity.
- H-02 — CONFIRMED P3 — KL sign is fixed, but finite extreme maxima can overflow in float before double accumulation.
- H-03 — CONFIRMED P3 — random KL non-negativity can pass without comparing any row; no non-finite fixtures.
- H-04 — CONFIRMED P2 — floor-demoted legs cannot recover from their own future measurements and may stay excluded.
- H-05 — CONFIRMED P2 — all legs can be excluded while hop selection silently reuses a stale engine.
- H-06 — CONFIRMED P3 — GPU headroom survives reset despite the per-turn reset invariant.
- H-07 — PLAUSIBLE P2 — floor rates exclude KV hop cost while bench window tps includes it.
- H-08 — CONFIRMED P3 — KLD helper divides by zero for a zero current vocabulary and has overflowable range bounds.
- H-09 — CONFIRMED P2 — exact-size validation still allows a near-2-GiB allocation.
- H-10 — PLAUSIBLE P3 — a concurrent in-place headroom writer can expose a mixed three-value sample.
- H-11 — CONFIRMED P3 — leg thread overrides affect only L, are ignored elsewhere, and are not echoed in summaries.
- H-12 — PLAUSIBLE P3 — v2 policy test uses std::strcmp without including cstring.
