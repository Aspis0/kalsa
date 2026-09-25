NO

Scope: binding commit 1f841412b10698e9b29d4290c1bb1442415c98f8 (2ba2bbc9 parent), branch kalsarn-governor-engine. The branch HEAD advanced during this audit to 1e86815f; I did not move or modify the checkout. Source citations and the sabotage archive are pinned to the requested commit. The pre-existing untracked pnpm-lock.yaml and pnpm-workspace.yaml remain untouched.

## Findings

1. **CONFIRMED — a non-thermal chunking -2 is mislabeled as a thermal pause.**

   > “the caller-chunking -2s need a chunk smaller than an admitted row, which the internal chunk loop cannot produce.” — cpp/rn-llama.cpp:689-690
   >
   > “const int32_t count = std::min<int32_t>(next.tokens, remaining);” / “if (count <= 1) { return -2; }” — vendor/llama.cpp/src/llama-governor-runtime.cpp:108-110

   This is reachable: “n_batch = 2048” is the common default (vendor/llama.cpp/common/common.h:453), and ordinary completion caps only at that value (cpp/rn-completion.cpp:1612-1617). The table is “{ 128, 512, 1024, 2048 }” (vendor/llama.cpp/src/llama-governor-policy.cpp:14), and below the warn line it preserves the 128-token row (:211-219). With a valid measured GPU route (:173-177), an unplugged 39°C profile, and a 513-token batch, the partition pass can choose 128-token chunks, then reject the final one-token remainder. At 39°C the unplugged thresholds have warm_enter=38.0 and classify returns WARM at or above warm_enter (policy.cpp:43-44, 69-80), so the binding emits thermal (cpp/rn-llama.cpp:694-697). It builds the partition before decoding any chunk (runtime.cpp:94-120). This is not a thermal refusal and can make the host retry the same impossible partition.

