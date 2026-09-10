# STOP-PARTIAL-PRESERVATION — 2026-09-10

**Repo (app)**: shared checkout `/Users/marco/Projects/kalsa`
**Base**: exact `origin/main` = `1edf5c662715a357c7aa74d16b9b2ab787688f6e` (HEAD verified equal before and after; app tree left unchanged)
**Scope**: first unresolved M1 acceptance criterion — preserve partial assistant text safely when the user interrupts an in-progress generation
**Live docs read**: `kalsa-moe-experiments/PLAN.md`, `kalsa-moe-experiments/docs/ALIVE.md`, plus the current Jelly evidence `JELLY-SESSION-MEMORY-095466e-2026-09-10.md`
**Determination**: **no code defect proven** — the Jelly result is a **timing case with zero emitted visible text** (abort before any cleaned answer token), and the after-text strand is **missing device evidence**. The app tree was **not modified**; a one-shot evidence procedure is given in §6.

---

## 1. Criterion under test

PLAN §3 (`ripresa`, `stop, modifica e rigenerazione`) and §7.9/§8, and ALIVE (095466e row / §9 bullet
"Stop abort is reachable but partial preservation is not demonstrated"):

> when the user interrupts an in-progress generation, partial assistant text should be preserved safely
> (non-empty partial text kept with an explicit interrupted state; no fabricated empty assistant message).

The Jelly run at `095466e` observed: Stop button reachable, tap accepted, native generation aborted,
but **no assistant message persisted** (report §8, "partial kept NOT DEMONSTRATED").

## 2. Code trace (current `origin/main`, file:line)

### 2.1 UI interrupt action

- Stop button → `handleStop` (`src/screens/AiChatPage.tsx:2907`). It calls
  `abortRef.current?.abort()` at `:2909` and arms a 3 s watchdog at `:2930-2969`.
  It does **not** itself finalize/persist the assistant message; finalization is the job of the
  `finally` block once the native stream settles.

### 2.2 Streaming accumulator

- `let anyTextStreamed = false` — `src/screens/AiChatPage.tsx:2394-2395`.
- `onDelta` sets it and pushes to the coalescer — `src/screens/AiChatPage.tsx:2421-2424`,
  `streamCoalescer.push(full)` at `:2428`; the coalescer flushes on a ~33 ms cadence
  (`src/engine/streamCoalescer.ts`, leading edge on first push, `finalize()` flushes synchronously).
- The stream that reaches `onDelta` is **cleaned**: `src/engine/LlamaService.ts:3523-3526` calls
  `callbacks.onDelta(delta, streamedText)` **only when `delta` is non-empty**; `delta` is
  `cleanStreamDelta(raw)` = think-tag stripper + tool-call stripper (`:3242`).
- The think stripper holds/suppresses everything inside a reasoning block
  (`src/engine/thinkStream.ts`: `cleanDelta` returns `""` while `insideThink` and no `</think>` yet).
  With `reasoning_format: "none"` (`src/engine/thinkingBudgets.ts`, default mode), reasoning arrives
  as inline `<think>…</think>` and is therefore invisible to `onDelta` until the block closes.

**Consequence**: while the model is in prefill or inside the hidden `<think>` block, `onDelta` is never
called and `anyTextStreamed` stays `false`.

### 2.3 LlamaService abort result

- `let aborted = false` — `src/engine/LlamaService.ts:2870`.
- `abort()` sets `aborted = true`, stops the watchdog, and via `finishOnce` calls
  `onModelEmittedText(rawEmittedAccum)` then `onDone()` — `:2903-2925`.
- The caller signal is wired at `:2999-3003` (`signal.addEventListener("abort", onAbort)`; `abort()`
  has no error argument → `onDone`, not `onError`).
- **Key**: abort emits the raw accumulated text only through `onModelEmittedText` (`:2921-2923`); it
  does **not** synthesize a final visible `onDelta`. Visible text only ever came from `:3526`.

### 2.4 AppShell state/persistence

- `onDone` → telemetry, `armMemoryExtract()`, `finish()` — `src/app/AppShell.tsx:5549-5590`.
  `assistantFull` is assigned in the turn's `onDelta` wrapper at `:5530` (and `:5107` for research).
