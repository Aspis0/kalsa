# KALSA TTFT FIXES v2 — the verify said FAIL; here is exactly why, fix that

Predecessor: `mandates/kalsa-ttft-fixes.md` produced branch `fix/ttft-load-policy`
@ `56464da`. The on-device verification
(`C:\Users\gualt\Desktop\Kalsa\moe-experiments\reports\kalsa-ttft-verify-jelly.md`
— READ IT FIRST, END TO END) measured S1 cold TTFT **53.4 s AFTER**, identical to
the old cold path. Two implementation bugs + one scope hole. This mandate fixes
what the app can fix and stops pretending about what it cannot.

Work in `C:\Users\gualt\Desktop\Kalsa\ai-chat`, branch `fix/ttft-load-policy`
(continue it, do not restart). Small commits, English, each referencing the
verify finding.

## The measured anatomy of the 53 s (Jelly, Qwen3.5-2B hybrid)

- 6.6 s `initLlama` — because eager init NEVER fired (bug 1).
- ~47 s prefill of the ~1.3-1.4k-token system/tool prompt at 28 tok/s — because
  the hybrid `.kvs` restore is wiped natively (`loadPrompt:462`, `n_past=0`
  despite JS `ok:true tokens:1635`) — engine hole Q6.c, out of app scope.
- PROVEN WORKING: in-process prefix reuse — turn 2 reused 1407/1436 tokens,
  prefill 1.8 s. This is the lever v2 builds on.

## V2-1 (bug fix) — make the eager kick actually run

Verify finding: the boot kick is scheduled via `InteractionManager.runAfterInteractions`
inside an effect closed over volatile deps (`[locale, t, ...]`); boot re-renders
cancel the handle, `console.info("engine.eagerInit", …)` never appears in logcat.

Fix: the kick must survive re-renders — one-shot per process (ref/module guard),
not tied to volatile deps; keep it cancellable ONLY on real model switch. 
ACCEPTANCE: `engine.eagerInit` visible in logcat on a cold Release launch on
Jelly, `initLlama` completing before any user tap, RAM climbing without touching
the chat. No UI-thread jank regression.

## V2-2 (the strategic fix) — boot-time PREWARM of the static system prefix

Q6.c means cold KV restore is dead until the engine track lands. But the system/
tool prompt is STATIC per (model, settings) and in-process prefix reuse works.
So: after eager init completes, immediately run a background prefill of the
byte-exact system/tool prefix (the same bytes message 1 would render), stop
before any user content, leave the KV hot.

- Message 1 then pays: delta prefill (user line, tens of tokens) + decode. On
  Jelly that is ~2-4 s instead of 53. On S23-class, near-instant.
- If the user sends BEFORE the prewarm finishes: the send must JOIN the running
  prewarm (queue on the same engine, continue from current n_past), never
  restart it. TTFT becomes max(0, remaining prewarm) + delta — strictly better
  than today at every send time.
- The prefix must be byte-identical to what message 1 renders: same template
  path (format B — facts/digest ride the user message, never the system block).
  Add a debug assert: prewarmed prefix hash == message-1 rendered prefix hash;
  on mismatch log `KALSA_PREWARM {"match":false}` and fall through (correctness
  over speed).
- Cancel + redo on model switch or settings change that alters the prefix.
- Flag: `EAGER_PREFIX_PREWARM` (default ON).
- Battery honesty: this is ONE background prefill per process launch (~47 s CPU
  on the very slowest phone, seconds on flagships). Do not loop it, do not
  redo it on foreground.

## V2-3 (bug fix) — compaction default-ON must apply to upgraded installs

Verify finding: stored `"0"` from a previous install overrode the new default;
S3 ran with compaction OFF (16.7 s at the window edge).

Fix: the default flip must reach existing installs — honor OFF only if the user
explicitly chose it in settings (explicit-choice marker or versioned key; your
call, document it). ACCEPTANCE: upgraded install with no explicit user choice
ends up ON.

## V2-4 (honesty) — stop selling what does not work

- Keepalive (P0-1): on OEM-kill phones (Jelly force-stops in <5 min) an AppState
  flag cannot survive process death. Keep the flag for phones where the process
  lives, but document the limitation in `docs/TTFT_FIXES.md` and remove any
  claim that it fixes S2 on aggressive OEMs. A foreground service is a product
  decision for gualt, NOT this branch.
- `.kvs` restore (P1-2): keep saving (110 ms, harmless) so the engine fix pays
  off later, but log reuse honestly: after load, emit
  `KALSA_KVDIAG {"n_past":N,"tokens_on_disk":M}` so telemetry never again says
  ok:true while native reused 0.
- Q6.c (hybrid/SWA checkpoint in llama.rn `loadPrompt`) stays OUT OF SCOPE here
  — it is 88% of the cold-restore number and belongs to the engine track. Do
  not attempt it in the app repo.

## V2-5 (optional, only if trivial) — measure the prefix weight

Log the token count of each block of the static prefix (system, tool schemas,
template). Report only — if tool schemas are hundreds of tokens and tools are
OFF for the session, propose (do not implement) lazy schema injection.

## Verification (Jelly, same harness as the verify report)

Reuse `scripts/ttft_jelly_runner.py` + the method notes in the verify report
(IME off, logcat -c discipline, no HOME before S3). PLUGGED is acceptable —
the deliverable is relative A/B on the same power state.

| # | Scenario | Gate |
|---|---|---|
| 1a | Cold launch, wait 90 s, send | `engine.eagerInit` in logcat; TTFT ≤ 8 s |
| 1b | Cold launch, send immediately | TTFT < 53 s and = remaining prewarm + delta (report the number honestly) |
| 2 | 25-msg window edge, compaction ON via migration (no manual toggle) | no full re-prefill |
| 3 | Swipe-kill → relaunch → wait → send | same as 1a (prewarm covers it; `.kvs` still logs KVDIAG n_past=0 — expected until Q6.c) |

## Deliverables

- Commits on `fix/ttft-load-policy` + updated `docs/TTFT_FIXES.md` (including
  the v2 before/after table and the keepalive limitation).
- Final summary with measured numbers per scenario, honest about 1b. End DONE.
