# KALSA TTFT FIXES — kill the minutes before the first token (app repo implementation)

You are implementing the fixes from the read-only audit
`C:\Users\gualt\Desktop\Kalsa\moe-experiments\reports\kalsa-ttft-audit.md` — READ IT
FIRST, END TO END. Every finding there carries file:line; do not re-derive, verify.
Work in the app repo: `C:\Users\gualt\Desktop\Kalsa\ai-chat`. Create branch
`fix/ttft-load-policy`. Small commits, one fix per commit, English messages.

The symptom you are killing: user sends a message and waits tens of seconds to
minutes before the first token, on every phone. The audit proved it is load POLICY
+ KV-reuse divergences, not model speed.

## Ground rules

- The engine-side items of the audit (Q6.c: prefill progress callback from llama.rn,
  hybrid-restore verification, marshalling profile) are OUT OF SCOPE — another track
  owns them. You change ONLY the app.
- Every behavioral change gets a settings flag or constant so it can be reverted.
- Do not weaken privacy: tool queries scrubbing stays; persisting tool blocks (P1-3)
  stores structure + already-displayed results only.
- Do not break the anti-OOM guarantees: `docs/ANTI_OOM_AND_EDITREGEN.md` §3 documents
  WHY dispose-on-background existed. You are replacing the trigger (AppState) with a
  better one (real memory pressure), not deleting the safety. Update that doc in the
  same commit.
- After each P0 fix: run the app's existing test suite + a manual TTFT check
  (see Verification).

## P0 — policy fixes (highest impact, near-zero risk)

### P0-1. Stop disposing the engine on background; evict on memory pressure
- Today: `AppShell.tsx:2030-2140` disposes on AppState→background; foreground does
  fit-check only (`:2144-2190`). Every background→send cycle pays full init.
- Change: on background, KEEP the engine; still abort streams + save session
  (keep `AppShell.tsx:2085-2090`). Add eviction triggered by: (a) the existing
  MemAvailable monitor (`monitor.ts:23-90`) crossing a low threshold, (b) OS trim
  callbacks if available in RN, (c) the existing does_not_fit foreground check.
  Threshold conservative and device-scaled (reuse deviceTuning heuristics).
- Flag: `ENGINE_KEEPALIVE_ON_BACKGROUND` (default ON).

### P0-2. Eager init at app start + eager session restore
- Today: lazy on first send (`AppShell.tsx:3534`); restore runs inside the first-send
  critical path (`LlamaService.ts:842-853`).
- Change: at boot, if the selected model is downloaded and fits (existing fit-check),
  kick `ensureEngineForModel` + `tryLoadEngineSession` in the background, cancellable
  on model switch. Message 1 then starts at prefill (or warm) instead of init.
- Careful: serialize with the embedder init (embedder release wait exists,
  `EmbeddingService.ts:210`); do not regress cold boot time of the UI thread.
- Flag: `EAGER_ENGINE_INIT` (default ON).

### P0-3. Compaction ON by default
- Today: `COMPACTION_ENABLED_KEY` default OFF (`compactor.ts:114`); sliding 20-message
  window (`compactor.ts:128,421-432`) causes full re-prefill every ~20 messages (audit
  cause #2). The append-only boundary design exists precisely to avoid this
  (`docs/RESEARCH_CONTEXT_LOSS.md:104`).
- Change: flip the default; verify the boundary block still rides the last user
  message (format B, `LlamaService.ts:1440-1457`) so the prefix stays byte-stable.

## P1 — small code fixes (do after P0, in this order)

### P1-1. Memory facts: move to format-B tail + no clearCache in extractMemory
- Today: facts appended to the system prompt (`LlamaService.ts:258-268`) → any new
  fact invalidates ALL history; and `extractMemory` calls `engine.clearCache()`
  (`LlamaService.ts:2222-2226`) → next turn 100% cold when memory is ON.
- Change: ride the facts on the current user message like the digest (format B);
  extract on a strategy that does not nuke the chat KV (separate context via
  `llamaContextGate.ts:86-124` machinery, or checkpoint-restore around extraction).

### P1-2. Disk gate scaled to used tokens
- Today: save requires `nCtx × 64KiB × 1.5` free (`sessionPersistence.ts:107-112`) —
  1.5 GiB for 16k ctx → low-storage phones NEVER save → every relaunch cold.
- Change: size the requirement on actual tokens in KV (bytes/token × n_past × margin).

### P1-3. Persist tool blocks in history
- Today: `tool_calls` + `tool` messages live only in KV (`kvReproducibility.ts:38-53`)
  → next re-render diverges at the tool position (tail re-prefill) AND the session is
  marked non-reproducible (save skipped). Web-search sessions are the headline case.
- Change: persist the tool-call structure + results (already stored for sources
  display) into engine history so re-renders match KV; drop the non-reproducible mark
  for this class. Keep miniapp/think divergences marked as today (separate classes).

### P1-4. Boot-hash refresh on model switch
- Today: mid-session model switch uses a stale boot hash (`AppShell.tsx:2044,2566`;
  reset only in the background path `:2107`) → restore never matches.
- Change: recompute/reset the hash on switch.

### P1-5. Honest progress in the chat bubble
- Today: one label "Writing…" covers init + restore + prefill + decode
  (`AiChatPage.tsx:1873`; onStatus only fires after init, `LlamaService.ts:1701-1704`).
- Change: staged labels with elapsed seconds — "Loading model… (12s)" /
  "Reading conversation…" / "Writing" — driven by modelState + existing callbacks.
  No fake percentages: only show what is actually known.

## Verification (required before calling ANY fix done)

Scenario matrix, measured with a stopwatch-in-log (add a debug TTFT log line:
send-timestamp → first-token-timestamp, behind a debug flag):
1. Cold app launch → send (message 1). Before/after P0-2.
2. Background 5 min → send. Before/after P0-1.
3. 25-message conversation → send (window edge). Before/after P0-3.
4. Memory ON, turn after a fact extraction. Before/after P1-1.
5. Web-search turn, then next turn. Before/after P1-3.
6. Kill app (swipe), relaunch → send. Before/after P1-2/P1-4.
Run on at least one real phone (emulator acceptable for smoke, not for numbers).
Reference engine curves (for calibration of expectations):
`moe-experiments/reports/moe-ttft-f0-jelly.md` (C2 = re-prefill cost curve,
C3 = reuse win, C4 = broken-prefix anti-pattern) — if that report is not yet
written, proceed; it lands independently.

## Deliverables

- Branch `fix/ttft-load-policy` with the commits, each referencing the audit finding
  it fixes (e.g. "fixes audit D2/cause-1").
- `docs/TTFT_FIXES.md` in the app repo: what changed, flags, the before/after table
  from the verification matrix.
- Final summary with the measured before/after per scenario. Be honest: report the
  scenarios where the win is small too. End with DONE.
