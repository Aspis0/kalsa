NO

# Independent shipping audit: native engine and binding

Scope reviewed: engine `319b539..e6200cc02379705a93f0f91cf351ff241c5af1fb`; binding `e437b1af..42087667`. Read-only review. I did not build or modify either subject repository. The shipping verdict is **NO** because release logs expose prompt content and governor flow-control pauses can be returned as successful empty or partial completions.

## 1. Allocator memory safety and success path

- **REFUTED — the reserve-failure poison does not leave a stale plan for the next graph allocation.** The failure marks the plan invalid:
  > `ggml/src/ggml-alloc.c:966` — `galloc->n_nodes = -1;`

  The first needs-realloc check compares that value before touching node allocation records:
  > `ggml/src/ggml-alloc.c:1035` — `if (galloc->n_nodes != graph->n_nodes) {`

  Single-buffer allocation retries reserve and returns false if reserve fails; multi-buffer allocation refuses automatic allocation. The scheduler also checks reserve failure and returns `GGML_STATUS_ALLOC_FAILED` (`ggml-backend.cpp:1633-1639, 2023-2026`); llama maps that status to `-2` (`llama-context.cpp:1881-1884`). I found no reader that reaches `node_allocs` on the poisoned plan.

- **REFUTED — alias clearing leaves no dangling duplicate vbuffer after a failed reallocation.**
  > `ggml/src/ggml-alloc.c:947-952` — `ggml_vbuffer_free(buffer_old);` followed by clearing every `buffers[j] == buffer_old`.

  The free routine accepts null (`ggml-alloc.c:402-405`), and the destructor deduplicates aliases before freeing (`ggml-alloc.c:543-555`).

- **REFUTED — the zero-node retry does not index a null `node_allocs`.**
  > `ggml/src/ggml-alloc.c:854-858` — `if (graph->n_nodes > 0) { ... calloc(...) ... }`

  The following node loop is bounded by `graph->n_nodes` (`ggml-alloc.c:861-864`).

- **REFUTED — the change does not re-reserve on every successful inference call.**
  > `ggml/src/ggml-alloc.c:1078-1084` — reserve is called only inside `if (ggml_gallocr_needs_realloc(...))`.

  For a stable graph and allocation, the node count and planned tensor sizes still match, so the normal allocation path skips reserve. Alias scans are in reserve/reallocation, not the steady tensor initialization loop.

- **PLAUSIBLE — the zero-node regression test is not deterministic evidence for the calloc guard.**
  > `tests/test-alloc.cpp:753-756` — the comment says the unguarded case “rests on `calloc(0)` returning non-NULL”.

  C permits either result for `calloc(0)`; the test does not instrument whether zero-size calloc was called. The reserve-retry and alias teardown tests do exercise meaningful failures.

## 2. Governor semantics and failure delivery

- **CONFIRMED — the `-2` discriminator itself is correct.**
  > `cpp/rn-governor.h:16-17` — `return rc != 0 && (rc != -2 || engine_failed);`

  Policy flow-control returns before raw decode (`src/llama-governor.cpp:182-187`); raw decode failures record the reason, set `failed = true`, then return the original rc (`src/llama-governor.cpp:214-224`). Thus a policy `-2` stays non-failure while an allocator `-2` from the engine is recognized as failure. Both binding call sites use the same predicate (`rn-governor.cpp:51-60`, `rn-llama.cpp:666-674`).

- **CONFIRMED — failed state is sticky, including across cache clear.** The public API documents that behavior:
  > `src/llama-governor.h:31-35` — `The failed state is sticky`; `is_failed() const { return failed; }`

  `clear_cache` resets KV and phase state but never clears `failed` or `failure_reason_` (`src/llama-governor-runtime.cpp:148-169`). Recovery therefore requires a fresh governor/context. I found no evidence that cache clearing is intended to recover an engine decode failure.

- **CONFIRMED — blocking: completion swallows governor flow-control `-2` as an ordinary result.**
  > `cpp/rn-completion.cpp:1680-1693` — on any nonzero `parent_ctx->decode(...)`, it logs, sets `has_next_token = false`, and `return result`.

  The JSI rejection at `RNLlamaJSI.cpp:1309-1313` happens only when `ctx->governorFailed()` is true. By design that is false for thermal pause, chunk-required, and reload-required `-2`. The call can therefore resolve with an empty or partial completion and no pause/error marker; the result exposes `interrupted`, `context_full`, and stop flags, but no decode-failure or policy-pause field (`JSICompletion.h:180-187`). A caller cannot reliably know it should reduce/chunk input, wait, or reload.

