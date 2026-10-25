# RECON — runtime ALLOC_FAILED → CPU-only governor fallback (read-only)

Goal: the smallest wiring that turns a runtime `llama_decode == -2` (GGML_STATUS_ALLOC_FAILED)
into "unload the governor, reload CPU-only with the existing `cpuParams` (`n_gpu_layers=0`), retry
the turn", without false fallbacks on the flow-control `-2`s.

Method: read-only, no file edited or created except this one. Every claim below carries the
file:line and the line as read. Checkouts read:

- Engine: `~/Projects/kalsallama` (branch `main`, tip `833cde99b`) and the binding's vendored copy
  `~/Projects/llama.rn-kalsa/vendor/llama.cpp/src/` — the governor sources are identical:
  `diff ~/Projects/kalsallama/src/llama-governor.cpp ~/Projects/llama.rn-kalsa/vendor/llama.cpp/src/llama-governor.cpp`
  → `CPP_IDENTICAL`; same for `llama-governor-runtime.cpp` → `RUNTIME_IDENTICAL`.
  The vendor pin is `vendor/VERSIONS:8` `LLAMA_CPP_REF=319b539377605f6c572e234b28678b74bd78deb5`.
- Binding: `~/Projects/llama.rn-kalsa`, `git branch --show-current` → `kalsarn-governor-engine`,
  origin `https://github.com/Aspis0/kalsa.rn.git`.
- App: `~/Projects/kalsa`, `git branch --show-current` → `main`.
- Prior audit read first: `opencl-upload-oom/AUDIT.md` `## Round 2` item 5 (§R5.1–R5.5).

---

## 1. Engine: public accessor for the failed state?

**There is no `llama_governor_failed()` and no public `failed` accessor.** Exhaustive grep over
the engine (`grep -rn "llama_governor_failed\|governor_failed\|is_failed\|bool failed" src include/`)
returns only two hits:

    src/llama-mmap.cpp:809:    bool failed_already;
    src/llama-governor.h:84:    bool failed = false;

The field and its visibility:

    src/llama-governor.h:33   private:
    src/llama-governor.h:84       bool failed = false;

The only public member that touches failure state is the reason:

    src/llama-governor.h:31       const char * failure_reason() const { return failure_reason_; }

(before `private:` at :33, hence public). The C API in `src/llama-ext.h` has no failed query either —
the governor surface is `src/llama-ext.h:395` `LLAMA_API void llama_governor_free(struct llama_governor * governor);`,
`:401` `LLAMA_API int32_t llama_governor_decode(`, `:438` `LLAMA_API void llama_governor_get_stats(`
… `:440` `        struct llama_governor_stats * stats);`. `struct llama_governor_stats` (declared
`:319`) carries no failure field — its members run `bool decode_requires_reload = false;`
(`src/llama-ext.h:341`) through `uint64_t prefill_io_us = 0;` (`:347`), none named failed/failure.

**The public proxy is NOT equivalent to `failed` on the first failing turn.** Writers, by grep over
`src/llama-governor.cpp`: `:152` `failed = true;` (inside `fail()`), `:153` `failure_reason_ = message;`,
`:163` `if (failed) {`, `:164` `        return fail("governor is failed");`, `:216` the log line,
`:217` `failed = true;`. The ALLOC_FAILED site sets `failed` **without** the reason:

    src/llama-governor.cpp:214-218
        const int32_t rc = llama_decode(target, batch);
        if (rc != 0) {
            LLAMA_LOG_ERROR("%s: llama_decode failed with rc=%d\n", __func__, rc);
            failed = true;
            return rc;
        }

`fail()` is the only writer of `failure_reason_` (grep: only `:153`), and `fail()` also returns `-1`,
not `-2`:

    src/llama-governor.cpp:151-156
    int32_t llama_governor::fail(const char * message) {
        failed = true;
        failure_reason_ = message;
        LLAMA_LOG_ERROR("%s: %s\n", __func__, message);
        return -1;
    }

