# AUDIT — E1+B1: "a decode-time governor failure reaches JS"

Subjects: engine `56f79e6cb` (kalsallama-wt-oom, branch `kalsa-opencl-upload-oom-throw`);
binding `1c932556` (vendor bump) + `fa98fb09` (code) on `kalsarn-governor-engine`.
Read-only, no builds. Claims checked: `../governor-runtime-fallback/RECON.md`,
`../governor-runtime-fallback/E1-B1.md`.

**Verdict: SHIP-WITH-FIXES.**

The engine change and the `governor_decode_failed` predicate are correct, and the step does change
what the app sees: on the first real decode failure the binding shadow is now set, so the JSI throws
`"Governor decode failed: <first-turn reason>"` instead of the old silent truncation followed by a
generic -1 on the next call. But the two new result fields `governor_failed` /
`governor_failure_reason` can **never be true on the completion path the app uses** — the JSI throw
at `RNLlamaJSI.cpp:1309-1313` runs before the serializer at `:1319`. They are deliverable only on
the queued `queueCompletion` / `cancelRequest` paths, which kalsa does not call (grep: no
`queueCompletion`/`cancelRequest` anywhere under `kalsa/src`). So the fields are dead API for the
only consumer; either soften/remove the throw (the RECON's own item 4) or drop the fields. Two
report corrections: `BUILD_NUMBER` was 11202, not 11211, and the engine commit exists on no remote.

---

## F1 — Q1: dead-field risk — CONFIRMED (dead on the app's path; alive on the queued path)

The single completion path, in order:

    rn-completion.cpp:1680    if (parent_ctx->decode(llama_batch_get_one(&embd[n_past], n_eval)))
    rn-completion.cpp:1682        LOG_ERROR("failed to eval, ...");
    rn-completion.cpp:1690        embd.resize(n_past);
    rn-completion.cpp:1691        has_next_token = false;
    rn-completion.cpp:1692        return result;              // no flag, no throw, partial result

    RNLlamaJSI.cpp:1309        if (ctx->governorFailed()) {
    RNLlamaJSI.cpp:1310            ctx->completion->endCompletion();
    RNLlamaJSI.cpp:1311            throw std::runtime_error(
    RNLlamaJSI.cpp:1312                "Governor decode failed: " + ctx->governorFailureReason());
    RNLlamaJSI.cpp:1313        }
    RNLlamaJSI.cpp:1319        CompletionResult result = completionResult(ctx);   // serializer, unreachable on failure

`governorFailed()` is the binding shadow (`rn-llama.cpp:683-684 return governor != nullptr &&
governor->failed();` -> `rn-governor.h:35 failed_`), and `fa98fb09` makes the predicate set it on
the first real failure. The shadow is therefore true exactly when the throw fires, and the throw is
unconditional and precedes the only `completionResult` call site on this path (`:1319`; a throw
instead of a value means `result.toJsi` at `:1330` never runs). Consequence: on the path the app
uses, `governor_failed` is structurally always `false` and `governor_failure_reason` always `""` in
delivered results. The writer's "Not verified" discloses the throw, but the B1 headline ("the fields
ride on every non-throwing result") reads as though the failure is delivered in-band; it is not.

A true value is deliverable on the queued path, which is why the literal claim "no path can ever
deliver it" is REFUTED:

    rn-slot-manager.cpp:1015        int ret = parent_ctx->decode(batch);     // governor-aware
    rn-slot-manager.cpp:1017-1031   on ret != 0: log, halve n_batch, return false
    rn-slot-manager.cpp:1465-1473   bool success = process_batch(); if (!success) { ... complete_slot(slot); }
    rn-slot-manager.cpp:1042-1048   complete_slot -> on_complete(&slot)
    RNLlamaJSI.cpp:1512             json result = parallelCompletionResultJson(slot->parent_ctx, ...);
    JSICompletion.h:317-318         {"governor_failed", ctx->governorFailed()}, {"governor_failure_reason", ...}

and on the cancelled-queue snapshot (`RNLlamaJSI.cpp:1563 parallelCompletionResultJson(ctx, ...)`).
No throw guards either. kalsa uses neither (`engine.completion` at `LlamaService.ts:1292` is the JSI
`completion` path). **CONFIRMED: the fields are an API the only consumer can never observe true.**
If the intent was "the app reads the flags instead of the rejection", the throw must be softened
(RECON item 4); if the intent was "the rejection carries the reason", the fields should be dropped.

## F2 — Q2: predicate false positives / negatives — REFUTED (no counterexample found; sound)

Flow-control -2 cannot be seen together with a set engine flag: `decode_impl` short-circuits first
and returns **-1** when already failed, and every flow-control return is before the rc site:

    llama-governor.cpp:163    if (failed) {
    llama-governor.cpp:164        return fail("governor is failed");      // fail() returns -1 (cpp:151-156)
    llama-governor.cpp:182-187    if (policy_enabled_) { ... policy_rc ...; if (policy_rc != 0)
                                      return policy_rc == k_prefill_chunked ? 0 : policy_rc; }   // the only -2 exits
    llama-governor.cpp:214-224    const int32_t rc = llama_decode(target, batch);
                                  if (rc != 0) { ...snprintf...; failure_reason_ = decode_failure_reason_;
                                                 failed = true; return rc; }

So the only nonzero rc that returns without `failed = true` is the policy path, and those values are
exactly the flow-control -2s (plus the -1001 sentinel converted to 0 at :186). An ALLOC_FAILED -2
comes from `llama_decode`, where `failed = true` is set at :223 before the raw rc is returned at
`:224` — no false negative. The prefill/decode handoff failure goes through `fail()` at `:209`
(rc -1, failed set), also caught. `failed` is sticky: there is no reset anywhere (grep: writes at
`:153`, `:223` only); a reload that re-creates the governor resets it, and the binding's shadow
likewise has no reset (`rn-governor.h:46`, nothing in `rn-governor.cpp:68-71`). The binding
evaluates the predicate on every call (`rn-governor.cpp:52`), so the shadow cannot lag the engine
state by more than the call that sets it. **CONFIRMED sound.** (Minor, PLAUSIBLE: `rc == 1`,
llama.cpp's "no KV slot", marks the governor permanently failed; consistent with `rc != 0` but a
hard-stop for a transient condition.)

One engine-side semantics note (PLAUSIBLE, no app impact): the first-turn reason is overwritten by
`fail("governor is failed")` on the *next* decode call (`:163-165`), so a direct engine consumer that
calls twice sees the good reason only once. The binding caches it at `rn-governor.cpp:56`, so
`governorFailureReason()` keeps the first-turn string — which is what the JSI uses.

## F3 — Q3: the fallback log fires exactly once — CONFIRMED

    rn-llama.cpp:666    const bool was_failed = governor->failed();
    rn-llama.cpp:667    const int32_t result = governor->decode(batch);
    rn-llama.cpp:668    if (governor_decode_failed(result, governor->engine_failed()) && !was_failed) {

`was_failed` is the shadow before the call; the shadow is set inside the same call
(`rn-governor.cpp:53`) on the first real failure, and every later call short-circuits at
`rn-governor.cpp:45` (`if (failed_ || governor_ == nullptr) { failed_ = true; ... return -1; }`) with
`was_failed == true`. Exactly one log per governor object lifetime; a reload that re-creates the
governor is a new lifetime and gets its own log. Cosmetic nit: `stage` is `"decode"` for every
non-"route Reject" failure (`rn-llama.cpp:673`), including a prefill-side ALLOC_FAILED.

## F4 — Q4: vendor bump — identity CONFIRMED; report error CONFIRMED; provenance PLAUSIBLE

`git show --stat 1c932556` -> 12 files, +61/-21: the four engine files (`ggml-alloc.c` 31/6,
`ggml-backend.cpp` 4/1, `llama-governor.cpp` 6/0, `llama-governor.h` 6/0), `vendor/VERSIONS`,
`common/build-info.cpp`, `ggml-version.h`, `llama-version.h`, `src/version.ts`, and the four
generated `lib/*` files. Byte identity re-derived here, not trusted from the report:

    sha256(engine 56f79e6cb:<file>) == sha256(vendor/llama.cpp/<file>)   for all four -> EQUAL
    vendor/VERSIONS:8-9   LLAMA_CPP_REF=56f79e6cb... / LLAMA_CPP_COMMIT=56f79e6cb...
    engine diff --stat 319b53937 56f79e6cb: 37/5/6/6 on those four, tests excluded from the export

nothing else under `vendor/` changed (`--numstat` shows only the 8 expected paths); no patch under
`scripts/patches/llama.cpp/` touches the four files (grep -> none). **CONFIRMED.**

Report error, **CONFIRMED**: the report says `src/version.ts 11211/319b539 -> 11212/56f79e6`, but
the pre-image is `export const BUILD_NUMBER = '11202'` (`git show ef901304:src/version.ts`); the diff
is 11202 -> 11212. The post-value is right, the pre-value is a fabrication-adjacent slip (no state
changed), fix the report.

Provenance, **PLAUSIBLE** (disclosed by the writer): `git branch -a --contains 56f79e6cb` lists only
the local `kalsa-opencl-upload-oom-throw`; `git rev-parse --abbrev-ref @{upstream}` -> fatal. The
sync cache was seeded from the worktree, so nobody else can reproduce the vendored bytes until the
engine commit is pushed to `Aspis0/kalsallama` (needs Marco's approval + audit). The app pin
(`kalsa/package.json:49` -> `0288dc27`) is unchanged, so nothing is live yet; but this bump also
vendors the whole rounds 1-3 OOM series into the binding, so the push ordering matters.

## F5 — Q5: tests — red for the right reason by read; ALLOC_FAILED -2 untested end-to-end — CONFIRMED

- Router (`test-governor-v02-router.cpp:301-318`): `llama_governor waiting(llama_governor_params{})`
  uses the **public** one-arg constructor (`llama-governor.h:12`, `llama-governor.cpp:19-25`,
  `policy_enabled_(true)`), so `select_decode` runs with null contexts, returns -2 at
  `llama-governor-runtime.cpp:127` without touching them. The checks `rc == -2`,
  `!waiting.is_failed()`, `failure_reason() == nullptr` go red exactly when a flow-control site sets
  `failed` — right reason, exit 1 via the `check()` counter (`:13-16`, `:350-353`). CONFIRMED by read.
- Turns (`test-governor-v0-turns.cpp:446-504`): `bad = vocab.n_tokens() + 1` fails
  `llama_batch_allocr::init` (`llama-batch.cpp:51-53 invalid token[...] -> return false` ->
  `llama-context.cpp:1734-1736 return -1`), which is the governor's rc site (`llama-governor.cpp:214`).
  Sabotaging `failed`/reason there fails `if (!gov->is_failed())` -> `return false` -> main returns 1.
  Right reason. The stickiness step's expected reason is `"governor is failed"` because the second
  call short-circuits at `:163-164` — matches the code. CONFIRMED by read.
- **The out-of-vocab trick drives the rc site with -1; it cannot exercise -2.** That is acceptable
  for the site because the site is rc-agnostic (`if (rc != 0)` at `:215` is the only branch), and the
  predicate's `(-2, true)` case is unit-tested (`tests/governor_params_test.cpp:110-115`,
  `!(-2,false) && (-2,true)`). What remains untested end-to-end is the actual
  `GGML_STATUS_ALLOC_FAILED` -2 route (scheduler/gallocr OOM -> `llama_context.cpp:1883` -> governor
  -> binding log) and the binding-side log/JS delivery. Declared in "Not verified"; no injection
  hook exists, so this is a coverage statement, not a defect. CONFIRMED (limited).
- No global state is mutated by the new tests (local governors/contexts; the shared `model` is
  passed read-only); nothing to restore. The binding's jest additions only assert `false`/`""`
  (there is no way to produce a true in jest), and the types-only red (TS2339) is a compile gate,
  not a behavioural one — declared.

## F6 — Q6: secrets / privacy — REFUTED (clean)

Every writer of `failure_reason_`: `fail()` at `llama-governor.cpp:151-156` with the literals at
`:164`, `:167`, `:172`, `:209`, plus `llama-governor-runtime.cpp:51`, `:124`; and the new
`"llama_decode failed with rc=%d"` (`llama-governor.cpp:220-222`). Constructor errors
(`llama-governor.cpp:32/35/40/46/53`) are literals too and never reach the member. The only dynamic
content is the rc integer, and the invalid-token log prints the id only. No model path, tensor name,
prompt, KV, or user text can flow into `governor_failure_reason`, `governorFailureReason()`
(`rn-llama.cpp:687-688`), the `KALSA_GOVERNOR_FALLBACK` log (`rn-llama.cpp:671-674`), or logcat via
this path. **CONFIRMED clean.**

## F7 — Q7: clean-code checklist

PASS: no new files; no God file (`JSICompletion.h` 341 lines, `rn-governor.h` 51,
`rn-governor.cpp` 91 — under the ~350 line); one responsibility per new unit
(`governor_decode_failed` is a one-line predicate, `is_failed()` a one-line accessor); no globs,
no preventive `pub`, no re-exports; comments state WHY and their invariants are true (the
flow-control contract, the `fail()`-collapses-rc rationale, the first-turn reason); no secret
values; tests added to existing topical files rather than a new list. The 48-byte
`decode_failure_reason_` is large enough (worst case `"llama_decode failed with rc="` + 11-char
int32 + NUL = 39) and `snprintf` truncates safely.

PLAUSIBLE (API still-life): `governor_failed`/`governor_failure_reason` are an API nobody can
observe true on the only consumer's path (F1) — the clean-code rule "no types or APIs nobody
constructs yet" is arguably violated; either wire them (soften the throw) or delete them.

PLAUSIBLE (latent): `failure_reason_` points into the sibling member `decode_failure_reason_`
(`llama-governor.h:89-91`). The class has a user-declared destructor, so copy construction is still
implicitly available and would copy the pointer, leaving it aimed at the source object's buffer.
No copy exists today (the governor is only heap-allocated in the init bridge), so this is latent,
not a live bug.

---

## What I could not verify

- No build, no run, no device: every red/green exit code (router 1, turns 1, ASan, jest 13/45,
  typecheck 2/0, `make rnllama_tests`) is the writer's evidence, re-derived here only by code read.
- The queued-path delivery of `governor_failed: true` in an actual run; the JSI runtime path on a
  phone; and whether `parallelCompletionResultJson`'s json reaches `onComplete` unchanged (the JS
  wrapper was not traced beyond `resolveResult(result)`).
- Whether the engine's `is_failed()`-based predicate ever meets an engine rc other than -1/-2 in the
  field (the six flow-control -2s are static; a runtime trace would confirm).
- The app pin bump was explicitly out of scope; the engine commit is still unpushed, so no shipped
  artifact contains any of this.

---

## Fix round — re-audit of binding `c7cb889f` + `42087667`, engine `64816dd2c` + `e6200cc02`

**Verdict: SHIP-WITH-FIXES.** Every E1-B1 finding is closed or explicitly declared: the dead
result fields are gone from the whole tracked repo, the eval-failure log no longer prints token
text, the throw prefix is pinned, and the self-referential pointer is covered by a checked
non-copyability invariant. The remaining items are report hygiene (the engine tip in the Fix-round
text), one over-strong guard comment, and a pre-existing prompt-in-logcat exposure outside the
ordered scope. Nothing here blocks shipping the binding/engine pair.

### G1 — dead fields gone everywhere — CONFIRMED (closed)

    git grep -l "governor_failed\|governor_failure_reason" HEAD   -> EXIT=1, 0 files

also absent from the built `lib/typescript/types.d.ts`; `JSICompletion.h` lost both serializer
lines (-6), `src/types.ts` lost the two optional fields, the jest mock/snapshot assertions and the
snapshot lines are reverted. `governorFailed`/`governorFailureReason` themselves are still used by
the throw (`RNLlamaJSI.cpp:1309-1312`) and the stats poll (`RNLlamaJSI.cpp:861`), so the accessors
are not dead code. CONFIRMED.

### G2 — prefix guard — CONFIRMED present and red-for-the-right-reason; comment overstates

    src/__tests__/nativeSourceGuards.test.ts:17
        expect(cpp('jsi/RNLlamaJSI.cpp')).toContain('"Governor decode failed: "')

matched against `RNLlamaJSI.cpp:1311-1312 throw std::runtime_error("Governor decode failed: " +
ctx->governorFailureReason());`. A prefix change makes `toContain` fail, so the claimed red is for
the right reason. Two weaknesses, neither blocking: (a) `toContain` searches the whole file, so the
literal surviving in a comment after the throw is deleted would leave the guard green, and it does
not pin the reason concatenation; (b) the guard's comment claims "The app recognizes a decode-time
governor failure by this prefix", which is not true yet — the app's `isGovernorFallback` is only
called from `initWithGovernorFallback` (`kalsa/src/engine/governorRuntime.ts:70`, load path), and the
decode-time consumer is the A1 step, not built. PLAUSIBLE (documentation), fix the comment wording.

### G3 — eval-failure privacy — CONFIRMED closed on the eval-failure paths; one exposure remains elsewhere

    cpp/rn-completion.cpp:1684-1688
        LOG_ERROR("failed to eval, n_eval: %d, n_past: %d, n_threads: %d",
            n_eval, n_past, parent_ctx->params.cpuparams.n_threads);

The token argument and `tokens_to_str` are gone. Every other eval-failure log in the file carries
counts only: `:1359 failed to eval speaker prefix, rows=%d`, `:1410 failed to eval talker prefix,
rows=%d`, `:1624 failed to eval codec_lm TTS embd, n_past: %d`, `:1659 failed to eval continuous TTS
prompt, n_eval/n_past`, `:2239 llama_decode() failed during benchmark, n_batch/ret`. CONFIRMED.

    src/__tests__/nativeSourceGuards.test.ts:23-27
        const logStatement = cpp('rn-completion.cpp').match(
            /LOG_ERROR\("failed to eval, n_eval[\S\s]*?\);/,
        )
        expect(logStatement).not.toBeNull()
        expect(logStatement![0]).not.toContain('tokens_to_str')

The anchor is correct: the only `LOG_ERROR("failed to eval, n_eval` in the file is the fixed one
(the TTS line at `:1659` starts `failed to eval continuous TTS prompt, n_eval`, so no false match);
the first-draft red that matched `:1359` cannot recur. The guard is narrow by construction — it
covers that one statement only, so a token text added to another eval log would pass. PLAUSIBLE
(narrow guard), declared as a source-text guard.

**Still leaking prompt text elsewhere (pre-existing, outside the ordered scope):**

    cpp/rn-completion.cpp:710-714  LOG_VERBOSE("prompt ingested, n_past: %d, cached: %s, to_eval: %s",
                                       ..., tokens_to_str(... embd ...), tokens_to_str(...))
    cpp/rn-completion.cpp:578-580  rnllama::log("WARNING", ..., "KALSA_KVDIVERGE ... shared_txt=[%s]", ...)
    cpp/rn-completion.cpp:1946     LOG_VERBOSE("EOS: %s", common_token_to_piece(...))

`:710-714` prints the entire ingested prompt and the pending eval span at VERBOSE; `:578-580`
prints clipped (200-char) prompt text at WARNING; `:1946` prints one generated token. The eval-
failure leak was fixed on the same reasoning that applies verbatim to `:710`. Not a regression and
not in this order, but the owner should decide whether those belong in logcat (the KVDIVERGE line
looks like deliberate diagnostic instrumentation). PLAUSIBLE (pre-existing exposure).

### G4 — non-copyable pin — CONFIRMED true invariant

    tests/test-governor-v02-router.cpp:15-20
        // guard is the std::mutex inside llama_governor_stall_union (member
        // stall_union_), which makes the copy operations implicitly deleted.
        static_assert(!std::is_copy_constructible<llama_governor>::value, "llama_governor must not be copyable");
        static_assert(!std::is_copy_assignable<llama_governor>::value,    "llama_governor must not be copy-assignable");

    llama-governor-metrics.h:56   mutable std::mutex mutex_;
    llama-governor.h:84           llama_governor_stall_union stall_union_;

`std::mutex` is non-copyable and non-copy-assignable, so a class holding it by value has both copy
operations implicitly deleted and the asserts are true; if the mutex ever leaves the union, the
asserts go red at compile time, which is exactly the stated pin. `<type_traits>` is included
(`:7`). Limits: the pin is host-test-only, and the vendored `56f79e6cb` copy carries no tests/, so
the shipped library has no compile-time guard of its own — harmless, because the binding only holds
a `llama_governor *` and cannot copy the object (`rn-governor.h:44`). CONFIRMED.

### G5 — nothing else changed — CONFIRMED; one report staleness

- `c7cb889f` 7 files: the field removals (`JSICompletion.h` -6, `types.ts` -4, jest mock/test/snap),
  the `rn-completion.cpp` privacy fix, the new 29-line guard file. The diff reviewed line by line:
  no other semantic change.
- `42087667` 2 files: comment dedup + one blank line, nothing else (`grep -c` 4 -> 1).
- `64816dd2c` `tests/test-governor-v02-router.cpp` +9 lines; `e6200cc02` same file +2/-1 comment.
- Report staleness, CONFIRMED: the Fix-round text names the engine tip as `64816dd2c`; the actual tip
  is `e6200cc02` (the comment-only follow-up). Harmless, but the report should name both or the tip.

### G6 — vendor still right for shipping — CONFIRMED

    git diff --stat 56f79e6cb e6200cc02   ->   tests/test-governor-v02-router.cpp | 10 +
    ls vendor/llama.cpp/tests            ->   No such file or directory

The only delta between the vendored pin and the engine tip is the two test-file commits, and the
vendored export has no `tests/` directory, so the delta cannot touch the vendored subtree; the four
byte-identity hashes from the previous round still pin `56f79e6cb`. Deferring the re-bump until the
push decision is exactly right — but note the vendored `src/llama-governor.h` still carries the
self-referential pointer with no test pin in the binding build, which is why G4's host pin matters
only in the engine tree. CONFIRMED.

### Fix-round findings summary

| # | finding | verdict |
|---|---|---|
| G1 | Dead result fields gone from the repo (and lib/), accessors still used | CONFIRMED (closed) |
| G2 | Prefix guard present and red on a prefix change; `toContain` is loose and its comment claims an A1 behaviour | PLAUSIBLE (docs) |
| G3 | Eval-failure log text-free; all other eval-failure logs counts-only; guard narrow but correctly anchored | CONFIRMED (closed) |
| G3b | Prompt text still reaches logcat at `:710-714` (VERBOSE) and `:578-580` (KVDIVERGE WARNING) | PLAUSIBLE (pre-existing, out of scope) |
| G4 | `static_assert` non-copyability holds via `std::mutex`; comment now names the real guard | CONFIRMED |
| G5 | No unclaimed changes; report still names engine tip `64816dd2c` instead of `e6200cc02` | CONFIRMED / CONFIRMED (report error) |
| G6 | Engine delta is tests-only and the export has no `tests/`; `56f79e6cb` remains the right pin | CONFIRMED |
| — | F2/F3/F5 from the original audit untouched (predicate sound, one log, ALLOC_FAILED -2 still untested) | unchanged |

Not re-verified (no builds/runs): the jest/lint/typecheck/native gates and both sabotage reds; the
guards are read as source text, and their red-on-sabotage claim is the writer's.