2. **CONFIRMED — pause reason leaks into later completions.**

   > “std::string governor_pause;” — cpp/rn-completion.h:139
   >
   > “ctx->completion->rewind();” — cpp/jsi/RNLlamaJSI.cpp:1175
   >
   > “if (!c.governor_pause.empty()) {” / “res[\"pause_reason\"] = c.governor_pause;” — cpp/jsi/JSICompletion.h:188-192

   I read the entire rewind body (cpp/rn-completion.cpp:73-108): it resets fields including “generated_text = \"\";” (:90) and “n_past = 0;” (:103), but never clears governor_pause. So a successful ordinary completion after a pause carries the previous pause_reason, contradicting the comment “a normal completion never carries it” (JSICompletion.h:190).

3. **REFUTED — native decode failures returning raw -2 are not classified as pauses.**

   > “if (result == -2 && !governor->failed()) {” — cpp/rn-llama.cpp:682
   >
   > “return rc != 0 && (rc != -2 || engine_failed);” — cpp/rn-governor.h:16-17
   >
   > “failed = true;” / “return rc;” — vendor/llama.cpp/src/llama-governor.cpp:295-296

   The wrapper latches native failures before the binding checks the gate (cpp/rn-governor.cpp:51-60), including raw engine rc -2, so this condition separates native eval failure from an unfailed flow-control return.

4. **REFUTED — the post-decode stats read is not stale under the documented threading contract.**

   > “refresh_policy_stats();” — vendor/llama.cpp/src/llama-governor.cpp:252
   >
   > “stats_.thermal_state = policy_.thermal_state();” — vendor/llama.cpp/src/llama-governor-runtime.cpp:49
   >
   > “stats_.decode_requires_reload = selection.requires_reload;” — vendor/llama.cpp/src/llama-governor-runtime.cpp:137
   >
   > “// Threading contract: decode(), set_thermo_profile(), record_telemetry(),” / “// note_expert_route(), and stats() are decode-thread methods and must not overlap.” — vendor/llama.cpp/src/llama-governor.h:15-16

   The read is from the policy state refreshed for that decode. It is the latest profile supplied to policy, not a guarantee that the physical sensor sample itself is fresh.

5. **REFUTED — MTP/speculative -2 is not silently converted into a zero-token pause.**

   > “if (has_speculative_mode(params_)) {” / “throw std::runtime_error(\"Governor mode does not support speculative or MTP decoding\");” — cpp/rn-llama.cpp:748-755
   >
   > “if (parent_ctx->hasGovernor()) { return false; }” — cpp/rn-completion.cpp:847-849
   >
   > “throw std::runtime_error(\"failed to evaluate MTP target batch, ret=\" + std::to_string(ret));” — cpp/rn-completion.cpp:1132-1135

   Outside governor mode decode() calls raw llama_decode (cpp/rn-llama.cpp:668-670), so these speculative paths cannot produce this governor pause outcome.

6. **REFUTED — the real-error cleanup was not removed.**

   > Parent: “LOG_ERROR(\"failed to eval, n_eval: %d, n_past: %d, n_threads: %d\",” and “embd.resize(n_past);” — cpp/rn-completion.cpp:1713, 1720
   >
   > Current: “LOG_ERROR(\"failed to eval, n_eval: %d, n_past: %d, n_threads: %d\"," — cpp/rn-completion.cpp:1728
   >
   > Current: “embd.resize(n_past);” / “has_next_token = false;” — cpp/rn-completion.cpp:1736-1737

   Only a classified pause suppresses the eval-error log and emits a warning; the ordinary error cleanup remains.

7. **REFUTED — the new binding warning contains no prompt or model text.**

   > “LOG_WARNING(\"governor paused decode (%s), n_eval: %d, n_past: %d\"," — cpp/rn-completion.cpp:1723
   >
   > “? \"profile\"” / “: \"thermal\";” / “? \"reload\" : \"profile\";” — cpp/rn-llama.cpp:695-699

   The arguments are fixed reason strings and token counts; no user or model text reaches this log.

8. **CONFIRMED — the Jest guard detects missing text but does not pin behavior.**

   > “expect(source).toContain('result == -2 && !governor->failed()')” — src/__tests__/governorPauseSurface.test.ts:18
   >
   > “expect(source).toContain('res[\"pause_reason\"] = c.governor_pause;')” — src/__tests__/governorPauseSurface.test.ts:41

   It only checks fragments, not control flow, chunker outcomes, or rewind reset. In a scratch archive, baseline passed 4/4; deleting the JSI assignment made it fail at line 41; making the classifier condition false && result == -2 && !governor->failed() still passed because the checked substring remained. The stale-field defect also passes baseline.

9. **REFUTED — no added API is dead code.**

   > “const char * governorPause() const { return governor_pause_; }” — cpp/rn-llama.h:177
   >
   > “decode_rc == -2 ? parent_ctx->governorPause() : nullptr” — cpp/rn-completion.cpp:1714
   >
   > “pause_reason?: 'thermal' | 'profile' | 'reload'” — src/types.ts:580

   The added getter, completion field, JSON output, and TS union have call-site/use-site references.

## Checks

- npm ci --ignore-scripts --no-audit --no-fund > /tmp/audit-binding-install.log 2>&1; echo "EXIT=$?" — EXIT=0 (scratch archive only).
- npx jest src/__tests__/governorPauseSurface.test.ts --runInBand > /tmp/audit-binding-jest-baseline.log 2>&1; echo "EXIT=$?" — EXIT=0, 4 tests passed.
- Scratch sabotage, remove res["pause_reason"] = c.governor_pause: same targeted Jest command — EXIT=1, failed at the expected assertion.
- Scratch false-positive sabotage, make the classifier condition false && ... while retaining the checked substring: same targeted Jest command — EXIT=0, 4 tests passed.
- No native build/runtime test or TypeScript check was run. The test harness only reads source; native pause behavior and sensor freshness remain unverified at runtime.

## Re-audit — binding b23fc083 (parent 1e86815f)

NO

The two prior runtime defects are closed. The guard rejects the earlier false classifier gate, though a rewind-reset false positive remains below. One host integration gap makes the overall verdict NO.

1. **REFUTED — last_router_rule is not stale on a classified prefill Wait.**

   > “stats_.last_router_rule = policy_.prefill_rule();” — vendor/llama.cpp/src/llama-governor-runtime.cpp:54
   >
   > “stats_.last_router_rule = admission.rule;” — vendor/llama.cpp/src/llama-governor-runtime.cpp:73
   >
   > “refresh_policy_stats();” / “const int32_t policy_rc = is_prefill ? admit_prefill(batch, allow_chunking) : select_decode();” — vendor/llama.cpp/src/llama-governor.cpp:252-253
   >
   > “const llama_governor_stats stats = governor->stats();” — cpp/rn-llama.cpp:696
   >
   > “uint32_t rule = 0;” — vendor/llama.cpp/src/llama-governor-policy.h:15
   >
   > “if (admission.decision == llama_governor_decision::Wait) {” / “return -2;” — vendor/llama.cpp/src/llama-governor-runtime.cpp:77-83
   >
   > “return result;” — vendor/llama.cpp/src/llama-governor-policy.cpp:240

   The policy starts an admission with rule 0 and returns from its Wait branch before assigning an admit/chunk rule (vendor/llama.cpp/src/llama-governor-policy.cpp:202, 231-240, 252). Runtime writes that current admission rule before returning the -2. A prior completion's rule is overwritten on this path; there is no explicit zero reset, but it is not relied on. The latched-CPU early path returns 0 or fails the governor rather than producing a classifiable -2 (vendor/llama.cpp/src/llama-governor-runtime.cpp:58-66).

2. **REFUTED — a genuine thermal Wait is not relabeled profile or unexplained.**

   > “if (stats.thermal_state == llama_governor_thermal_state::Unknown) { governor_pause_ = \"profile\"; } else if (stats.last_router_rule == 0) { governor_pause_ = \"thermal\"; } else { governor_pause_ = \"unexplained\"; }” — cpp/rn-llama.cpp:698-704
   >
   > “stats_.thermal_state = policy_.thermal_state();” — vendor/llama.cpp/src/llama-governor-runtime.cpp:49
   >
   > “if (!profile_valid_ || !have_profile_ || !std::isfinite(now_c) ||” — vendor/llama.cpp/src/llama-governor-policy.cpp:206
   >
   > “if (prompt_tokens < k_table_tokens[0] && below_warn) {” / “result.decision = llama_governor_decision::Wait;” — vendor/llama.cpp/src/llama-governor-policy.cpp:231-240
   >
   > “result.rule = requested == llama_governor_engine::NPU ? 2 : requested == llama_governor_engine::CPU ? 9 : 3;” — vendor/llama.cpp/src/llama-governor-policy.cpp:252
   >
   > “result.decision = state_ == llama_governor_thermal_state::Invalid ||” / “? llama_governor_decision::Abort : llama_governor_decision::Wait;” — vendor/llama.cpp/src/llama-governor-policy.cpp:209-212
   >
   > “return fail(\"prefill admission aborted\");” — vendor/llama.cpp/src/llama-governor-runtime.cpp:74-75
   >
   > “int32_t batt_temp_tenths_c = 0;” — vendor/llama.cpp/src/llama-ext.h:271
   >
   > “return profile.batt_temp_tenths_c / 10.0f;” — vendor/llama.cpp/src/llama-governor-policy.cpp:23

   Unknown state takes the profile label first. For a valid, non-Unknown thermal Wait, the default rule remains 0 and the binding chooses thermal; admitted/chunk decisions receive nonzero rules at vendor/llama.cpp/src/llama-governor-policy.cpp:252. Invalid/critical admission aborts and latches failure instead of reaching this pause classifier. The non-finite check cannot create a separate non-thermal case with this profile shape: batt_temp_tenths_c is int32_t (vendor/llama.cpp/src/llama-ext.h:271), and current_temperature_c divides that integer by 10 (vendor/llama.cpp/src/llama-governor-policy.cpp:23, 295).

3. **CONFIRMED — the original thermal mislabel is fixed for the synced engine path.**

   > “else if (stats.last_router_rule == 0) { governor_pause_ = \"thermal\"; } else { governor_pause_ = \"unexplained\";” — cpp/rn-llama.cpp:700-703
   >
   > “if (prompt_tokens - result.tokens == 1) { result.tokens = prompt_tokens; }” — vendor/llama.cpp/src/llama-governor-policy.cpp:249-251

   The old 513-token/128-row case no longer reaches the one-token partition refusal in the vendored engine. If a nonzero-rule -2 does reach this binding, it is now labeled unexplained rather than thermal. This narrow engine read is context only; I did not re-audit the parent engine sync.

4. **CONFIRMED — the completion leak reset is present.**

   > “governor_pause = \"\";” — cpp/rn-completion.cpp:104
   >
   > “ctx->completion->rewind();” — cpp/jsi/RNLlamaJSI.cpp:1175
   >
   > “main_ctx->completion->rewind();” — cpp/rn-tts.cpp:1959

   The completion entry points reach rewind, which now clears the serialized field.

5. **CONFIRMED — the app does not handle the new unexplained label as a pause.**

   > “export type GovernorPauseReason = \"thermal\" | \"profile\" | \"reload\";” — app src/engine/thermalResume.ts:21
   >
   > “only the three known literals count, everything else is \"not paused\"” — app src/engine/thermalResume.ts:26-29
   >
   > “return reason === \"thermal\" || reason === \"profile\" || reason === \"reload\"” / “: null;” — app src/engine/thermalResume.ts:32-35
   >
   > “while (pauseReasonOf(result) === \"thermal\" && !stopped())” — app src/engine/thermalResume.ts:163
   >
   > “return result;” — app src/engine/thermalResume.ts:199

   For pause_reason = unexplained, pauseReasonOf returns null, so resumeWhileCooling returns the result without retrying or emitting cooling phases. In LlamaService the pause-specific post-loop branch is thermal-only (“if (pauseReasonOf(result) === \"thermal\")”, app src/engine/LlamaService.ts:5103); a no-tool result enters the ordinary final path, “if (!toolCallingEnabled || !toolCalls.length || !options?.executeTool)” / “emitFinalText(result)” (app src/engine/LlamaService.ts:5180-5182). That path marks the assemble completed and calls onDone (“assembleOutcome = markAssembleOutcome(assembleOutcome, \"completed\");” / “finishOnce(() => callbacks.onDone());”, app src/engine/LlamaService.ts:4670-4673). Thus it avoids an unsafe cool-and-resume but silently finalizes an unresolved flow-control result as an ordinary completion if this label is emitted. App source was read at HEAD 9bb7a1cb; the app worktree was not changed.

6. **CONFIRMED — the earlier false-gate sabotage goes red, but the rewind guard still admits dead code.**

   > “expect(block(cpp('rn-llama.cpp'), 'if (result == -2 && !governor->failed())', 'return result;')).toBe(” — src/__tests__/governorPauseSurface.test.ts:45-47
   >
   > “expect(rewind).toContain('incomplete = false; governor_pause = \"\"; n_remain = 0;')” — governorPauseSurface.test.ts:89

   Targeted Jest baseline passed 6/6. In the scratch archive, changing the classifier gate to false && result == -2 && !governor->failed() failed at the missing start marker (EXIT=1), as claimed. But replacing the real rewind reset with an if (false) block containing that same reset sequence passed all 6 tests (EXIT=0): the rewind guard is a substring assertion, not a control-flow comparison. The reset implementation itself is correct.

7. **CONFIRMED — the generated declaration's union matches the source.**

   > “pause_reason?: 'thermal' | 'profile' | 'reload' | 'unexplained'” — src/types.ts:582
   >
   > “pause_reason?: 'thermal' | 'profile' | 'reload' | 'unexplained';” — lib/typescript/types.d.ts:530
   >
   > “expect(declaredUnion).toEqual(sourceUnion)” — src/__tests__/governorPauseSurface.test.ts:105

   The targeted guard passed the source/declaration comparison. I did not rerun the generator, tsc, or a native build; declaration content is verified, but generation provenance and runtime rule stamping are not.

### Re-audit checks

- Scratch-only setup: npm ci --ignore-scripts --no-audit --no-fund — EXIT=0.
- npx jest src/__tests__/governorPauseSurface.test.ts --runInBand — EXIT=0 (6 tests).
- Earlier false && classifier sabotage in scratch — EXIT=1 at “start marker not found”.
- Dead reset retained only inside if (false) in scratch — EXIT=0 (6 tests); this exposes the rewind-guard gap above.
- No app or binding source was modified. Binding HEAD is b23fc083; its pre-existing untracked pnpm lock files remain.

## Final

SHIP

1. **CONFIRMED — F5 is closed by the app at `bad66ec2`.**

   > `export type GovernorPauseReason = "thermal" | "profile" | "reload" | "unexplained";` — app `src/engine/thermalResume.ts:23`
   >
   > `reason === "unexplained"` — app `src/engine/thermalResume.ts:37`
   >
   > `return pause === "thermal" ? "coolingTimedOut" : "serviceUnreachable";` — app `src/engine/thermalResume.ts:55`
   >
   > `if (ending === null) return false;` / `emitEngineError(... strings.chat.serviceUnreachable ...)` / `return true;` — app `src/engine/LlamaService.ts:3135-3157`
   >
   > `endOnGovernorPause(result, turnId, round, callbacks, finishOnce, strings)` — app `src/engine/LlamaService.ts:5179-5182`

   Every recognized non-thermal label, including `unexplained`, now ends visibly through the existing service error path after the cooling loop rather than being finalized as an ordinary completion.

2. **YES — F6 is an acceptable declared limitation for this verdict; it does not block.** The actual reset is present in C++:

   > `governor_pause = "";` — binding `cpp/rn-completion.cpp:104`
   >
   > `What stays unpinned without a native build` — binding `src/__tests__/governorPauseSurface.test.ts:11`
   >
   > `expect(rewind).toContain('incomplete = false; governor_pause = ""; n_remain = 0;')` — binding `src/__tests__/governorPauseSurface.test.ts:89`

   The reset guard still accepts the previously demonstrated `if (false)` sabotage (recorded above, Re-audit checks); it is a real test-quality gap. The test header's stronger claim that “the rewind reset ... [has] to match” (`src/__tests__/governorPauseSurface.test.ts:5-7`) overstates what that substring assertion proves. I accept the disclosed lack of native control-flow execution here because the reset itself is present and the binding range adds no non-vendor runtime behavior; the guard should not be cited as proof of that invariant.

3. **CONFIRMED — binding range `b23fc083..531b477b` adds no non-vendor runtime change; it does change version metadata.** `git diff --stat` lists `src/version.ts` and three generated `lib/*/version*` files in addition to vendor files. The non-vendor diff is only:

   > `BUILD_NUMBER = '11223'` → `'11224'`; `BUILD_COMMIT = '6581c7a'` → `'1b70069'` — binding `src/version.ts:1-2` (same values in `lib/commonjs/version.js`, `lib/module/version.js`, and `lib/typescript/version.d.ts`).

   Therefore “no non-vendor binding files changed” is literally false, but “no non-vendor binding behavior changed” is accurate. The requested non-vendor functional review is unchanged from b23.

4. **Scope/evidence:** binding HEAD read as `531b477b30e9e2b2981ebd799e773b97a69c4105`; app HEAD read as `bad66ec2a7f72a8e3c77911c359bf361d1d27da6`. Binding `git diff --stat b23fc083 531b477b` reports 11 files, 53 insertions and 26 deletions; all non-version implementation changes are under `vendor/`. No native build was run in this final pass. The independent binding review also states `**Verdict: SHIP.**` — `governor-cooling-ux/AUDIT-BINDING-DEEPSEEK.md:3`.