- `armMemoryExtract` early-exits when `signal.aborted || turnFailed || !assistantFull.trim()`
  (`src/app/AppShell.tsx:4878`) — this is the `extractStopReason:4` line seen on Jelly. Note this is an
  **OR**: it fires because the signal is aborted even if `assistantFull` were non-empty, so the line
  alone is *not* proof of empty text.

### 2.5 Finalize / persistence / session save gate

`finally` in the send IIFE (`src/screens/AiChatPage.tsx:2625`):

```
2628  if (controller.signal.aborted && !anyTextStreamed) {
2629    streamCoalescer.cancel();
2631  } else { streamCoalescer.finalize(); }
2637  } else if (controller.signal.aborted && !anyTextStreamed) {
        // remove the empty placeholder (no phantom bubble)
2644  } else if (!controller.signal.aborted || anyTextStreamed) {
2652    const wasInterrupted = controller.signal.aborted && anyTextStreamed;
2682    interrupted: wasInterrupted ? true : undefined,
2752    persistActiveMessages(finalized, { epoch, getEpoch });
2774    await saveEngineSession(mid, historyHash(payload), persistable.length);
```

So the decision table is:

| condition | outcome |
|---|---|
| aborted **and** no visible text | placeholder removed, **no** assistant message (`:2637-2643`) |
| aborted **and** visible text | message kept, `streaming:false`, `interrupted:true`, persisted, engine session saved (`:2644-2800`) |
| not aborted | normal finalize, `interrupted` cleared |

The 3 s watchdog (`:2930-2969`) is the fallback for a native stream that never settles: it bumps
`sendRunIdRef`, keeps streaming messages whose `text.trim()` is non-empty, sets `interrupted:true`, and
persists (dropping only empty placeholders). Both the primary and the fallback path keep non-empty
partial text.

Supporting surfaces: `interrupted` survives the persistence sanitizer (`src/engine/sessionPersistence.ts:245-269`)
and is restored only for non-empty text (`src/screens/AiChatPage.tsx:675-676`); the UI renders the
"Generazione interrotta." marker (`src/screens/AiChatPage.tsx:5345`, i18n `chat.interrupted`).

## 3. Deterministic deduction from the Jelly observation

1. A persisted assistant message in the stop case exists **iff** `anyTextStreamed === true`
   (only branch `:2644-2682` writes one; `:2637-2643` removes the placeholder).
2. `anyTextStreamed` becomes true **iff** `onDelta` was called at least once
   (`:2421-2424`).
3. `onDelta` is called **iff** the cleaned stream delta is non-empty
   (`src/engine/LlamaService.ts:3523-3526`), i.e. after some visible (non-`<think>`) text.
4. Jelly produced **no** assistant record (report §8) ⇒ `anyTextStreamed === false` ⇒ **no visible
   answer text had been emitted** when Stop was tapped.

Timing corroboration (Jelly evidence `13-stop-*`): the stop tap and the turn-end `KALSA_MEMORY` line
are the same ~0.8 s window, ~10 s after the send (`KALSA_SEND` 12:20:36.985 → stop/`onDone`
12:20:46.797). At Jelly decode (~3.4 tok/s) and thinking budget 512 (Jelly → short budget per the
10/09 owner decision), that window is consistent with abort during prefill/first reasoning block, i.e.
before `</think>`.

**Therefore the Jelly outcome is a timing case with zero emitted visible text, not a deterministic code
defect.** The "removed placeholder" behaviour is deliberate (`:2638`, "niente bubble fantasma") and is
exactly the requested "does not fabricate an empty assistant message".

What is genuinely unresolved is the *other* strand: a device run that aborts **after** visible text has
appeared, to demonstrate branch `:2644-2682` end-to-end. That is missing evidence, not a code gap.

## 4. Why the closest alternative is not a defect

- Not "missing code": `interrupted` state, persistence, sanitizer round-trip, and UI marker all exist
  and are wired.
- Not "lost text": on the abort-with-text path the coalescer is finalized (not cancelled) at `:2631`,
  so the last token is flushed; the message is then finalized and persisted at `:2752`.
- Not "thinking dropped incorrectly": dropping aborted reasoning is intended; reasoning is deliberately
  invisible (`thinkStream.ts`), and persisting it as assistant text would violate the criterion.
- The only honest caveat is at §2.4: `extractStopReason:4` cannot by itself distinguish "empty text"
  from "aborted with text", so the deduction rests on the absent assistant record plus the code
  invariant above — which is sufficient.

