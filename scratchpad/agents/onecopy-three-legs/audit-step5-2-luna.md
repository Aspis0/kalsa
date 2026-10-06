# Hostile audit: one-copy three-leg integration

Date: 2026-10-06  
Audited: `170b4bbf8`, `f73160634`, `2b8b39ca3` on `feat/governor-onecopy`, parent `6f34e0e23`.  
Read-only review. No build, device access, adb, or tests were run.

## Load-bearing change: destination watermark

**Verdict: CONFIRMED, P3 — the stated equality invariant holds for the supported two-model governor paths, so the changed range does not alter shipped two-model behavior.** This is conditional on callers using the governor’s sanctioned mutation paths.

The initial side watermarks are both zero (`src/llama-governor.h:96`: `llama_pos watermark = 0; // exclusive next position not committed to the other side`). Every successful context-switch commit assigns the same source end to both sides (`src/llama-governor.cpp:254-255`: `src.watermark = end;` / `dst.watermark = end;`). Thus the new [DST.watermark, end) and prior [SRC.watermark, end) ranges are equal in the two-model form whenever a commit is attempted.

Path trace:

- **HTP/NPU prefill, GPU prefill route, CPU prefill route:** a route that stays on its current context does not commit. Any route change reaches the same `target != last_ctx` commit block (`src/llama-governor.cpp:424-459`). A subsequent decode handoff does too.
- **Chunked prefill:** chunks call `decode_impl(chunk, false)` and run sequentially on the latched target (`src/llama-governor-runtime.cpp:170-185)); they do not split watermark updates. The later phase/context switch performs the commit.
- **Decode-hop rule 4, either direction:** when the selected target changes, the source is `last_ctx` and the same `commit_side` runs before decode (`src/llama-governor.cpp:424-459)). A successful hop restores equality.
- **Safety exits and failed commits:** decode admission wait/reload returns before the switch block (`src/llama-governor-runtime.cpp:202-214)); a KV commit failure returns before the two assignments. A decode failure after a successful commit poisons the governor (`src/llama-governor.cpp:467-478`), so it cannot proceed to a later commit with a one-sided watermark mutation.
- **Trim, clear, and history recovery:** exact trim applies `min(watermark,p)` to every side; the hybrid fallback zeros every side (`src/llama-governor.cpp:314-337`). Clear resets each collected side state (`src/llama-governor-runtime.cpp:231-245`). The binding’s history-recovery path calls `trim_sequence(n_past)` after its active-context rewind (`llama.rn-kalsa-gov-platform/cpp/rn-completion.cpp:673-683`; engine wrapper: `cpp/rn-governor.cpp:75-76`). These paths preserve equality.
- **Slide/position shift:** the cache applies pending shifts in its own context (`src/llama-context.cpp:1914-1915`, `src/llama-kv-cache.cpp:1008-1043)); it does not update governor watermarks. So it does not create a numeric SRC/DST watermark inequality. A caller that raw-shifts only one exposed context can still make its cache contents inconsistent with the watermark; that is a pre-existing bypass risk, not a regression from choosing DST over SRC. No such raw `seq_add` call was found in the shipped binding path inspected.
- **Direct and MirrorAndCopy:** hybrid routes are always MirrorAndCopy (`src/llama-kv-commit.cpp:302-303)); the recurrent tensors and metadata are copied wholesale after the ranged attention copy (`src/llama-hybrid-commit.cpp:63-75, 78-86`). A stale destination’s recurrent state is therefore replaced regardless of the attention range. Non-hybrid Direct is returned only for aliased K/V tensors with shared cell metadata (`src/llama-kv-commit.cpp:305-312`); the commit synchronizes and returns without copying (`src/llama-kv-commit.cpp:361-365`), after which both watermarks are assigned `end`. The two-model ctor rejects `ctx_other` (`src/llama-governor.cpp:56-58`), so Direct is not the shipped two-model case.

The important qualification is that equal watermarks do **not** mean equal cache contents. The KV contract says decode may contain the completed latest sequence while prefill lags; the watermark is synchronization bookkeeping, not an equality bit (`analysis/README-governor-kv-contract.md:25`). Also, that README says CPU-route handoff suppresses commit, but the audited branch’s switch block commits unconditionally when `target != last_ctx` (`src/llama-governor.cpp:424-459`). That README statement is stale for this branch; it does not change the equality result.

## Findings

### 1. Three-leg correctness

**F-01 — More than three leg specs writes past fixed arrays.**  
**CONFIRMED · P1 ·** `src/llama-governor-legs.cpp:27-28, 168-175`; `src/llama-governor-runtime.cpp:81-86`

> `for (uint32_t i = 0; i < n_legs; ++i) {`
>
> `const auto & spec = leg_specs[i];`
>
> `llama_context * side_ctxs[3];`
>
> `ctxs[n] = l.ctx;`

The public initializer accepts an unconstrained `uint32_t n_legs` (`src/llama-ext.h:551-555`), the constructor neither caps it at three nor rejects duplicate engines, and `collect_sides` writes every entry into arrays of length three. Four otherwise valid CPU-labelled legs can therefore corrupt the stack when prefill admission, trim, or clear collects sides. A null `leg_specs` with positive `n_legs` is also dereferenced.

**F-02 — The shared-model YaRN constraint is documented but not enforced.**  
**CONFIRMED · P2 ·** `src/llama-ext.h:186-191`; `src/llama-governor-legs.cpp:27-28, 61`; `src/llama-context.cpp:4053-4056`

> `Shared-model rule: every leg over one model must pass identical rope/YaRN context params`
>
> `model->hparams.n_ctx_train = cparams.n_ctx_orig_yarn / cparams.rope_freq_scale;`

The one-model constructor passes each leg’s params through without comparing `rope_scaling_type`, `rope_freq_scale`, or `yarn_orig_ctx`. Context construction mutates the shared model’s `n_ctx_train`; different leg values silently make the last constructed leg win. The header documents the caller requirement, but the governor API does not fail closed on a mismatch.

**F-03 — Per-leg watermarks are updated correctly; the F2 explanation overstates what they mean.**  
**CONFIRMED · P3 — documentation finding; no watermark decode defect ·** `src/llama-governor.cpp:211-218, 228-229, 254-255`; `~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-three-legs/FABLE-DESIGN.md:541-550`

> `src.watermark = end;`
>
> `dst.watermark = end;`
>
> `each context's watermark already means "what this context holds"`

The code updates both the active source and destination after a successful commit; an untouched third leg retains its older frontier, so a first hop to it copies from its own watermark. That is the right N-leg attention behavior. But “what this context holds” is not exact: after decode, the active cache can extend past its watermark, and the watermark is a committed frontier, not the cache’s current end. The source header and KV contract describe the narrower synchronization meaning.

### 2. Races and lifetime

**F-04 — A one-model leg can alias another context’s KV despite F6’s no-shared-KV fence.**  
**CONFIRMED · P2 ·** `src/llama-governor.cpp:56-58`; `src/llama-governor-legs.cpp:61-76`; `src/llama-context.cpp:421-430`; `FABLE-DESIGN.md:585-587`

> `if (params_prefill.ctx_other || params_decode.ctx_other) {`
>
> `llama_context * ctx = llama_init_from_model_with_legs(model, spec.params, devices);`
>
> `/*.mem_other =*/ llama_get_memory(cparams.ctx_other),`

The two-model ctor explicitly rejects `ctx_other`; the one-model ctor does not. A leg can therefore be built with shared memory, and pair validation accepts Direct for valid aliases. Direct itself is coherent for aliased non-hybrid K/V, but the resulting governor violates Amendment F’s “No shared KV” boundary and the API description that each leg has its own memory. Hybrid is still MirrorAndCopy, which makes aliasing especially outside the promised model.

**F-05 — Contexts can leak on constructor allocation failures outside the cleanup scope.**  
**CONFIRMED · P2 ·** `src/llama-governor-legs.cpp:61-66, 80-89`; `src/llama-governor-runtime.cpp:386-394`

> `llama_context * ctx = llama_init_from_model_with_legs(model, spec.params, devices);`
>
> `legs.push_back({ spec.engine, ctx, side_state{} });`
>
> `} catch (...) {`
>
> `prefill_layers_device_ = context_layers_device(prefill_ctx(false));`

If `push_back` throws after the raw context is created, that context was never added to `legs` and the catch cannot free it. If either `context_layers_device` call throws after the cleanup try block, the partially constructed governor’s destructor does not run and the vector only destroys raw-pointer records. The exported initializer catches the exception and returns null, masking the leak as an ordinary construction failure.

**F-06 — Admission is device-global, but the constructor treats “sole HTP context” as governor-local.**  
**PLAUSIBLE · P2 ·** `src/llama-governor-legs.cpp:99-107`; `src/llama-ext.h:205-209`

> `usable here only because the NPU leg is this governor's sole HTP context`
>
> `The admission belongs to the device, so every context on that device re-reserves at its next decode.`

The code sets admission once, as requested, but does not establish that no other governor or plain context uses the same HTP device. The public contract also forbids racing the setter with any context’s reserve/split/decode; construction does not coordinate with such contexts. Under the intended single-governor/single-HTP-owner setup this is safe, but the API’s broader device-global side effect is real.

### 3. Forced-leg API

**F-07 — Forced rotation bypasses decode safety decisions, despite the comment saying it does not.**  
**CONFIRMED · P2 ·** `src/llama-governor.cpp:135-140, 386-392`; `src/llama-governor-runtime.cpp:202-212`

> `policy_rc = select_decode();`
>
> `forced_rotate();`
>
> `and every safety gate around it are untouched`

When `forced_leg_tokens > 0`, `decode_impl` does not call `select_decode`. That function is where thermal wait/abort and `requires_reload` are handled. Forced rotation is currently described as an F5 proof hook and defaults off, which limits exposure, but callers enabling the public params bypass those decode gates. The comment is false.

**F-08 — A forced GPU leg on the two-model form is reported as GPU but executes on decode context.**  
**CONFIRMED · P2 ·** `src/llama-governor.cpp:123-132, 147-165`; `src/llama-governor-legs.cpp:146-153`; `src/llama-governor.cpp:514-528`

> `forced_leg_sequence allows only CPU, GPU and NPU`
>
> `return engine == llama_governor_engine::NPU ? ctx_prefill : ctx_decode;`

The params are accepted by both governor constructors. For the two-model form, `legs.empty()`; a forced GPU choice does not enter the absent-leg fallback and maps to `ctx_decode` (the shipped CPU context), while `decode_engine_` and `decode_tokens_gpu` report GPU. Either reject forced rotation on the two-model form or make its supported engine set explicit.

**Default-off check: REFUTED, P3.** With the default `forced_leg_tokens == 0`, `decode_impl` still calls `select_decode()`; leg helpers map the two-model roles back to the original contexts, and the old/new watermark ranges are equal on supported paths. I found no default-off behavior change in the shared path.

### 4. governor-bench arm L and KL

**F-09 — Arm L and the two-copy reference compare different stream lengths by default.**  
**CONFIRMED · P1 ·** `tools/governor-bench/governor-bench.h:14-17, 25-31`; `tools/governor-bench/governor-bench-run.cpp:281-299, 347-388`; `tools/governor-bench/governor-bench-logits.cpp:100-106`

> `constexpr int k_generated_tokens = 128;`
>
> `uint32_t generate_tokens = 256;`
>
> `const size_t n_rows = std::min(ref.size(), cur.size()) / n_vocab_ref;`

Arm L defaults to 256 logits rows; arm A/C/G’s existing `run_turn` emits 128 rows. The comparer silently takes the shorter prefix, so the advertised default L-vs-two-copy comparison checks only 128 of the requested 256 L rows. It does not reject unequal row counts.

**F-10 — The “KLD gate” is informational and exits successfully on a divergent or high-KL run.**  
**CONFIRMED · P1 ·** `tools/governor-bench/governor-bench-logits.cpp:106-121`; `tools/governor-bench/governor-bench.cpp:193-205`

> `if (row_argmax(ref_row, n_vocab_ref) != row_argmax(cur_row, n_vocab_cur)) {`
>
> `++n_diverged;`
>
> `break;`
>
> `return true;`
>
> `if (opts.arm == 'L') { llama_backend_free(); return 0; }`

Stopping at the first argmax divergence is reasonable because later autoregressive rows are no longer aligned. But `logits_kld` still returns true, the caller only prints the numbers, there is no KL threshold, and arm L returns 0. A divergence at row zero yields `compared=0, mean=0, max=0` and a successful exit. `n_diverged` is also only a 0/1 “first divergence found” flag, not a count of divergent rows.

**F-11 — The logits loader trusts unbounded positive dimensions before allocation.**  
**CONFIRMED · P2 ·** `tools/governor-bench/governor-bench-logits.cpp:72-89`

> `n_vocab > 0 && n_tokens > 0;`
>
> `rows.resize(static_cast<size_t>(n_tokens) * n_vocab);`

A truncated header/body with ordinary dimensions returns false, which is good. However, a malformed header can specify huge positive dimensions; the loader allocates before checking file length and does not catch `length_error`/`bad_alloc`. There is no expected-file-size or reasonable row/vocab bound.

**F-12 — The GPU finder does not actually find OpenCL, and the NPU match is broader than HTP0.**  
**CONFIRMED · P2 ·** `tools/governor-bench/governor-bench-run.cpp:64-87`

> `std::strncmp(ggml_backend_dev_name(dev), "HTP", 3) == 0`
>
> `if (ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_GPU ||`
> `ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_IGPU) {`

`find_npu` accepts any HTP-prefixed device, not specifically HTP0. `find_opencl` returns the first other GPU/IGPU and never checks the `GPUOpenCL` name or backend. On a host with multiple non-HTP GPU backends, arm L can build the purported GPU leg on the wrong backend.

**KL math check: REFUTED, P3.** For finite logits, `row_kld` computes KL(ref||cur) over every vocabulary entry using separate maxima and a log-normalizer correction (`governor-bench-logits.cpp:29-52`); that formula is mathematically correct and numerically stable for ordinary finite model logits. The missing finite-value validation and the lack of a pass threshold remain part of F-10.

### 5. Tests

**F-13 — The host test checks logits but does not assert the advertised hop schedule or require a hybrid fixture.**  
**CONFIRMED · P2 ·** `tests/test-governor-legs.cpp:103-119, 153-178, 208-212`

> `const uint32_t expected_windows = k_decode_steps / k_hop_tokens;`
>
> `if (stats.decode_hops == 0 || stats.decode_hop_commit_bytes == 0 ||`
>
> `const char * model_path = std::getenv("KALSA_HYBRID_GGUF");`

The test uses three CPU-only contexts labelled NPU/GPU/CPU and compares full-vocabulary logits after each decode, which is useful host evidence for the shared model and commit path. But `expected_windows` is only printed; it never checks hop count/order/boundaries. It only requires each engine’s aggregate token count be nonzero. It also trusts the environment variable’s filename and never asserts the loaded memory is hybrid, so “conv state included” depends on the caller supplying the intended fixture. It does not prove real HTP/OpenCL execution; that is outside this host test’s stated scope.

**Two-model test files: REFUTED as an edit concern, P3.** The audited commits add `test-governor-legs` to CMake but do not modify existing two-model test sources. Their unchanged presence is useful regression coverage, not proof of byte identity across every route; no tests were run under the user’s instruction.

### 6. File responsibilities, comments, dead code

**F-14 — One-model telemetry reports model placement as the executing leg device.**  
**CONFIRMED · P2 ·** `src/llama-governor.cpp:23-30`; `src/llama-governor-legs.cpp:88-94`; `src/llama-context.cpp:573-578`

> `layer_devices.emplace_back(ggml_backend_dev_name(model.dev_layer(static_cast<int>(il))));`
>
> `decode_layers_device_ = context_layers_device(decode_ctx(llama_governor_engine::CPU));`
>
> `With a leg the layer's device is the leg's first device; the CPU leg runs the layer on this context's CPU backend.`

All legs share one model, so `model.dev_layer()` reports the load-time placement (HTP in the specified one-copy load) even when the CPU leg executes the layer on CPU or GPU leg executes on OpenCL. The governor uses this helper for `route_chunks[].layers_device`; one-model route telemetry can therefore claim HTP for CPU/GPU execution.

**File split/dead-code check: REFUTED, P3.** `llama-governor.cpp` grew from 417 to 534 lines, but the new context construction/lookup is separated into `llama-governor-legs.cpp`, and admission/chunk policy remains in `llama-governor-runtime.cpp`. The remaining core growth is the shared transition path and forced hook, which are the behavior under audit. I found no newly added unreferenced helper or field in these commits.

**Additional documentation drift: CONFIRMED · P3 ·** `analysis/README-governor-kv-contract.md:25`; `src/llama-governor.cpp:424-459`.

> `The governor commits only when the phase changes, and suppresses that commit for cpu_route_handoff`

The current engine code commits on every context change, including a route switch. This report treats the source path as authoritative for behavior and records the README mismatch because it could mislead later audits.

## Terse summary (one line per finding)

- F-01 — CONFIRMED P1 — unbounded leg count overflows three-entry side arrays.
- F-02 — CONFIRMED P2 — per-leg YaRN parameters can silently mutate shared model context settings.
- F-03 — CONFIRMED P3 — F2’s watermark wording overstates a committed frontier.
- F-04 — CONFIRMED P2 — one-model legs can opt into shared KV despite Amendment F’s fence.
- F-05 — CONFIRMED P2 — construction exceptions can leak raw leg contexts.
- F-06 — PLAUSIBLE P2 — device-global admission can affect/race with other HTP contexts.
- F-07 — CONFIRMED P2 — forced rotation bypasses decode thermal/reload gates.
- F-08 — CONFIRMED P2 — forced GPU in two-model mode is accounted as GPU while using decode context.
- F-09 — CONFIRMED P1 — default KL comparison truncates 256 L rows to the 128-row reference.
- F-10 — CONFIRMED P1 — divergent/high-KL comparisons still exit successfully.
- F-11 — CONFIRMED P2 — malformed dimensions can trigger unbounded allocation before size validation.
- F-12 — CONFIRMED P2 — device selection matches generic HTP/GPU types rather than HTP0/GPUOpenCL.
- F-13 — CONFIRMED P2 — host test does not assert hop cadence or hybrid memory type.
- F-14 — CONFIRMED P2 — one-model route telemetry reports model placement, not leg execution.
- Documentation drift — CONFIRMED P3 — KV contract says CPU-route handoff suppresses a commit, source commits on context change.
