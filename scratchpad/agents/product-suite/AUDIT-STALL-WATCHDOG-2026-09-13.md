# HOSTILE AUDIT — stall watchdog

**Coding Reviewer**: gpt-5.6-luna  
**Writer**: grok-4.6  
**Date**: 2026-09-13  
**Mode**: read-only review of the current working tree  
**Verdict**: **FIX**

Checks: targeted watchdog **5/5**, full Jest **74/74 suites, 723/723 tests**, typecheck exit **0**, `git diff --check` clean. Passing tests do not close the coverage defects below.

## Findings

### CONFIRMED — the rate rule aborts a live stream at token 8

> `src/engine/stallWatchdog.ts:62-66`
> ```ts
> tokenCount >= MIN_TOKENS_BEFORE_RATE &&
> tokPerSec < MIN_DECODE_TOK_PER_SEC
> ```

> `src/engine/stallWatchdog.test.ts:74-93`
> ```ts
> const stepMs = 3_000;
> ...
> expect(result.stalled).toBe(true);
> expect(result.gapMs).toBe(0);
> ```

The test's events are one token at t=0, then every 3 s; token 8 arrives at t=21 s. `8 / 21 = 0.381 tok/s`, so the test explicitly requires an abort while the current gap is zero and the 45 s gap has not been approached. Production starts a 2 s interval at `LlamaService.ts:3148-3151`, so the next tick kills the stream.

The implementation is not measuring a sustained or trailing rate. `stallWatchdog.ts:55-66` uses the cumulative average since `firstTokenAt`; a slow initial burst followed by fast recovery can still be killed.

### PLAUSIBLE — 0.5 tok/s is unsafe for an uncalibrated think phase

The repository's steady-path evidence is much faster — `src/engine/thinkingBudgets.ts:16-21` calls Jelly LFM about 3.4 tok/s and S23 about 10–11 tok/s — so 0.5 is not obviously too high for ordinary decode. It is not think-phase evidence, though. A global hard floor plus the confirmed 0.381 false-trip vector is not justified without per-model/thermal/think measurements or hysteresis.

### CONFIRMED — “no first token” is not actually protected on a cold path

> `src/engine/LlamaService.ts:3174`
> ```ts
> if (deadlineMs === null) return;
> ```

> `src/engine/prefillDeadline.ts:11,18-23`
> ```ts
> A missing EMA leaves the prefill unwatched until a sample exists.
> ...
> return null;
> ```

`prefillSpeed.ts:8` makes the EMA in-memory only. A fresh process/model with no accepted prefill sample has no prefill timer; `stallWatchdog.ts:51-54` deliberately returns “not stalled” forever before the first token. The “does not stall before the first token” test proves only that the watchdog does nothing, not that a hang is stopped.

The eager prewarm is even less covered: `LlamaService.ts:841-855` calls `engine.completion({ n_predict: 0, ... })` with no prefill deadline or watchdog. A stuck prewarm can block the FIFO until the unrelated foreground disposal path eventually intervenes.

### CONFIRMED — rate failures display a false gap duration

> `src/engine/LlamaService.ts:3141-3145`
> ```ts
> const seconds = Math.max(1, Math.round(result.gapMs / 1000));
> ... generationStalled.replace("{seconds}", String(seconds))
> ```

The rate test returns `gapMs: 0`; the user therefore sees “no new words for 1 s” even though tokens are arriving. The localized string at `src/i18n/en.ts:656-659` only describes a gap. `reason: "rate"` is logged but never reaches the user-facing error.

### CONFIRMED — stall telemetry lies after tool rounds

`LlamaService.ts:3079` initializes `stallTokenCount` once per turn. `LlamaService.ts:3695-3698` resets the watchdog at each round, while `LlamaService.ts:3761-3763` increments the turn-wide counter. The `KALSA_STALL` payload at `3130-3135` reports the turn total, not the token count used by the current rate window. A later-round rate abort can therefore claim 100+ tokens when the watchdog judged only its latest 8.

### CONFIRMED — the 45 s and `FOREGROUND_STUCK` paths are only helper-tested

The 45 s unit test calls `check()` synchronously at exact equality (`stallWatchdog.test.ts:42-48`); it does not exercise the real interval, timer drift, callback delivery, abort, or native `stopCompletion()` path. There is no `LlamaService` integration test for the prefill timer, round re-arm, fallback round, or rate error.

`foregroundIdleDispose.test.ts:25-32` tests only the pure predicate. The actual AppShell timer at `AppShell.tsx:3105-3127` wakes every 180 s, and the bump at `3129-3132` does not re-arm an already existing timer. Thus 15 minutes is a threshold checked on a coarse cadence, not a hard 15-minute cap; disposal can be delayed by nearly another 3 minutes. The in-flight wiring exists, but it is untested end-to-end.

### PLAUSIBLE — wall-clock time can falsify the watchdog

> `src/engine/LlamaService.ts:3073-3076`
> ```ts
> now: Date.now,
> ```

The watchdog measures a non-monotonic wall clock. A clock rollback is clamped to zero by `stallWatchdog.ts:56-58` and can defer detection; a forward adjustment can create a false gap/rate stall. Use a monotonic clock or test the clock-jump behavior.

## Claims checked

### REFUTED — leftover `RATE_GRACE_MS` imports

The current test import is `stallWatchdog.test.ts:1-6` and imports `MIN_TOKENS_BEFORE_RATE`; repository search finds only the prose mention at `stallWatchdog.ts:9`. There is no stale symbol import and typecheck passes. The prose mention is stale/confusing, not an import defect.

### REFUTED — `LlamaService` still passes the old 10 s gap

> `src/engine/stallWatchdog.ts:17`
> ```ts
> export const GENERATION_STALL_GAP_MS = 45_000;
> ```

> `src/engine/LlamaService.ts:3073-3075`
> ```ts
> const stallWatchdog = createStallWatchdog({
>   gapMs: GENERATION_STALL_GAP_MS,
>   now: Date.now,
> });
> ```

There is one current call site and it resolves to 45,000 ms. The old 10,000 ms value is not being passed.

## Verdict: FIX

The 45 s constant is wired correctly and the removed grace constant has no import residue. Ship is still blocked: the new rate policy deliberately kills a flowing 0.381 tok/s stream, cold no-first-token protection is conditional/absent, rate errors misreport the cause, and integration/hang coverage is mostly asserted by pure helpers. No device validation was performed.
