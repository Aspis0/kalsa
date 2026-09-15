# PLAN — product-suite (live)

Goal: keep live chat KV across prefix-identity flips and do not idle-unload while native work (completion, FIFO job, lifecycle op, model switch, download) is in flight.

## Applied (2026-09-13)

- K-shift refuse (this apply, llama.rn patch only): S23 2bbef14 T20C parent-verified t1–4 `n_common==embd` 4617→7379 start=0 hasDigest=false; t4 loadPrompt `n_common=7379 text_tokens=8033`; mid-decode `KALSA_NATIVE info update: applying K-shift` (`llama-kv-cache.cpp` L912 `LLAMA_LOG_DEBUG("%s: applying K-shift\n", __func__)`); TELEMETRY `tokensCached:**4304**` tokensEvaluated:8033 predicted:365 prompt_n:654; save usedTokens:**4304** then extract restore 4304; t5 `n_common=0 embd=4304 text_tokens=4976` heads disjoint. Cause: JS `ctx_shift: true`; `nextToken` `seq_rm`+`seq_add` with `n_discard = n_left/2` when `embd.size() >= n_ctx`; hybrid `seq_add` hits attn+recr (`llama-memory-hybrid.cpp`); `pos_add` frees `pos<0`. 4304 is n_past after half-context discard (~n_ctx/2 + leftover decode), not SWA `get_used` and not hybrid `pos_max` min. Fix: refuse the shift, keep live KV / checkpoints, do not set `context_full` (anchored forceRebuild would clearCache). skip_ckpt / recover_trim kept (`n_tokens=2360 pos_max=2973`). kalsallama + `vendor/kalsallama-cpp` unchanged. No clearCache JS.
- e8c8886: planner skip when KV holds chat; idle dispose treats completion/FIFO as in-flight.
- luna FIX on e8c8886: wipe-job recheck; idle includes native-op chain + modelSwitch.
- luna re-audit FIX: wipe lock order + prewarm TOCTOU + deferred-dispose download/switch gate.
- stall watchdog (this apply): `GENERATION_STALL_GAP_MS=45_000`; decode rate is trailing-window telemetry only and no longer an abort condition. S23 T20B abort was a live first-think-token gap, not a hang. Foreground idle is not a generation watchdog.
- ciswire assemble clamp (this apply): do not shrink JS window while live KV holds the full chat. S23 96d3d06 T20C t10: `KALSA_KVPREFIX embd=7840 text_tokens=4219 n_common=0` + `KALSA_KVDIVERGE n_common=0 shared_lo=0` after save tokens=7840. T20B t13: `embd=7905 text_tokens=4205 n_common=0`. Turns 1–9/12 had `n_common == embd` growing (1829 → 7284 / 7655). Hole: digest-share `windowStartIndex` + `loadedB==null` kept the slid start; ciswire `decideAssembleWindowAction` still slid. Off-mode clamp (c7801f9) did not cover that. No clearCache.
- luna FIX AUDIT-CISWIRE-WINDOW: sample `kvHeld`+`loadedB` together after `await getBenchLegacyWindow` (no pre-await hold). Clamp to `loadedB` only when `getLoadedAssembleBoundary` is non-null (same-chat live KV, unknown start → 0). Hold-false + stale nPast + conv mismatch (`loadedB === null`) keeps `computedStart`; do not treat 0 as a known boundary.
- ciswire digest-share while flags stale (this apply): f441b3d 20t T20C t10 quoted `KALSA_KVPREFIX embd=7189 text_tokens=4173 n_common=0` (4173/7189=0.58 = `WINDOW_SHARE_WITH_DIGEST` 0.6). t1–9 `n_common==embd` 1829→7101. `ciswireFlags=3`. No `KALSA_STALL`. Clamp to `loadedB` was not enough: JS sized as digest-share so `kvHeld` was false (`hasDigest: retrievalOn && !kvHeld`). Hold / `lastChatNPast` dropped (LlamaService 2051, 4489, 4557, 4564, 4714, 4826). Source of truth is `lastChatNPast>0` OR `kvHoldsChatSession` OR last save tokens. One `KALSA_WINDOW` log per send. No clearCache. No stallWatchdog / llama.rn patch.
- luna FIX AUDIT-DIGEST-SHARE (84f6195): last-save hint is engine+conversation bound; native-empty paths (dispose, utility overwrite/clearCache, failed extract restore, invalidation, markChatKvCleared) null the fingerprint. Flag-only hold drop keeps it (t10). `KALSA_WINDOW` logs `nPast` / `lastSaveTokens` as null, not `?? 0`.
- luna FIX AUDIT-DIGEST-LATCH (this apply, on 94dd4e5): t10 is hasDigest=true while native still has ~7k tokens. Do not claim native-empty (`dropChatKvHold(true)` / `lastSuccessfulSessionSave=null`) unless `clearCache` succeeded (or overwrite completion returned / context released). Invalidation tries `clearCache` then drop(true) only on success, else drop(false). Failed extract restore same. Utility/completeOnce: drop(true) after clearCache success or after overwrite completion returns; clearCache catch → drop(false). t10 flag-only drop(false) still keeps fingerprint. No stallWatchdog / llama.rn patch.
- luna FIX AUDIT-DROP-HOLD (this apply, on b907290 — next APK, do not 20t that build): a returned completion is not native-empty. `nativeEmptyForHoldDrop` is true only for `clearCacheSucceeded` or `contextReleased` (dispose). Removed `overwriteCompletionReturned`. After extract/utility completion, do not drop(true) unless clearCache succeeded; restore success sets hold/nPast; restore fail + clear fail keeps fingerprint (t10). Failed session load uses `dropHoldAfterOptionalNativeClear` instead of `markChatKvCleared` / drop(true). No stallWatchdog / llama.rn patch.
- Qwen history think strip after KALSA_WINDOW (this apply): S23 9151f78 T20 digest-share FIX held t2–5 (`n_common==embd`, start=0 hasDigest=false). t6 WINDOW still kvHeld nPast=8009 lastSaveTokens=8009 loadedB=0 hasDigest=false legacyWindowStart=0 textEst=306, then `KALSA_KVPREFIX embd=8009 text_tokens=4438 n_common=0` KVDIVERGE shared_lo=0 heads disjoint (4438/8009=0.55). Cause: `llamaHistoryAssistantFields` split `<think>` into `reasoning_content`; Qwen 3.5 Jinja history (`loop.index0 <= last_query_index`) emits `content` only, so the tokenized prompt drops think tokens native stored. Empty-string `reasoning_content` + raw span in `content` for non-`preserveThinking` models (LFM still splits). Window charges `modelEmittedText`. No digest inject while kvHeld. No clearCache.