- **CONFIRMED — rejection is not wired to the other JSI task APIs.** Governor eligibility rejects parallel, speculative/MTP, MoE, and LoRA, but does not reject embedding or vocoder use (`rn-llama.cpp:718-735`). The completion path has the explicit `governorFailed()` check; embedding, rerank, and benchmark do not:
  > `RNLlamaJSI.cpp:1083` — `ctx->completion->embedding(embdParams)`
  >
  > `RNLlamaJSI.cpp:1115` — `ctx->completion->rerank(query, documents)`
  >
  > `RNLlamaJSI.cpp:1140` — `ctx->completion->bench(pp, tg, pl, nr)`

  Embedding calls `doCompletion()` and returns a zero vector if no embedding data is available (`rn-completion.cpp:2086-2089, 2106-2111`); rerank uses a low sentinel when decode produced no embedding (`rn-completion.cpp:2153-2164`); benchmark returns an empty JSON object when decode fails (`rn-completion.cpp:2237-2241, 2257-2260`). These APIs can resolve instead of rejecting on a governor failure. Separately, `llamaGetGovernorStats` exposes `failure_reason` (`RNLlamaJSI.cpp:853-880`); it is passive diagnostics, not a result attached to these calls.

- **PLAUSIBLE — vocoder evaluation bypasses the governor.** `llamaInitVocoder` is callable without a governor-mode guard (`RNLlamaJSI.cpp:2000-2019`); governor setup assigns `owner.ctx = owner.governor->prefill_ctx()` (`rn-llama.cpp:147-149`). Several TTS paths then call raw `llama_decode(parent_ctx->ctx, b)`, e.g. `rn-completion.cpp:1356, 1407, 1621, 1656`, instead of `parent_ctx->decode`. That bypasses route/failure tracking if governor plus vocoder is a supported combination. The code does not reject that combination.

## 3. P1: exact `no_extra_bufts` scope

- **REFUTED — no accidental prefill or non-governor mutation found.** The loader copies the owner params separately, then changes only the decode copy:
  > `cpp/rn-llama.cpp:74-88` — `common_params prefill_params = owner.params;` / `common_params decode_params = owner.params;` / `decode_params.no_extra_bufts = true;`

  The prefill model is loaded from `prefill_params` (`rn-llama.cpp:106-108`); the decode model is loaded from `decode_params` (`rn-llama.cpp:115-117`). Contexts are then built from their corresponding copies. The ordinary path passes the separate `params` copy to `common_init_from_params(params)` (`rn-llama.cpp:819-821`). The flag is a model-load setting: `common.cpp:1710` maps it to `mparams.use_extra_bufts = !params.no_extra_bufts`. It disables extra bufts for the CPU decode model only, as intended.

- **PLAUSIBLE — the comment’s prefill residual claim is model-specific, not a general guarantee.**
  > `cpp/rn-llama.cpp:83-84` — `its CPU residuals carry no repack traits`.

  That may match the cited S23 load log, but other models/layouts can leave different tensors on CPU. The code does not apply `no_extra_bufts` to prefill; this is a documentation/generalization caveat, not an accidental scope change.

## 4. Vendor bump

- **CONFIRMED — changed engine source files are byte-identical to engine commit `56f79e6cb81ed8a802a069ded6c63922a3dc9e06`.** Object IDs matched for `ggml/src/ggml-alloc.c`, `ggml/src/ggml-backend.cpp`, `src/llama-governor.cpp`, and `src/llama-governor.h`.

