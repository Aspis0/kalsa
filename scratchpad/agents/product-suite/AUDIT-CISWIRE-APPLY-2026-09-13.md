# CISWIRE APPLY audit — 2026-09-13

Reviewer: gpt-5.6-luna  
Writer: grok-4.6  
Verdict: **FIX**

Scope: current working tree, AppShell/LlamaService wiring, digest sizing,
session state, races, and tests. G2 excluded.

## Bottom line

Do not SHIP/APPLY. The narrow null-versus-zero helper bug is fixed, but the
live-KV invariant is not transactionally enforced. `windowKvInvariant` is
18/18, `sessionPersistence` is 24/24, and `tsc --noEmit` exits 0. Those are
not production integration tests.

## Findings

**CONFIRMED in code; PLAUSIBLE for the specific S23 t10 state — same-chat
does get a non-null `loadedB` under the normal successful-turn path.** A
stream records B and the conversation before entering the FIFO, then its
`finally` marks the resident engine as held:

> `LlamaService.ts:3066-3076`
> ```ts
> lastAssembleBoundary = sessionAssembleBoundary({
>   assembleBoundary: options.assembleBoundary,
> });
> lastAssembleConvId =
>   typeof options.assembleChatId === "string" && options.assembleChatId.length > 0
>     ? options.assembleChatId
> return withEngineJob(async () => {
> ```

> `LlamaService.ts:4215-4218`
> ```ts
> if (engine === context && !disposing) {
>   kvHoldsChatSession = true;
> ```

With the same active ID, `getLoadedAssembleBoundary` returns the recorded B
(or `0` when B was undefined), and `assembleStartForLiveKv` uses it. But the
S23 telemetry does not emit `loadedB`, the two conversation IDs, or the
ownership snapshot. “t10 definitely clamped” is therefore not device-
confirmed.

**REFUTED — the exact old APPLY defect is gone.** The caller samples bench
configuration first, then `kvHeld` and `loadedB`; the helper no longer accepts
`kvHeld` and no longer converts `null` to zero:

> `AppShell.tsx:5298-5303`
> ```ts
> const benchWindow = await getBenchLegacyWindow();
> const kvHeld = kvHeldForAssembleWindow({ ... });
> const loadedB = getLoadedAssembleBoundary(chatId);
> ```

> `windowKvInvariant.ts:86-93`
> ```ts
> if (args.mode === "anchored") return args.computedStart;
> if (args.loadedB !== null) return args.loadedB;
> return args.computedStart;
> ```

**CONFIRMED — `hasDigest` is still keyed to `kvHeld`, not `loadedB`.**

> `AppShell.tsx:5314-5317`
> ```ts
> hasDigest: retrievalOn && !kvHeld,
> ```

Yet retrieval and operative-block injection remain independent:

> `AppShell.tsx:5598-5606`
> ```ts
> const injectBlock = shouldInjectOperativeBlock(
>   userTurnCount - 1,
>   await getBenchDigestCadence(),
> );
> if (injectBlock && (state.frozenDigest || state.rollingSummary)) {
>   operativeContext = {
>     digest: state.frozenDigest || undefined,
>     summary: state.rollingSummary || undefined,
>   };
> }
> ```

`windowProfile.ts:122-128` explicitly defines `hasDigest` as retrieval being
on. The wiring contradicts that contract. **PLAUSIBLE consequence:** when
`kvHeld` is true but `loadedB` is null (or a newly available digest is injected),
the prompt is sized as bare while carrying digest content. A normal non-null
`loadedB` turn discards the computed start, so this is not proof that t10’s
clamp itself failed; it is still a bad state split.

**CONFIRMED — the “computed once” value is not a synchronization barrier.**
After the snapshot, AppShell performs multiple async reads/writes and then
uses the original `legacyWindowStart`:

> `AppShell.tsx:5445-5469`
> ```ts
> const loadedB = getLoadedAssembleBoundary(chatId);
> if (loadedB !== null) {
>   state = { ...state, boundaryIndex: loadedB };
>   await AsyncStorage.setItem(
>     compactorStorageKey(chatId),
>     serializeCompactorState(state),
>   );
> }
> ```

