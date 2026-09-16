# CISWIRE window audit — 2026-09-13

Verdict: **FIX**

Scope: read-only review of the current on-disk patch, S23 evidence, AppShell
wiring, session state, and native diagnostics.

## Release gate

**CONFIRMED — the named commit is not the reviewed fix.** HEAD
96d3d06 contains the stall-watchdog change only. The window/AppShell changes
are uncommitted. Jest windowKvInvariant.test.ts: 18/18 passed; TypeScript
and whitespace checks passed. No post-patch device run proves the invariant.

## Findings

**PLAUSIBLE — the writer’s historical cause is not proven.** S23 proves a
cache/prompt mismatch:

> KALSA_DIGEST {"durationMs":0,"corpusSize":0,"selectedCount":0,"ciswireFlags":3}

> KALSA_KVPREFIX embd=7840 text_tokens=4219 n_common=0

That does not prove a JS window slide, nor does it report loadedB,
computedStart, kvHeld, conversation ID, or the assembled message range.
The zero digest corpus also weakens the specific “digest slid the window”
story. The old code did allow the suspected fallback:

> HEAD windowKvInvariant.ts:75-77 — if (args.kvHeld && args.loadedB !== null)
> return args.loadedB; return args.computedStart;

So the mechanism is credible, but the artifact cannot attribute causality.

**REFUTED — ciswireFlags=3 does not bypass the clamp.** The flag is
telemetry only:

> AppShell.tsx:5273 — Telemetry bitmask only — no gating behavior here

For ciswire, retrievalOn=true and anchoredOn=false at 5281-5284. The
clamp runs under if (!anchoredOn) at 5345-5353, before the later
if (retrievalOn || anchoredOn) compactor arm at 5369. The final non-anchored
assembly also passes legacyWindowStart at 5616-5623. Current wiring therefore
does use the clamp for ciswire; the flag itself is not the selector.

**REFUTED / CONFIRMED — the “0.6 computed then overwritten” wording is
wrong, but the budget contract is broken.** Current live KV uses:

> AppShell.tsx:5316 — hasDigest: retrievalOn && !kvHeld

Thus the production live ciswire path (absent a bench override) selects the
bare 0.75 profile; it does not compute the 0.6 profile and then overwrite it.
The computed start is subsequently
replaced by loadedB ?? 0 at windowKvInvariant.ts:92-94.

The worse problem is that retrieval still runs and can inject the block:

> AppShell.tsx:5561-5568 — Query-time BM25 digest

> AppShell.tsx:5599-5607 — operativeContext = { digest, summary }

But windowProfile.ts:122-129 defines hasDigest as retrieval being on and
reserves the 0.6 share for it. Live KV can therefore receive digest content
while being sized as “bare”; with a nonzero loadedB, the budget is not merely
dead, it is under-enforced. FIX.

**CONFIRMED — 0, null, and missing state are conflated.** Alignment returns
null for no hold or conversation mismatch:

> windowKvInvariant.ts:66-75 — mismatch / no hold → null; boundary ?? 0

Persistence maps missing or invalid metadata to zero:

> sessionPersistence.ts:473-486 — Old files omit assembleBoundary → 0

The new helper then maps null to zero for live off/ciswire:

> windowKvInvariant.ts:78-94 — return args.loadedB ?? 0

A legitimate full-transcript boundary (0) is indistinguishable from an
unknown/foreign boundary. This prevents stamping the foreign window, but it
still sends the active chat against whatever native KV is resident and
disables the window budget. Treat unknown/mismatch as a state requiring clear
or rejection, not as a valid full-history alignment.

**PLAUSIBLE — the mismatch path is reachable in a switch/delete race.**
Conversation UI state changes before bind and restore:

> AppShell.tsx:2297-2321 — apply active conversation, then bind/restore

Deletion likewise fires invalidation and restore asynchronously:

> AppShell.tsx:2391-2408 — invalidateConversationSessions; restoreEngineSession

A send in that interval can see B in JS, A’s native KV, loadedB=null, and
start at zero. There is no integration test or input barrier proving that
native A is cleared before B is sent.

**CONFIRMED — the new nPast fallback can preserve stale ownership.**

> windowKvInvariant.ts:56-63 — positive nPast counts as live

The producer’s contract says nPast is undefined when KV is not held:

> LlamaService.ts:1172-1174 — undefined when chat KV is not held

But active conversation invalidation only flips the boolean:

> LlamaService.ts:2855-2859 — kvHoldsChatSession = false; delete files

It does not clear lastChatNPast, the boundary, or native KV. The new OR
therefore keeps the live path active during stale state. This compounds the
null-to-zero behavior and can suppress the only available slide/clear action.

**CONFIRMED — the “computed once” claim is not synchronization.** kvHeld
is sampled before an await:

> AppShell.tsx:5298-5302 — compute kvHeld; await getBenchLegacyWindow()

loadedB is read later:

> AppShell.tsx:5345-5353 — getLoadedAssembleBoundary(chatId)

The latter independently recomputes KV ownership at LlamaService.ts:1177-1185.
A restore, clear, switch, or failed completion between those reads can produce
kvHeld=false with a live loadedB, or the reverse. The helper tests cannot
catch that and the S23 failure can recur.

**CONFIRMED — boundary range validation is missing.** Session metadata accepts
any finite nonnegative integer:

> sessionPersistence.ts:479-484 — n >= 0 returns n

Legacy assembly only clamps the lower bound:

> compactor.ts:794-802 — Math.max(0, Math.floor(start)); then .slice(start)

Corpus splitting clamps the upper bound:

> compactor.ts:733-739 — boundary is clamped to messages.length

An oversized persisted loadedB therefore assembles an empty engine history
while the digest corpus treats the entire history as older. Clamp/reject
against the current history length before using or persisting it. No test
covers this.

**CONFIRMED — failed turns can publish an unearned boundary.** The stream
records the boundary and conversation before entering the FIFO:

> LlamaService.ts:3066-3076 — set lastAssembleBoundary/ConvId, then queue job

Its finally block marks KV held even after the error path:

> LlamaService.ts:4215-4224 — kvHoldsChatSession = true

A prefill/context error can consequently make the next turn trust a boundary
for a prompt that was never successfully resident. Recovery is only armed for
anchored context_full:

> AppShell.tsx:5737-5747 — force rebuild only when contextMode === "anchored"

**PLAUSIBLE — ciswire can become a permanent context-full loop.** The new
policy suppresses both slide and discard while KV is live, while the ciswire
error path does not clear or force a rebuild. If full-history alignment exceeds
the actual context, each retry can reuse the same overlarge resident state.
This is not demonstrated by S23, but there is no recovery branch.

**CONFIRMED — 18/18 is insufficient evidence.** The test file imports only the
six pure helpers:

> windowKvInvariant.test.ts:1-8 — direct helper imports

It does not render AppShell, exercise chatKvIsHeld/chatKvNPast, restore or
switch conversations, run assembleEngineHistory, inject the digest, bound
metadata, or call native loadPrompt. The green result validates the policy
table, not production behavior.

**CONFIRMED — native diagnostics leak prompt-derived data at warning level.**
The patch logs a native pointer and sizes on every prompt comparison:

> rn-completion.cpp:500-503 — ... n_common=... this=%p

On divergence it logs raw token IDs from both prompt/cache sides:

> rn-completion.cpp:549-554 — shared_ids, embd_ids, text_ids

Zero-prefix diagnostics log both 12-token heads:

> rn-completion.cpp:577-578 — cache_head, prompt_head

The patch explicitly leaves token IDs in both builds at 529-530. Only
detokenized text is behind the Debug macro at 532-548; WARNING maps to Android
WARN in rn-llama.cpp:201-210. Token IDs are prompt fingerprints and can be
mapped back with the model vocabulary; the pointer also leaks address
information. This is not release-safe telemetry. Remove IDs/pointers or gate
behind an explicit non-production diagnostic build with sampling/redaction.
The checkpoint-size string at patches/llama.rn+0.12.8.patch:1729-1736 is also
unbounded log amplification.

## Required before SHIP

- Distinguish known boundary 0 from unknown/mismatched; clear or reject foreign
  native KV, and clamp every boundary to current history.
- Snapshot KV ownership, conversation, and boundary atomically with assembly;
  add an AppShell-to-native integration test reproducing S23.
- Size the prompt for the actual injected digest or enforce a hard context
  guard and a ciswire recovery path.
- Remove release warning logs containing token IDs and native pointers.

Do not ship/apply this patch as-is.