## Native dead-end (2026-09-14, parent-verified in source)

`ctx_shift` is **unsound by construction** on the shipped model. No patch to `llama.rn` or
kalsallama can fix it. Chain read line by line in `/tmp/llama.rn-clean/package/cpp/`:

- LFM2.5-2.6B (`ModelRegistry.ts:220`) is `LLM_ARCH_LFM2`, in `llm_arch_is_hybrid`
  (`llama-arch.cpp:955`) -> `llama_memory_hybrid` = attn + recr.
- `llama_memory_hybrid::seq_add` forwards to **both** halves (`llama-memory-hybrid.cpp:162-165`).
- `llama_memory_recurrent::seq_add` only does `cell.pos += shift` (`:322-331`). The state is
  never touched.
- `seq_rm` supports `rm_all` or a **tail** rollback bounded by `n_rs_seq` only (`:170-171`,
  `:184`). Source comment: "models like Mamba or RWKV can't have a state partially erased".
- `n_rs_seq` = `params.speculative.need_n_rs_seq()` = 0 with no draft model
  (`common.h:389-395`); `llm_arch_supports_rs_rollback` covers only QWEN35/QWEN35MOE
  (`llama-arch.cpp:981-988`), so requesting >0 is clamped to 0 for LFM2.

Real effect at n_ctx=8192: `seq_rm(0, n_keep+1, ~4096)` with `cell.pos~8191` fires **no**
recurrent branch. The recurrent state stays intact encoding all 8192 tokens while attention
loses 4095 from the middle and is renumbered. Two halves, two different sequences ->
`tokensCached=4304` -> `n_common=0`. Evicting a prefix from a running summary is not
implementable: the past is not addressable.

Extending `llm_arch_supports_rs_rollback` to LFM2 would give tail rollback (useful to
checkpoints) and **nothing** to the ceiling. The KV-quant lever is already spent:
`cache_type_k` is already `q8_0` (`LlamaService.ts:1509`).