> `AppShell.tsx:5615-5622`
> ```ts
> if (!anchoredOn) boundaryForAssemble = legacyWindowStart;
> const assembled = assembleEngineHistory(...);
> ```

The later B read only updates compactor state; it does not re-clamp the
assembly start. Clear, restore, dispose, or a switch can occur in the gap.
**PLAUSIBLE consequence:** stale B is assembled against a changed native
context, or a newly live B is missed. `streamAssistantTurn` queues later and
captures `context` inside the FIFO, so the snapshot and native context are not
one transaction.

**CONFIRMED — positive `nPast` still grants stale ownership.**

> `LlamaService.ts:1177-1184`
> ```ts
> kvHeld: kvHoldsChatSession ||
>   (typeof lastChatNPast === "number" && lastChatNPast > 0),
> ```

> `LlamaService.ts:2855-2859`
> ```ts
> const wasActive = getSessionConversationId() === conversationId;
> if (wasActive) kvHoldsChatSession = false;
> await deleteSessionsForConversation(conversationId);
> ```

Invalidation leaves `lastChatNPast`, B, the conversation ID, and native KV
untouched. The new fallback can therefore suppress a required slide/clear or
return a foreign B when IDs happen to match. The “hold false + nPast” test is
not this case: `windowKvInvariant.test.ts:225-230` deliberately uses
`storedConv: "native-a"` and `activeConv: "js-b"`, forcing `loadedB` to null.

**CONFIRMED — failed and aborted turns can publish an unearned live B.** B/ID
are written before the queued job, and the unconditional successful-looking
hold is set in `finally`:

> `LlamaService.ts:3066-3076,4215-4218`
> ```ts
> lastAssembleBoundary = sessionAssembleBoundary({
>   assembleBoundary: options.assembleBoundary,
> });
> return withEngineJob(async () => {
>   // ...
> });
> // finally:
> kvHoldsChatSession = true;
> ```

There is no success predicate. AppShell’s recovery flag is only for
`anchored + context_full` (`AppShell.tsx:5735-5745`); ciswire/off failures do
not clear or invalidate this metadata. **PLAUSIBLE consequence:** the next
turn clamps to a partial/dead prefix or repeats context-full.

**PLAUSIBLE — switch/clear interleaving remains reachable.** Conversation UI
state changes before bind/restore:

> `AppShell.tsx:2297-2316`
> ```ts
> applyConversations(setActive(..., id));
> ...
> bindActiveConversation(id);
> await restoreEngineSession(modelId);
> ```

The send path reads the active ID at `AppShell.tsx:5234` but receives
`messagesRef.current` at `AiChatPage.tsx:2501-2503`. There is no identity check
immediately before assembly/native submission. UI generation guards can reject
the result; they do not prevent the stale pre-submit snapshot or the global B
metadata from being written.

**CONFIRMED — persisted B has no upper bound.**

> `sessionPersistence.ts:473-486`
> ```ts
> if (
>   typeof n === "number" &&
>   Number.isInteger(n) &&
>   Number.isFinite(n) &&
>   n >= 0
> ) {
>   return n;
> }
> ```

> `compactor.ts:794-802`
> ```ts
> ? Math.max(0, Math.floor(options.legacyWindowStart))
> : legacyWindowStartIndex((messages ?? []).length, hasImages);
> return (messages ?? []).slice(start);
> ```

An oversized/stale metadata B is accepted and can assemble an empty history.
The digest splitter upper-clamps separately; assembly does not.

**REFUTED — “18/18 is enough to ship.”** The test file imports only pure
helpers (`windowKvInvariant.test.ts:1-8`). It does not exercise AppShell,
LlamaService module state, async invalidation/restore, digest injection,
failure cleanup, or native prompt assembly. The green result proves the
truth table, not either APPLY item end-to-end.

## Required before SHIP

- Add an identity/generation snapshot and re-check immediately before final
  assembly and stream enqueue; invalidate B/nPast/hold on clear and failure.
- Make digest sizing follow the actual injection policy, not the unrelated
  stale `kvHeld` flag.
- Bound B to current history and add integration tests for same-chat B,
  stale nPast, abort/clear during the async gap, switch/restore, digest
  injection, and failed turns.

**Verdict: FIX.**
