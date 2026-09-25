# AUDIT — binding `1f841412` + `b23fc083` (governor typed pause)

**Verdict: SHIP.** The typed pause is honest (a real eval failure cannot be reported as a pause, and
a classified pause cannot fall into the eval-error path on the covered decode paths), both defects
luna found in `1f841412` are fixed in `b23fc083`, and the host now understands the fourth literal.

## CONFIRMED — a real failure cannot be reported as a pause, nor the reverse

    cpp/rn-llama.cpp:682-683    if (result == -2 && !governor->failed()) {
    cpp/rn-governor.h:16-17     return rc != 0 && (rc != -2 || engine_failed);
    vendor/llama-governor.cpp:295-296   failed = true; return rc;   (any nonzero rc)

A raw engine `-2` (e.g. GGML_STATUS_ALLOC_FAILED) passes the governor's rc site which latches
`failed`; the binding's shadow predicate then returns true, the classifier `if` is skipped, and the
completion keeps the unchanged failure branch:
`LOG_ERROR("failed to eval, n_eval: %d, n_past: %d, n_threads: %d", …)` + `embd.resize(n_past);` +
`has_next_token = false;` (`rn-completion.cpp:1732,1740-1741`). Conversely every flow-control `-2`
with an unfailed governor receives a label (all branches of `cpp/rn-llama.cpp:698-704` assign), so
`decode_rc == -2 ? parent_ctx->governorPause() : nullptr` (`rn-completion.cpp:1716-1717`) always
takes the pause branch for it. The JSI path is sealed too: `if (!c.governor_pause.empty())
res["pause_reason"] = c.governor_pause;` (`cpp/jsi/JSICompletion.h:188-192`) only fires for a
resolved pause, while a failure still arrives as the "Governor decode failed: " throw (the
governor never fails for a pause).

## CONFIRMED — `last_router_rule == 0` is the governor's own Wait stamp, not stale

    llama-governor-policy.h:15       uint32_t rule = 0;                (struct default)
    llama-governor-policy.cpp:206-212  early Wait/Abort return, no rule assigned
    llama-governor-policy.cpp:235-244  table==0: Wait returns with rule still 0
    llama-governor-policy.cpp:270      result.rule = {2,3,9} only on the admitted/chunk path
    llama-governor-runtime.cpp:81      stats_.last_router_rule = admission.rule;  (before the Wait return)
    llama-governor-runtime.cpp:55      refresh_policy_stats(): last_router_rule = policy_.prefill_rule();  (decode entry)

The multi-token branch reads the stats of its own decode; the admission of that call writes the rule
(0 on Wait), so a prior completion cannot leak its rule into the label. The single-token branch does
not read the rule (`stats.decode_requires_reload`, rewritten per `select_decode` call). The
`Unknown` case is checked first and is mutually exclusive with the table Wait (a valid profile
always classifies). `unexplained` has no live producer with the engine synced in `531b477b`
(`1b70069cb`: the `count <= 1` path is unreachable), but it is the right label if one ever appears —
never thermal.

## REFUTED — speculative/MTP is not a typed-pause gap

    cpp/rn-llama.cpp:748,755     if (governor_enabled) { … if (has_speculative_mode(params_)) … }
    cpp/rn-completion.cpp:847-849  if (parent_ctx->hasGovernor()) { return false; }

Governor mode refuses or falls back on speculative/MTP, so the `parent_ctx->decode(spec_batch)`
sites (`rn-completion.cpp:1036,1135`; `cpp/rn-slot.cpp:533,615`) cannot produce a governor pause
while the governor is active. The TTS/bench raw `llama_decode` sites bypass the wrapper entirely.

## CONFIRMED — the cross-completion leak is closed; no log leak

`1f841412` left `governor_pause` set for later completions; `b23fc083` adds
`governor_pause = "";` inside `rewind()` (`cpp/rn-completion.cpp:104`), and every completion
entry reaches rewind (`RNLlamaJSI.cpp:1175`, `rn-tts.cpp:1959`). The new warning carries only the
literal reason and counts:
`LOG_WARNING("governor paused decode (%s), n_eval: %d, n_past: %d", pause, n_eval, n_past);`
(`rn-completion.cpp:1727-1728`) — no prompt/model text.

## PLAUSIBLE — guards, declarations, host

- The jest guards are source-slice substring checks (declared): luna's scratch shows a
  `if (false)` dead rewind reset still passes. Test-quality, not runtime behaviour; no native build
  was run by the writer or luna, and I did not run one either.
- `src/types.ts` and the regenerated `lib/typescript/types.d.ts` both carry
  `pause_reason?: 'thermal' | 'profile' | 'reload' | 'unexplained'` (declaration grep = 2), and the
  guard compares the TS union against the generated declaration.
- The app at its current HEAD (`bad66ec2`) handles all four literals:
  `thermalResume.ts:23 GovernorPauseReason = "thermal" | "profile" | "reload" | "unexplained";`,
  `:37 reason === "unexplained"`, and `governorPauseEnding` returns `"serviceUnreachable"` for any
  non-thermal pause (`thermalResume.ts:50-56`), with `resumeWhileCooling` looping only on
  `"thermal"` (`:163` region). So an `unexplained` result is neither cool-and-resumed nor silently
  finalized as a normal completion. Luna's app-gap finding is REFUTED at this HEAD.

## Left as declared / not verified

- No native build or device run (binding commit declares it; the classifier's engine stamps were
  verified here by reading the vendored engine, `1b70069cb`, synced in `531b477b` byte-for-byte).
- `pause_reason` for the parallel/slot serializer is not emitted (the single-completion serializer
  only); parallel slots are disabled in governor mode (`rn-llama.cpp:752-754`), so no live path.