## Current direction (owner decision 2026-09-14)

The ceiling is handled in JS, deliberately, before it is reached. Slide the window under
`n_ctx - WINDOW_RESERVE_TOKENS` (6144 on S23), take an explicit `clearCache` and one full
prefill, `n_common=0` by choice once every N turns, with a UI state while it reprocesses.
Below the ceiling nothing changes: `start=0`, KV held, `n_common == embd`.

- Ceiling slide on disk (uncommitted), luna-audited and fixed. Order is compute-boundary -> clear
  only if it moves -> advance only if the clear succeeded, so a no-op slide can no longer destroy
  live KV. Tool rounds re-check the ceiling and stop instead of handing the native an over-ceiling
  prompt. `off` / `ciswire` are deliberately NOT covered this apply.

### 2026-09-15 correction after the T20C run

The repeated slide is not primarily an abort-recovery problem. The compactor computes a useful
start (`22`, `25`, `27`, `29`, ...), but the live tool KV is normally not reproducible from the
rendered history, so `shouldSaveSession` correctly refuses the `.kvs` write. The next send has no
saved assemble boundary and clamps the computed start back to `0`; the ceiling guard then clears
and slides again.

Measured in `out/t20c-rerun2-20260914/logcat.txt`:

- session save `ok:true`: **11**;
- session save `ok:false`: **38**, of which **35** are `kv_not_reproducible`;
- `KALSA_WINDOW_SLIDE`: **23**;
- `window_align ... to:0`: **23**.

Fix v2 was checkpointed as `b6c2104` on top of `c4d3f6f`. It contained two
separable ideas:

1. Persist the measured static-prefix token count by model/build + locale + exact system/tool
   identity, hydrate it in `initEngine`, and keep the send guard synchronous. This removes the
   accidental dependency on prewarm/context lifetime. `KALSA_PREFIX_FALLBACK` is restored with
   distinct reasons. **Open:** reject or ignore persisted measurements that are implausible for
   the active `n_ctx`; otherwise a poisoned high value collapses the ceiling to zero and prevents
   the prewarm that could replace it.
2. Persist `windowSlideBoundary` in `.kvs` metadata after a successful clear, to recover a slide
   whose following turn does not complete. The final protocol below removes this design entirely:
   it depends on the save that tool turns intentionally refuse and can advance the logical window
   without a corresponding successful clear.

### 2026-09-15 final protocol (GLM + DeepSeek committee, converged)

The dominant bug was a protocol error, not missing session persistence. `kv_not_reproducible`
answers whether a live tool KV can be serialized and replayed byte-for-byte; it does **not** say
that its absolute history start is unknown. Turn 12 proves the distinction: round 0 reused
`6042/6042` tokens from start 11 and returned a tool call, then only round 1 was stopped by
`KALSA_TOOL_CEILING`. The old whole-turn outcome discarded the already-proven start 11, so the
next send aligned `11 -> 0`, priced 10211 tokens and slid again.

Final state machine (this apply):

- stream entry keeps the previous same-chat boundary fact; it never installs the new requested
  boundary before native work, so `a21746e` stays closed;
- prompt-start adoption is monotone and independent from whole-turn completion: any token callback
  or returned `tokens_cached > 0` (`n_past`, actual native progress) installs the attempted start;
  `tokens_evaluated` is explicitly not evidence because llama.rn exports the planned prompt size;
- tool ceiling, later-round abort, or interrupted prefill retain/install the factual start once
  adoption happened; `kv_not_reproducible` continues to gate only session saving;
- held KV + same-chat boundary uses that boundary with no clear; held KV + unknown boundary performs
  one mandatory clear before assembly in **all** context modes. A failed clear invalidates the fact
  and aborts the send instead of assembling from 0 against unknown native state;
- the only extra carrier is an in-process attempted logical start for the killed-before-adoption
  case. It is never persisted and never treated as native state; process death also destroys the
  RAM KV, so durability is unnecessary;
- `meta.assembleBoundary` is omitted when unknown; missing is read as unknown, never fabricated 0;
- `windowSlideBoundary` and all its `.kvs`/stream plumbing are removed.