## 5. Verification run this turn (tree unchanged)

The app tree was **not modified**, so the following only re-confirms the existing guards:

| Check | Result |
|---|---|
| `npx jest src/engine/sessionPersistence.test.ts src/engine/modelEmittedText.test.ts` | **25 passed, 0 failed** (2 suites) |
| `node scripts/streamCoalescerHarness.mjs` | **7 passed, 0 failed** (finalize flushes pending; cancel drops pending) |
| `node scripts/sessionSaveGateHarness.mjs` | **25 passed, 0 failed** |
| `npx tsc --noEmit` | exit 0 |
| `HEAD` / `origin/main` | both `1edf5c662715a357c7aa74d16b9b2ab787688f6e` |
| `git status` tracked paths | **empty** (no tracked modification; only pre-existing untracked `archived/…`, `out/`, etc.) |

No build, no device action, no CI dispatch.

## 6. Exact one-shot evidence procedure (the missing proof)

Goal: produce a single Jelly run that aborts **after visible answer text**, then prove on disk that a
non-empty assistant message with `interrupted: true` was persisted.

Preconditions
- Jelly only; app already installed at `095466e` or later (no uninstall, no clear-data).
- `kalsa://share` composer injection (the harness hole is that `adb input text` does not drive the
  React `TextInput`; share intent is the working path — see the prior report).
- Use the shipped LFM (`lfm2.5-2.6b`) and `it`.

Steps (one shot, ordered)
1. Clear logcat marker window: `adb logcat -c`.
2. Inject a prompt that guarantees a long **visible** answer, e.g.
   `kalsa://share?text=Scrivi un testo di almeno 250 parole sul mare, in italiano.`
3. **Poll the UI dump for visible assistant text**, not merely the Stop button. Wait until the assistant
   bubble contains at least ~80 visible characters (uiautomator dump; read the assistant TextView text
   length). Do **not** tap during the `<think>` window.
4. The instant visible text is confirmed, tap `Interrompi generazione`.
5. Immediately capture:
   - `KALSA_MEMORY` / `KALSA_MEMORY_EXTRACT` turn-end line for this turn;
   - the next `KALSA_SESSION {"op":"save",…,"messageCount":N}` line.
6. Dump the persisted conversation (`kalsa.session.messages…` / the active chat's messages key) and
   assert:
   - the last assistant record has **non-empty** `text`,
   - `interrupted === true`,
   - `streaming` absent/false,
   - its `messageCount` is **one greater** than before the turn (assistant record present).
7. Dump the conversation UI and assert the "Generazione interrotta." marker is rendered under the
   partial bubble.
8. Optional cache invariant: on the same conversation, send a follow-up and confirm the turn starts
   normally (no crash, no phantom) and that the next save advances `messageCount`.

Pass/fail
- **PASS** iff step 6 finds a non-empty assistant record with `interrupted: true` and the marker is
  visible; this proves branch `:2644-2682`.
- **FAIL** iff visible text was ≥80 chars at step 3 and no such record exists — that would be the actual
  code defect and would justify the smallest fix (e.g. a finalize-time guard that uses the streamed text
  snapshot rather than the React state text).

Anti-flake
- If step 3 times out because the reasoning block is long, the run is **VOID** (zero visible text), not a
  defect; repeat with a prompt whose reasoning is short or with the extended budget to push visible text
  earlier. Record the visible-character count at tap time in the report.

## 7. Files changed this turn

**App tree (`/Users/marco/Projects/kalsa`): none.** `git status` shows no tracked modification; HEAD and
`origin/main` are unchanged at `1edf5c662715a357c7aa74d16b9b2ab787688f6e`.
**Experiments**: only this report
(`scratchpad/agents/product-suite/STOP-PARTIAL-PRESERVATION-2026-09-10.md`). `PLAN.md` and
`docs/ALIVE.md` were not touched; nothing was committed or pushed.

## 8. Verdict

- Jelly `095466e` is explained deterministically as **zero emitted visible text at abort** (hidden
  `<think>`/prefill), given the current code invariant.
- Partial preservation **is already implemented** for the after-text case; it is **not demonstrated on
  device** — this is the missing evidence.
- No app code change is justified. Apply §6 to close the criterion on the next available Jelly window.