- **CONFIRMED — the pin is correct and there are no other vendor changes.**
  > `vendor/VERSIONS:8-9` — `LLAMA_CPP_REF` and `LLAMA_CPP_COMMIT` both equal `56f79e6cb81ed8a802a069ded6c63922a3dc9e06`.

  The vendor diff contains exactly those four source files, three generated build metadata files, and `vendor/VERSIONS`. The metadata files are generated by the sync script, not copied byte-for-byte from the engine checkout (`vendor/README.md:33-38); the pre-existing patch set is not an additional change in this bump.

## 5. Release privacy audit

**CONFIRMED — these content-bearing logs are compiled into Android release builds.** `LOG_INFO`, `LOG_WARNING`, and `LOG_ERROR` always call `log` (`rn-llama.h:299-301`); Android `log` sends them to logcat with `__android_log_vprint` (`rn-llama.cpp:280-296`). The CMake guard only defines `RNLLAMA_ANDROID_ENABLE_LOGGING` for Debug (`android/src/main/rnllama/CMakeLists.txt:70-72`); it does not gate ordinary INFO/WARNING calls.

1. **CONFIRMED — multimodal user prompt text.**
   > `cpp/rn-mtmd.hpp:443-444` — `content=%s`, `full_prompt.c_str()`; then `prompt: %s`, `prompt.c_str()`.

   These are unconditional `LOG_INFO` calls; the “[DEBUG]” text in their format strings is only a label.

2. **CONFIRMED — prompt token IDs.**
   > `cpp/rn-completion.cpp:605-606` — `KALSA_KVDIAG0 ... cache_head=[%s] prompt_head=[%s]`.

   It logs up to 12 cache and prompt token IDs whenever `n_common == 0` with nonempty token sequences (`rn-completion.cpp:597-604`). The IDs are vocabulary-decodable content.

3. **CONFIRMED — Chatterbox TTS input text.**
   > `cpp/rn-completion.cpp:1460-1462` — `text='%s'`, using `chatterbox_text.substr(0,40)`.

4. **CONFIRMED — matched model-output/stop-word text.**
   > `cpp/rn-slot-manager.cpp:1150-1156` — after `text.find(word, search_start)`, logs `Stopped on word '%s'`.
   >
   > The same release log exists at `rn-slot-manager.cpp:1290-1296`.

   Each logs a matched substring that occurs in the generated text.

5. **KNOWN OWNER DECISION — KVDIVERGE content diagnostics.**
   > `cpp/rn-completion.cpp:578-581` logs token IDs and detokenized snippets, but this block is under `#ifdef RNLLAMA_ANDROID_ENABLE_LOGGING` at line 554.

   Per the Android CMake guard, the content-bearing block is Debug-only. Its earlier unconditional warning logs divergence counts only. I found no other release log formatting raw token text or model output. Raw prompt/token `LOG_VERBOSE` sites are compiled out under the normal target because `LOG_VERBOSE` is an empty macro when `RNLLAMA_VERBOSE != 1` (`rn-llama.h:286-297`).

## 6. Test evidence

- `./build/bin/test-alloc > /tmp/kalsa-test-alloc.log 2>&1; echo "EXIT=$?"` — `EXIT=0`; reserve failure/retry, alias teardown, and zero-node retry cases passed.
- `./build/bin/test-governor-v02-router > /tmp/kalsa-test-governor-v02-router.log 2>&1; echo "EXIT=$?"` — `EXIT=0`; policy flow-control tests passed. This prebuilt binary predates a later compile-only static assertion.
- `./build/bin/test-governor-v0-turns -m /Users/marco/Projects/kalsallama/build/tinyllamas/stories15M-q4_0.gguf > /tmp/kalsa-test-governor-v0-turns.log 2>&1; echo "EXIT=$?"` — `EXIT=0`; it verifies sticky failure using raw decode `-1`, plus a flow-control `-2` that stays non-failed. It does **not** exercise allocator `GGML_STATUS_ALLOC_FAILED` `-2` through governor and JSI.
- `./node_modules/.bin/jest --runInBand > /tmp/kalsa-binding-jest-all.log 2>&1; echo "EXIT=$?"` — `EXIT=0`; 14 suites, 47 tests, 5 snapshots passed. The governor/source-guard Jest coverage checks source shape, not native runtime behavior. The binding C++ predicate truth-table test at `tests/governor_params_test.cpp:110-115` was inspected but not run.

Tests are not green-only: allocator recovery/alias and governor flow-control/sticky-state tests exercise meaningful paths. The zero-node guard test is nondeterministic for the reason above, and there is no end-to-end real allocator-`-2` test or completion-level pause/error test. No builds were performed.

## Re-review

**SHIP-WITH-FIXES**

This section supersedes §5's release-content verdict for binding HEAD `32ab3605`; §5 describes the pre-guard state at `42087667`.

### Privacy gate

- **CONFIRMED — the content formats reviewed in section 5 are now guarded at source.** The prompt strings in `rn-mtmd.hpp:448-451`, token IDs/snippets in `rn-completion.cpp:555-583, 605-615`, Chatterbox text at `rn-completion.cpp:1474-1477`, and both stop-word strings at `rn-slot-manager.cpp:1160-1162, 1306-1308` sit under `#ifdef RNLLAMA_LOG_CONTENT`. Their release-side replacements log counts or lengths only. A fresh scan found no other release-enabled raw prompt/token/model-output log; remaining token-text `LOG_VERBOSE` calls use the empty macro in the normal target. The prior eval-failure path still has no token text.

- **REFUTED — `rn-mtmd.hpp` is not compiled into the top-level JNI target.** `android/src/main/CMakeLists.txt:31-39` lists only JNI/JSI source files in `JNI_SOURCE_FILES`. The core sources are compiled into the separate rnllama library: `cmake/rnllama-sources.cmake:132-152` puts `rn-llama.cpp`, `rn-completion.cpp`, and `rn-slot-manager.cpp` in `RNLLAMA_CORE_SOURCES`; `rn-llama.cpp:5` includes `rn-mtmd.hpp`. The macro is correctly applied to that library target. The JNI target lacking the definition does not suppress this header's test logging because it does not compile that header.

- **CONFIRMED — when source-build is ON, the property reaches rnllama CMake.** `android/build.gradle:164-166` adds `-DRNLLAMA_LOG_CONTENT=ON` to `cmakeArgs`, and line 182 passes those arguments to CMake. The top-level CMake adds the rnllama subdirectory when `RNLLAMA_BUILD_FROM_SOURCE` is true (`android/src/main/CMakeLists.txt:23-27`); the child CMake sees `RNLLAMA_LOG_CONTENT` and adds `-DRNLLAMA_LOG_CONTENT` to each rnllama target (`android/src/main/rnllama/CMakeLists.txt:77-79`). The APK workflow also requests source build through `KALSA_LLAMA_FROM_SOURCE: "1"` (`.github/workflows/apk.yml:171-174`), and the Expo plugin writes `rnllamaBuildFromSource=true` to Gradle properties (`plugins/withLlamaFromSource.js:22-32`).

- **CONFIRMED for a clean configure — default is OFF.** Gradle adds the CMake variable only when `rootProject.findProperty("rnllamaLogContent")` equals `"true"` (`android/build.gradle:164-167`); otherwise it is unset and `if (RNLLAMA_LOG_CONTENT)` is false. **PLAUSIBLE cache risk:** the false branch does not pass `-DRNLLAMA_LOG_CONTENT=OFF`, so a CMake cache previously configured ON may retain ON on a later configure using that same build directory. The current GitHub APK job checks out fresh and builds one artifact, which reduces that risk there; always passing ON/OFF would make the invariant explicit for reused local build trees.

- **CONFIRMED — the app workflow has not yet enabled the test APK property.** The checked-in `.github/workflows/apk.yml:183-215` debuggable step edits `android/app/build.gradle` to set `debuggable true`; the file contains no `rnllamaLogContent` or `gradle.properties` append. Therefore the current debuggable APK workflow leaves content logs OFF. Add `rnllamaLogContent=true` only in that conditional step; leave the plain-release path unset/OFF.

- **CONFIRMED — the new Jest guards catch the listed source regressions, but not wiring failures.** `nativeSourceGuards.test.ts:20-47` removes guarded regions before checking for outside copies (`!contentMacroRegions(source).reduce(...).includes(needle)`) and requires `{ present: true, gated: true }`. Thus removing a guard or moving one of these formats out makes the test fail. The tests do not inspect Gradle/CMake target propagation or `apk.yml`, and do not discover a new content log with an unlisted format. Full permitted Jest run passed: 14 suites, 49 tests, 5 snapshots; `EXIT=0`. No build was run.

### Prior blockers

- **The flow-control `-2` path is not a blocker for this ship.** It is a real behavior gap, but the same decode-error-to-empty-result path exists at shipped base `e437b1af` (`cpp/rn-completion.cpp:1680-1692`); commit `32ab3605` changes only privacy logging around it and does not introduce or worsen the behavior. The earlier governor change improves the distinction by throwing for a real engine `ALLOC_FAILED` `-2`, while policy `-2` remains non-failure. I agree with tracking mid-turn pause/result semantics separately rather than blocking this non-regressing privacy change.

- **The embedding/rerank/bench rejection gap is also not a blocker for this ship.** Those JSI routes remain inconsistent with completion, but they predate this privacy commit and their result paths are unchanged. Track a follow-up to decide whether governor mode rejects those tasks or gives them an explicit failure result; this review does not make the gap part of the privacy fix.

**Ship conditions:** add the `rnllamaLogContent=true` property to the APK workflow's debuggable-only step, and pass explicit `-DRNLLAMA_LOG_CONTENT=OFF` when that property is absent/false so a reused CMake cache cannot retain ON. The native privacy guards and source-build flag propagation are otherwise correct; the flow-control and non-completion API issues remain follow-ups, not regressions in this ship.