So on the first ALLOC_FAILED turn `failed == true` while `failure_reason() == nullptr`.
`failure_reason() != nullptr` only becomes true on the *next* call via the short-circuit
`src/llama-governor.cpp:163-164` `if (failed) { return fail("governor is failed"); }`.
The binding already relies on exactly this ordering and therefore learns one call late
(`rn-governor.cpp:52` filter, below). Note AUDIT §R5.2 called the proxy "exactly equivalent" —
that holds only in the direction reason⇒failed, not failed⇒reason; the lines above settle it.

**Smallest public addition (2 lines, both in already-touched files):**

1. `src/llama-governor.h`, in the public block before `private:` (after `:31`):
   `bool is_failed() const { return failed; }` — no new C API needed because the binding already
   includes this header directly: `rn-governor.cpp:2` `#include "llama-governor.h"` and calls
   `governor_->failure_reason()` (`rn-governor.cpp:56` `const char * reason = governor_->failure_reason();`).
2. Recommended: at `src/llama-governor.cpp:217`, set a static reason next to `failed = true;`
   (e.g. `failure_reason_ = "llama_decode failed";`) so the reason rides on the first turn.
   `failure_reason_` is `const char *` (`llama-governor.h:85`), so a literal costs nothing.

**Why this cannot produce false fallbacks (the discriminator):** every flow-control `-2` is a bare
return that never touches `failed`:

    src/llama-governor-runtime.cpp:51     return fail("prefill admission aborted");
    src/llama-governor-runtime.cpp:57     return -2;      (thermal Wait)
    src/llama-governor-runtime.cpp:72     return -2;      (caller chunk)
    src/llama-governor-runtime.cpp:83     return -2;      (cannot partition)
    src/llama-governor-runtime.cpp:91     return -2;      (count <= 1)
    src/llama-governor-runtime.cpp:124    return fail("decode admission aborted");
    src/llama-governor-runtime.cpp:127    return -2;      (waiting for valid thermal profile)
    src/llama-governor-runtime.cpp:131    return -2;      (requires_reload)

(`fail()` sites return `-1`; the `-2` sites are the six numbered lines — verified by
`grep -n "return -2\|return fail\|failed" src/llama-governor-runtime.cpp` → 51,57,72,83,91,124,127,131
and no `failed` writer anywhere in the file.) And once failed, `decode_impl` short-circuits
(`llama-governor.cpp:163-164`), so `is_failed()==true` and a freshly-returned flow-control `-2`
cannot coexist (matches AUDIT §R5.1 CONFIRMED). The engine's own docs state the sticky contract:

    src/llama-ext.h:375-376  * Only sequence 0 is supported. A decode, commit, or route failure is sticky:
                             * later calls keep failing rather than falling back to a single context.
    src/llama-ext.h:399      * Batches must use sequence 0; any failure permanently poisons the governor.

→ "reload, don't retry in place" is the engine-sanctioned recovery.

---

## 2. Binding: every path a completion's decode result takes to JS

