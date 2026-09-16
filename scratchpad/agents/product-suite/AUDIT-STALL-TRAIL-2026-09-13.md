# HOSTILE AUDIT — trailing stall watchdog

**Coding Reviewer**: gpt-5.6-luna  
**Writer**: grok-4.6  
**Date**: 2026-09-13  
**Scope**: watchdog + generation integration only; LlamaService wipe/prewarm excluded.  
**Verification**: targeted Jest 6/6 EXIT 0; typecheck EXIT 0; `git diff --check` clean.  
**Verdict**: **FIX**

## Findings

### CONFIRMED — no-first-token protection is conditional, not guaranteed

> `src/engine/stallWatchdog.ts:57-60`
> ```ts
> if (tokenAt.length === 0) {
>   return { stalled: false, reason: "gap", gapMs: 0, tokPerSec: 0 };
> }
> ```

> `src/engine/LlamaService.ts:3183-3191`
> ```ts
> const prefillTokPerSec = activeModel ? getPrefillTokPerSec(activeModel.id) : null;
> ...
> if (deadlineMs === null) return;
> ```

`prefillDeadlineMs` returns `null` when no usable EMA exists (`src/engine/prefillDeadline.ts:18-23`). Therefore a fresh process/model with no accepted sample can hang before token 1 indefinitely from this watchdog’s perspective. The helper test at `stallWatchdog.test.ts:10-23` proves only that it does nothing. The “true hang still aborts” comment (`stallWatchdog.ts:14-15`) overclaims. Blocking unless the guarantee is explicitly conditional.

### CONFIRMED — “recovery can never rate-stall” is false before the window shifts

> `src/engine/LlamaService.ts:3165-3168`
> ```ts
> if (stallTimer === null) {
>   stallTimer = setInterval(checkStall, 2_000);
> }
> ```

With timestamps `[0, 40000, 40100, 40200, 40300, 40400, 40500, 40600]`, the 42,000-ms poll sees `gapMs=1400` and `7/40600*1000=0.172 tok/s`, so it aborts before a ninth, recovering token at 42,100 ms can evict the slow start. The shift is correct for a genuinely fast recovery already delivering tokens, but it is not hysteresis. This is a **PLAUSIBLE** false-positive product risk for bursty warm-up/recovery.

### CONFIRMED — rate stalls show a false duration and no reason to the user

> `src/engine/LlamaService.ts:3158-3162`
> ```ts
> const seconds = Math.max(1, Math.round(result.gapMs / 1000));
> ...
> strings.errors.generationStalled.replace("{seconds}", String(seconds))
> ```

The accepted rate case has `gapMs=1000` (`stallWatchdog.test.ts:116-121`) while the localized copy says “no new words for {seconds} s” (`src/i18n/en.ts:656-659`). A low-rate abort therefore tells the user “1 s” even though the decision came from the trailing window; `reason: "rate"` is only logged. Also `AppShell.tsx:5738-5740` reports every such failure as `chat.serviceUnreachable`.

### PLAUSIBLE — wall-clock jumps can falsify rate/gap decisions

> `src/engine/LlamaService.ts:3090-3093`
> ```ts
> const stallWatchdog = createStallWatchdog({
>   gapMs: GENERATION_STALL_GAP_MS,
>   now: Date.now,
> });
> ```

`stallWatchdog.ts:39-41,62` treats a non-positive span as zero and clamps a negative gap to zero. A forward clock adjustment can fake a 45-s gap; rollback can suppress detection or make the rate zero later. Use a monotonic source or test clock jumps.

### CONFIRMED — green tests do not cover the production watchdog

The six tests exercise the pure helper only. No test drives `setInterval`, the prefill timer, `checkStall → abort → stopCompletion`, a recovery-before-window-shift race, or the fallback callback site (`LlamaService.ts:4121-4126`). Jest 6/6 is not integration evidence.

### REFUTED — `(n-1)/span` is not an arithmetic off-by-one

> `src/engine/stallWatchdog.ts:37-41`
> ```ts
> const spanMs = tokenAt[tokenAt.length - 1]! - tokenAt[0]!;
> return ((tokenAt.length - 1) / spanMs) * 1000;
> ```

For `n` timestamped arrivals, there are `n-1` inter-arrival intervals. The test correctly pins eight tokens at 3 s to `7/21 = 1/3` (`stallWatchdog.test.ts:76-80`). Only a different contract—eight intervals rather than eight timestamps—would require retaining nine timestamps; that contract is not stated.

### REFUTED — stale 10-s wiring in LlamaService

> `src/engine/stallWatchdog.ts:17`
> ```ts
> export const GENERATION_STALL_GAP_MS = 45_000;
> ```

> `src/engine/LlamaService.ts:3090-3093`
> ```ts
> gapMs: GENERATION_STALL_GAP_MS,
> now: Date.now,
> ```

The remaining use of the constant is correct; it resolves to 45,000 ms. No old `RATE_GRACE_MS` import or 10,000-ms gap remains in the live watchdog path.

## Verdict

**FIX**. Do not ship as an unconditional hang detector. At minimum, define a no-EMA first-token policy and make rate failures truthful; then add timer/integration tests. The arithmetic and 45-s wiring are sound.