Static-prefix persistence is now schema v2 `{tokens,nCtx,at}`, capped to the 32 newest exact
model/build + locale + system/tool identities. Both write and synchronous read reject counts at or
above `nCtx - WINDOW_RESERVE_TOKENS`; an invalid value falls back with
`measurement_implausible_for_active_nctx` instead of collapsing the ceiling to zero. A failed
hydrate cannot overwrite the unknown durable map. No await was added to the send guard.

Parent verification after integration: `tsc --noEmit` exit 0; five targeted Jest suites
**168/168**, exit 0. This is code proof only, not device proof.

### 2026-09-15 S23 T20C result and foreground-idle correction

The adoption protocol broke the repeated-slide loop on device. The incomplete campaign in
`out/t20c-fixprotocol-20260915/` produced 17 alignments with one initial `to:0` only, six
monotone successful slides, and the factual boundary ratchet
`0 -> 4 -> 10 -> 15 -> 17 -> 20 -> 28 -> 36`. The process-death recovery returned at boundary
17. There were no held+unknown sends, so `window_reconcile` was not exercised. Only 8 campaign
turns were collected completely; five never landed through the share UI, so the run is
incomplete and G2 is not claimed.

The first causal failure was independent of the KV protocol. A healthy in-flight generation
(`KALSA_STALL` count 0) began at 16:37:33 and was unloaded at 16:55:19 with
`model.unload {reason:"idle", idleMs:1065655}`. The foreground-idle policy deliberately treated
15 minutes as a stuck-generation escape and entered the discard lifecycle, which aborted the
live turn. The fix removes that age escape at both decision points: foreground idle never
disposes while any send, completion, engine job, lifecycle op, model switch, or download is in
flight. Quiet foreground idle still disposes at 180 seconds; background and trim keep their
forceful semantics. Prefill, decode-gap, and stall watchdogs remain the only generation-hang
owners.

DeepSeek hostile audit found no P0/P1. Parent verification: `tsc --noEmit` exit 0, five targeted
Jest suites 28/28, and `git diff --check` clean. The audit identified two non-blocking follow-ups:
AppShell wiring lacks an integration-level test, and a truly wedged JS-only await outside an
engine job can keep the engine resident in the foreground. Those paths need their own bounded
awaits, not a return of the idle age escape.

## Still open

- The eight JS fixes each ran 20 turns on the S23 and each surfaced the next hole; none
  reached a clean run. The blocker was never a missing device run, it was the n_ctx ceiling.
- `4004117` (K-shift refuse) does not fix the ceiling either: it turns corruption into a
  silently truncated answer (native sets `truncated=true`, no JS consumer reads it) and the
  `loadPrompt` path still raises `context_full` before `n_common` is computed.
- Fresh debuggable APK built from `244c6c0` with `:app:assembleDebug --rerun-tasks` (548 tasks,
  `BUILD SUCCESSFUL`) and installed with `adb install -r` on the S23 only. Artifact SHA-256:
  `ffe1690956569997446b61a9326a2e097ca1de85abc0f9360a957abf031c8c4d`. Manifest reports
  `application-debuggable`, `run-as com.kalsa.app id` succeeds, and all seven arm64 engine
  variants in the APK contain `kalsa-native-patches`, `q23k`, `KALSA_KVDIAG`, and
  `restored state checkpoint`. The 09-14 APK remains invalid for this protocol and must not be
  reused.
- Re-run S23 T20C with the foreground-idle fix after producing and installing a new debuggable
  APK. Preserve the same pass conditions: no repeated `window_align ... to:0`, monotone slides,
  and one successful `window_reconcile` before assembly whenever held+unknown is reached.
- Add a focused AppShell wiring test for both foreground-idle checks without duplicating the
  in-flight source of truth. Separately bound JS-only tool/pre-turn awaits that are not covered by
  an engine-job watchdog.
- G2 not claimed.

## Constraints

- Targeted tests only. No full Jest. No push. Device work is pinned to the S23 serial above;
  never contact the Jelly Star.
- The previous debuggable APK is installed, but it predates the foreground-idle correction. The
  last campaign left the S23 unplugged, force-stopped, and at 18%; recharge before the next run,
  then unplug before measuring. Never reuse the 09-14 APK for this protocol.
- Do not duplicate the KV-hold boolean. Do not reshuffle `engineJobPendingCount` (TDZ REFUTED).
- Do not reverse lock order vs dispose (lifecycle then wait engineJob). Wipe attaches to lifecycle synchronously after the disposing check.