### 2.1 The two `-2` filters (why the shadow never fires on turn 1)

    cpp/rn-llama.cpp:666-668
        const bool was_failed = governor->failed();
        const int32_t result = governor->decode(batch);
        if (result != 0 && result != -2 && !was_failed) {

    cpp/rn-governor.cpp:44  int32_t rn_governor::decode(llama_batch batch) {
    cpp/rn-governor.cpp:52      if (result != 0 && result != -2) {
    cpp/rn-governor.cpp:56          const char * reason = governor_->failure_reason();
    cpp/rn-governor.cpp:58          failure_reason_ = "llama_governor_decode failed with rc=" + std::to_string(result);

`governor->failed()` here is the **binding shadow**, not the engine state:

    cpp/rn-governor.h:26    bool failed() const { return failed_; }
    cpp/rn-governor.h:29    const std::string & failure_reason() const { return failure_reason_; }

Because `-2` is excluded at `rn-governor.cpp:52`, on the first ALLOC_FAILED the shadow stays
`failed_ == false` and `failure_reason_ == ""`; the next call returns engine `-1` via
`llama-governor.cpp:163-164`, which passes the filter, sets `failed_`, and reads engine reason
`"governor is failed"`.

### 2.2 Where the decode failure is swallowed

    cpp/rn-completion.cpp:1680-1693
            if (parent_ctx->decode(llama_batch_get_one(&embd[n_past], n_eval)))
            {
                LOG_ERROR("failed to eval, n_eval: %d, n_past: %d, n_threads: %d, embd: %s",
                ...
                // Trim embd to what the memory actually contains so a later prefix
                // match can't claim never-written cells.
                embd.resize(n_past);
                has_next_token = false;
                return result;
            }

No stop/limit flag is written on this path: the flag writers in `rn-completion.cpp` are at
`:416` (`truncated = true;`), `:1049` / `:1176` / `:2034` (`stopped_limit = true;`),
`:1168` / `:1848` / `:1880` / `:1944` (`stopped_eos = true;`), `:1239` (`truncated = true;`) —
none within 1680–1693 (grep of assignments vs. the quoted block). The result therefore serializes
as a normal completion: `cpp/rn-completion.h:132-137` defaults
`bool incomplete = false; / bool context_full = false; / bool truncated = false; / bool stopped_eos = false; / bool stopped_word = false; / bool stopped_limit = false;`
stay false.

### 2.3 Result → JS paths (JSI is shared by both platforms)

1. **Single completion promise.** Loop: `cpp/jsi/RNLlamaJSI.cpp:1249`
   `while (ctx->completion->has_next_token && !ctx->completion->is_interrupted) {`; snapshot:
   `:1319` `CompletionResult result = completionResult(ctx);`; delivery:
   `:1330` `return result.toJsi(rt);`. Serialization, `cpp/jsi/JSICompletion.h:180-187`:

       res["truncated"] = c.truncated;
       res["context_full"] = c.context_full;
       res["interrupted"] = c.is_interrupted;
       res["stopped_eos"] = c.stopped_eos;
       res["stopped_word"] = c.stopped_word;
       res["stopped_limit"] = c.stopped_limit;
       res["stopping_word"] = c.stopping_word;
       res["tokens_cached"] = c.n_past;

   **Yes — `stopped_limit`, `context_full`, `interrupted` already exist** and a
   `governor_failed` + `governor_failure_reason` pair belongs exactly here (and, if the parallel
   path is ever enabled, at `JSICompletion.h:305-316` `parallelCompletionResultJson`, used from
   `RNLlamaJSI.cpp:1512` and `:1563`).
2. **The rejection path already exists** — post-loop check against the binding shadow:

       cpp/jsi/RNLlamaJSI.cpp:1309-1313
           if (ctx->governorFailed()) {
               ctx->completion->endCompletion();
               throw std::runtime_error(
                   "Governor decode failed: " + ctx->governorFailureReason());
           }

   It runs *before* `completionResult(ctx)` at `:1319`, so once the shadow is fixed to fire on
   turn 1, this throw pre-empts the flagged-result path — either delete/softened it (return the
   partial result carrying `governor_failed: true`) or keep it and handle the rejection app-side.
   `governorFailed()` is `cpp/rn-llama.cpp:683-685` `return governor != nullptr && governor->failed();`
   (shadow), declared `cpp/rn-llama.h:165-166`.
3. **Context-released minimal result:** `RNLlamaJSI.cpp:1324-1328`
   `return fromJson(rt, json::object({ {"text", ""}, {"interrupted", true}, {"context_released", true}, }));`
4. **Per-token `onToken` callbacks** (partial text only) — no stop/governor flags.
5. **governor stats already expose a reason string, separately polled:**
   `RNLlamaJSI.cpp:861` `const auto failure = ctx->governorFailureReason();` →
   `:874` `result.setProperty(rt, "failure_reason", jsi::String::createFromUtf8(rt, failure));`.
   On turn 1 this is `""` today (shadow unset, §2.1).
6. **JNI / ObjC bridges are install-only — no per-platform result marshalling to change:**
   `android/src/main/RNLlamaJSI.cpp:12` `Java_com_rnllama_RNLlamaModule_installJSIBindings(`
   → `:34` `rnllama_jsi::installJSIBindings(*runtime, callInvoker);` (built together with the
   shared file per `android/src/main/CMakeLists.txt:33` `${RNLLAMA_CPP_DIR}/jsi/RNLlamaJSI.cpp`);
   `ios/RNLlama.mm:95` `RCT_EXPORT_METHOD(install:(RCTPromiseResolveBlock)resolve` →
   `:118` `rnllama_jsi::installJSIBindings(*runtime, callInvoker);`. One edit in
   `JSICompletion.h` reaches both platforms.

### 2.4 TS result type

- Installed package: `node_modules/llama.rn/src/types.ts:530` `export type NativeCompletionResult = {`
  with `:561` `truncated: boolean`, `:564` `stopped_limit: number`, `:566` `context_full: boolean`,
  `:567` `interrupted: boolean`. The completion entry point is typed
  `node_modules/llama.rn/src/jsi.ts:95` `) => Promise<NativeCompletionResult>`.
- The fork's own copy (same fields): `~/Projects/llama.rn-kalsa/src/types.ts:562-567`
  (`stopped_eos: boolean` … `interrupted: boolean`).
- The app pins the binding by git SHA, so any binding change needs a pin bump:
  `~/Projects/kalsa/package.json:49` `"llama.rn": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2",`.

---

## 3. App: completion handling, `initWithGovernorFallback`, re-invocation, KV

### 3.1 Where a completion result is handled

The turn driver is `streamAssistantTurn` (`src/engine/LlamaService.ts:3981`
`export async function streamAssistantTurn(`), called from `src/app/AppShell.tsx:6628`
`await streamAssistantTurn(`. The completion itself:

    LlamaService.ts:4834  const result = await trackCompletion(
    LlamaService.ts:4837      messages: currentMessages as RNLlamaOAICompatibleMessage[],

Result reads: `:4909` `contextFull: result?.context_full,` (adoption evidence), and the only
structured terminal:

    LlamaService.ts:4934      if (result.context_full) {
    LlamaService.ts:4939          err.code = "context_full";

Turn telemetry reads a structural subset only — `src/engine/turnTelemetry.ts:165`
`export type CompletionLikeResult = {` … `:171` `context_full?: boolean;` /
`:172` `interrupted?: boolean;` / `:173` `truncated?: boolean;`. Governor failure telemetry is
polled post-turn (`:1752` `async function emitGovernorTelemetry(`):

    LlamaService.ts:1782          failed: Boolean(stats.failure_reason),
    LlamaService.ts:1783          failure_reason: stats.failure_reason,
    LlamaService.ts:1786      if (stats.failure_reason) {

today empty on turn 1 (§2.1), so even telemetry says `failed:false` for the truncated turn.

Rejections land in the turn's catch:

    LlamaService.ts:5403      } catch (error) {
    LlamaService.ts:5409          emitEngineError(callbacks, finishOnce, error);

→ `:2973-2979` `function emitEngineError(` … `finishOnce(() => callbacks.onError(errObj));` →
`src/app/AppShell.tsx:6658` `onError: (error) => {` →
`:6671` `callbacks.onDelta?.(\`⚠️ ${error.message}\`, \`⚠️ ${error.message}\`);`.

### 3.2 Where `initWithGovernorFallback` lives and what it needs

It lives in `src/engine/governorRuntime.ts:60-79`:

    60  export async function initWithGovernorFallback<P, R>(
    61    args: RetryArgs<P, R>,
    62  ): Promise<{ value: R; retried: boolean; fallbackReason?: string }> {
    63    if (!args.enabled) {
    64      return { value: await args.init(args.cpuParams), retried: false };
    ...
    68      return { value: await args.init(args.governorParams), retried: false };
    69    } catch (error) {
    70      if (!isGovernorFallback(error, args.nativeLog(), nativeLogAtLoadStart)) throw error;

Inputs (`RetryArgs`, `governorRuntime.ts:4-11`): `enabled`, `governorParams`, `cpuParams`,
`init`, `nativeLog`, optional `nativeLogStart`, `log`. Its gate:

    governorRuntime.ts:35   export function isGovernorFallback(
    governorRuntime.ts:42      return /KALSA_GOVERNOR_FALLBACK|governor.*(fail|reject|invalid)|Governor mode does not support/i.test(
    governorRuntime.ts:43        `${message}\n${newNativeLog}`,

Note this regex already matches the JSI rejection `"Governor decode failed: …"` (`governor.*fail`)
— but it has no decode-time caller (grep: only `governorRuntime.ts` + its test, AUDIT §R5.4).

Its **only** caller is the load path:

    LlamaService.ts:2524     try {
    LlamaService.ts:2526         const cpuParams: ContextParams = { ...params };
    LlamaService.ts:2529         cpuParams.n_gpu_layers = 0;
    LlamaService.ts:2530         cpuParams.n_parallel = 1;
    LlamaService.ts:2531         const governorParams: ContextParams = { ...params };
    LlamaService.ts:2533         const result = await initWithGovernorFallback({
    LlamaService.ts:2537           init: initLlama,
    LlamaService.ts:2547         context = await initLlama(params);   (non-governor branch)

`cpuParams` therefore already exists in scope at 2526-2530 and is exactly the requested reload
config (`n_gpu_layers = 0`, `n_parallel = 1`, `governor`/`speculative` deleted at `:2527-2528`).

### 3.3 Can it be re-invoked mid-session? History / KV

- **The public re-init entry is `initEngine`, not `initWithGovernorFallback`:**
  `LlamaService.ts:2200` `export function initEngine(`. Its idempotent skip is keyed on the
  governor config, so forcing the governor off *does* fall through to a real reload:

      LlamaService.ts:2346       activeGovernorKey === governorKey
      LlamaService.ts:2361     await disposeEngineLocked();
      LlamaService.ts:2363-2366  // Re-check after dispose: timeout / release() failure sets contextHung
                                 // ... Calling initLlama on a hung or half-released native
                                 // context is fail-open (second context + UAF). Fail closed.
      LlamaService.ts:2367       throw new Error(
      LlamaService.ts:2368         "Engine context hung after dispose timeout with active native work; restart the app",

  `governorKey` is `:2332` `const governorKey = governorLoad ? JSON.stringify(governorBase) : "off";`;
  a runtime governor-off reload lands `"off"` at `:2642`
  `activeGovernorKey = governorUsed ? governorKey : "off";`, and `:2646`
  `activeGovernorActive = governorUsed;`. `governorLoad` itself is decided at `:2318`
  `const governorLoad =` (needs thermo + fit + no mmproj + no expert streaming; `:2319-2327`).
  AppShell already re-invokes `initEngine` for model switches (`src/app/AppShell.tsx:4360`,
  `:4986`), proving mid-session re-init is an established path.
- **Locks/lifecycle:** reload must run under the same locks; `LlamaService.ts:1554`
  `// Reverse order deadlocks with disposeEngineLocked / restoreEngineSession`; in-flight
  completions are stopped by dispose (`LlamaService.ts:1684` `* stopCompletion in disposeEngineLocked) and the timer is always cleared.`).
- **Chat history survives:** it lives in JS; every completion passes the current messages by value
  (`LlamaService.ts:4837` `messages: currentMessages as RNLlamaOAICompatibleMessage[],`). A
  dispose+init cannot touch it.
- **KV does NOT survive, and today there is nothing to restore under the governor:**
  - save is skipped while the governor is active: `LlamaService.ts:3139-3142`
    `if (activeGovernorActive) { logGovernorSessionSaveSkip(); return false; }`
    (`:5511` `function logGovernorSessionSaveSkip(): void {` →
    `:5513` `console.log('KALSA_SESSION {"op":"save","ok":false,"reason":"governor-mode"}');`),
    and again for snapshots: `:5520-5521` `if (activeGovernorActive && engine === context) { logGovernorSessionSaveSkip();`.
  - restore is explicitly disabled under the governor: `LlamaService.ts:2666-2668`
    `if (activeGovernorActive && options.sessionRestore?.historyHash) {`
    `console.warn("Governor session restore is disabled until paired KV state exists");`
    `} else if (options.sessionRestore?.historyHash) {`
    → `await tryLoadEngineSession(...)` at `:2669`.
  - `tryLoadEngineSession` (`:3449`) loads only if a matching `.kvs` exists
    (`:3494` `if (!(await sessionFileExists(stem))) {`).
  - Consequence: a mid-session governor→CPU reload loses the in-memory KV and has **no safe disk
    image** from this session (the governor never wrote one). The correct recovery is cold
    re-prefill from `currentMessages` on the next completion, **not** a `sessionRestore` pass —
    passing an old `historyHash` could load a stale `.kvs` from a previous epoch. So: history kept,
    KV rebuilt (latency cost, correctness preserved); "resume" from the partial native KV is
    impossible after dispose, only "retry the turn" is real.

### 3.4 What the user sees today on a truncated turn

- **Turn 1 (ALLOC_FAILED): silent truncation.** The completion resolves normally with all stop
  flags false (§2.2), so no `context_full`/`interrupted` branch fires (`:4934`,
  `:1641` `interrupted: r.interrupted,` telemetry only). If the round produced visible text it is
  committed as a normal answer; the marker only appears when the turn would otherwise be empty:

      src/engine/truncatedTurnText.ts:24-26
        if (args.finalText.length > 0) return args.finalText;
        if (args.streamedVisibleLength > 0) return args.finalText;
        if (args.thinking.trim().length === 0) return args.finalText;
        return args.interruptedMarker;

  callers `LlamaService.ts:4088` and `:4518` `interruptedMarker: strings.chat.interrupted,`;
  `src/i18n/en.ts:481` `interrupted: "Generation was interrupted.",`. The turn ends through
  `finishOnce(() => callbacks.onDone())` (`:5397`), i.e. success. No error, no reload, no retry.
- **Turn 2:** engine short-circuit `-1` (`llama-governor.cpp:163-164`) passes the binding filter,
  shadow flips, JSI throws (`RNLlamaJSI.cpp:1311-1312`
  `"Governor decode failed: " + ctx->governorFailureReason()` → reason `"governor is failed"`),
  caught at `:5403 → :5409`, shown by AppShell as `:6671`
  `callbacks.onDelta?.(\`⚠️ ${error.message}\`, ...)`. The user sees
  `⚠️ Governor decode failed: governor is failed` — the wrong reason, one call late
  (AUDIT §R5.3: "the app does learn, one call later, with the wrong reason").

---

## 4. Tests near each touch point, and jest reach

**How jest is configured in the app** (`jest.config.js`):

    module.exports = {
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/*.test.ts",

No `moduleNameMapper` for `llama.rn` — and value-importing the service is documented as fatal:

    src/engine/sessionMarkerPrivacy.test.ts:3-4
     * closures inside LlamaService.ts, a module no Jest test may import because it
     * value-imports llama.rn.

So jest reaches: (a) pure TS modules, (b) **source text** of the installed binding
(`src/engine/kvShiftRefuse.test.ts:13-14`
`const source = fs.readFileSync(` / `path.join(__dirname, "../../node_modules/llama.rn/cpp/rn-completion.cpp"),`),
(c) source text of `LlamaService.ts` itself (sessionMarkerPrivacy reads it with `fs.readFileSync`),
(d) lockfile/engine-identity (`src/engine/engineIdentity.test.ts:269`
`lock.packages["node_modules/llama.rn"].resolved ?? ""`).

Existing tests per touch point:

| touch point | test | jest? |
|---|---|---|
| app fallback gate | `src/engine/governorRuntime.test.ts:32` `"retries once after a native governor fallback"`, `:70` stale-log test, `:76` epoch test | yes (pure + AsyncStorage mock) |
| app pure modules | `engineParams.test.ts:5` `* Pure module — no AsyncStorage, no llama.rn, loadable under plain node jest.`; `truncatedTurnText.test.ts`, `turnTelemetry.test.ts`, `windowKvInvariant.test.ts:479` (`tokens_evaluated alone never adopts`) | yes |
| app↔binding source guard | `kvShiftRefuse.test.ts:14` (greps `node_modules/llama.rn/cpp/rn-completion.cpp`), `sessionMarkerPrivacy.test.ts` (greps `LlamaService.ts`) | yes |
| app LlamaService orchestration | none importable (sessionMarkerPrivacy.test.ts:3-4) | **no** — source-text only |
| binding TS layer | `llama.rn-kalsa/src/__tests__/index.test.ts:408` `stopped_limit: false,` under `package.json:46` `"test": "jest",` `:120` `"preset": "react-native",` | yes (binding's own jest; never loads cpp) |
| binding native | `tests/CMakeLists.txt:130` `add_executable(governor_params_test governor_params_test.cpp ${RNLLAMA_CPP_DIR}/rn-governor-params.cpp)`, run by `tests/run_tests.sh:86` `if ./governor_params_test; then` | no — host binary |
| engine governor | `tests/CMakeLists.txt:355` `llama_build_and_test(test-governor-v0.cpp LABEL "model" ARGS -m "${MODEL_DEST}")` (+ `-shared-cells`, `-mtp-hybrid`, `-commit`, `-turns`, `-devices`), and `:386-388` `llama_build(test-governor-v02-router.cpp)` / `llama_test(test-governor-v02-router LABEL "router")` | no — ctest |
| engine alloc failure | `tests/test-alloc.cpp` (AUDIT §R4 `:678-679 GGML_ASSERT(!ggml_backend_sched_alloc_graph(...))` ×2) | no — ctest |

**Cannot be tested in jest, anywhere:** engine governor/ggml behavior, binding C++ filters and
JSI serialization (`rn-governor.cpp`, `rn-llama.cpp:668`, `JSICompletion.h`, `RNLlamaJSI.cpp`),
JNI/ObjC bridges, native KV save/restore, the real device OOM, and the LlamaService
reload/retry orchestration (value-imports llama.rn). Jest can only assert *source text* and pure
extracted functions.

---

## 5. Step plan (engine → binding → app), each with a test that goes red

### E1 — Engine: expose the discriminator (2 lines)

Files: `kalsallama src/llama-governor.h` (add public `bool is_failed() const { return failed; }`
after `:31`), `src/llama-governor.cpp:217` (set `failure_reason_` beside `failed = true;`).
Red test (ctest, **not jest**): in `tests/test-governor-v02-router.cpp` (built
`tests/CMakeLists.txt:386-388`, LABEL `router`) drive the flow-control paths that return `-2`
(thermal `Wait` / `requires_reload`) and assert `governor->is_failed() == false` afterwards, plus
the `fail()` path asserting `true` + reason non-null. **Before the accessor exists the test does
not compile — red.** A wrong implementation (keying on `rc != 0`) goes red on the flow-control
assertions. Model-fixture variant possible in `test-governor-v0-turns.cpp`
(`CMakeLists.txt:355-356`, `FIXTURES_REQUIRED test-download-model`). Delivery: engine commit →
`llama.rn-kalsa vendor/VERSIONS` (`LLAMA_CPP_REF=319b539…` today) → app pin
(`package.json:49`) → `scripts/assert-engine-provenance.sh` must pass (AGENTS.md chain).

### B1 — Binding: key the shadow on engine state, serialize the flags

Files (`llama.rn-kalsa`, branch `kalsarn-governor-engine`):
1. `cpp/rn-governor.cpp:52` → `if (result != 0 && (result != -2 || governor_->is_failed()))`
   (flow-control `-2` still ignored; engine-failed `-2` captured; reason falls back to
   `:58` `"llama_governor_decode failed with rc=" …` if the engine reason is absent).
2. `cpp/rn-llama.cpp:668` → same discriminator for the `KALSA_GOVERNOR_FALLBACK` log.
3. `cpp/jsi/JSICompletion.h:181` area → add `res["governor_failed"] = ctx->governorFailed();`
   and `res["governor_failure_reason"] = ctx->governorFailureReason();` (and mirror in
   `parallelCompletionResultJson`, `JSICompletion.h:305-316`).
4. `cpp/jsi/RNLlamaJSI.cpp:1309-1313` → decide: delete the throw so the partial, flagged result
   returns (app controls reload), **or** keep it and handle it app-side (§3.1 catch at 5403).
5. `src/types.ts` + installed `node_modules/llama.rn/src/types.ts` after `:567` →
   `governor_failed?: boolean` / `governor_failure_reason?: string`; bump app pin
   (`package.json:49`).

Red tests:
- **Native, host-only (real logic):** extract the predicate, e.g.
  `bool governor_decode_failed(int rc, bool engine_failed)`, into a header used by
  `rn-governor.cpp`, and extend `tests/governor_params_test.cpp` (pattern:
  `tests/CMakeLists.txt:130`, runner `tests/run_tests.sh:86`) with cases
  `(-2,false)->false` (flow control), `(-2,true)->true` (ALLOC_FAILED), `(-1,true)->true`,
  `(0,false)->false`. Red before the header exists (build failure); red on a naive
  `rc != 0 && rc != -2` implementation at the first case.
- **Binding jest (shape only):** add `governor_failed: false` to the result fixture at
  `src/__tests__/index.test.ts:408` — type error → red until `src/types.ts:566`-area field added.
  It cannot validate the C++ serializer.
- **App jest against binding text (cross-repo red):** new source-text guard modeled on
  `kvShiftRefuse.test.ts:13-14`, reading `node_modules/llama.rn/cpp/rn-governor.cpp` and
  `node_modules/llama.rn/cpp/jsi/JSICompletion.h`, asserting `"governor_failed"` appears and the
  old unguarded filter `result != 0 && result != -2` does not. Red until the pin at
  `package.json:49` moves — which is exactly the delivery-chain gate.

### A1 — App: detect, unload governor, reload CPU-only, retry once

Files (`kalsa`, main):
1. `src/engine/governorRuntime.ts` — add a pure `shouldRuntimeGovernorFallback(...)` (result flag
   and/or error message), next to `isGovernorFallback` (`:35`); reuse the existing regex at `:42`
   for the rejection path.
2. `src/engine/LlamaService.ts` — in the catch at `:5403` (before `emitEngineError` at `:5409`)
   and/or right after the completion at `:4834` (new `result.governor_failed` read, beside
   `:4934`): on detection, force `governorLoad = null` for the session (knob consulted at `:2318`),
   run the established reload (`:2361` `await disposeEngineLocked();` + `initLlama` with
   `cpuParams` semantics `n_gpu_layers = 0` — built at `:2526-2530`), then retry the completion
   once with `currentMessages` (`:4837`) under the engine job chain (`:1554` lock order;
   fail-closed on `contextHung`, `:2363-2368`). Do **not** pass `sessionRestore.historyHash`
   (§3.3: no valid `.kvs` exists under the governor). `activeGovernorActive` flips false at
   `:2646`, re-enabling telemetry/save paths (`:3139`, `:5520`).
3. Optional persist: `writeGovernorEnabled(false)` (`governorRuntime.ts:20`) so the next cold load
   skips the governor — policy decision, not required for the turn to recover.

Red tests (jest-reachable parts):
- `src/engine/governorRuntime.test.ts` — new tests for `shouldRuntimeGovernorFallback`:
  `"governor decode failed with rc=-2"` + `governor_failed:true` → true;
  `"decode engine change requires a full context reload"` (`llama-governor-runtime.cpp:130`
  log text) and `"no safe prefill chunk under the thermal ceiling"` (`:56`) → **false** —
  mirroring the existing stale-log guard at `governorRuntime.test.ts:70-76`. Red on day one
  (function absent), red on a `rc == -2`-keyed implementation (false positive on flow control).
- New source-text guard (sessionMarkerPrivacy pattern, `sessionMarkerPrivacy.test.ts:2-6`)
  asserting `LlamaService.ts` contains the runtime-fallback branch wiring — red until A1 lands.
- Optional: add `governor_failed?: boolean` to `CompletionLikeResult`
  (`turnTelemetry.ts:165-177`) and cover via `turnTelemetry.test.ts`.

**Explicitly not jest-testable:** E1's governor behavior (ctest), B1's filter/serializer behavior
(native `governor_params_test` + device), the JSI rejection, and A1's actual dispose/reload/KV
orchestration (LlamaService cannot be value-imported — `sessionMarkerPrivacy.test.ts:3-4`; the
end-to-end ALLOC_FAILED repro needs the 8 GB S23 with two models loaded, per the problem statement).

Ordering rationale: each layer ships an unambiguous signal the next layer keys on — engine
`is_failed()` (authoritative state, flow-control `-2`s provably never set it),
binding `governor_failed`/`governor_failure_reason` on both the resolved result and the existing
throw, app `shouldRuntimeGovernorFallback` → dispose → `initLlama(cpuParams)` → single retry —
with a source-text jest guard at every hop so a stale pin or missing edit goes red in CI.
