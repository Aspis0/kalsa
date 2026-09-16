import {
  FOREGROUND_DECODE_SILENCE_MS,
  FOREGROUND_IDLE_DISPOSE_MS,
  shouldRunForegroundIdleDispose,
} from "./foregroundIdleDispose";
import { GENERATION_STALL_GAP_MS } from "../engine/stallWatchdog";
import { createThinkStreamCleaner } from "../engine/thinkStream";

describe("shouldRunForegroundIdleDispose", () => {
  test("quiet idle at 180s disposes; in-flight at 180s does not", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(true);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(false);
  });

  test("60 s inside <think>: cleaned stream silent, raw pulse fresh, never disposed", () => {
    // c45fd1f defect A: the net watched the cleaned delta, which strips
    // <think> content, so a healthy reasoning round went stale past 45 s and
    // was killed. Reproduce the exact condition through the real cleaner,
    // then require the decision to keep the turn alive on a fresh RAW pulse.
    const cleaner = createThinkStreamCleaner();
    const cleaned: string[] = [];
    let rawTokenAt = 0;
    const feedThinkToken = (raw: string, atMs: number) => {
      rawTokenAt = atMs;
      cleaned.push(cleaner.cleanDelta(raw));
    };
    feedThinkToken("<think>", 1_000);
    for (let s = 2; s <= 60; s += 1) {
      feedThinkToken(` step ${s}`, s * 1_000);
    }
    // The defect condition holds: a full minute of reasoning produced an
    // empty cleaned stream, while raw tokens kept arriving.
    expect(cleaned.join("")).toBe("");
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: 6 * 60 * 60 * 1000,
        tokenSilenceMs: 61_000 - rawTokenAt,
      }),
    ).toBe(false);
  });

  test("backstop is strictly looser than the engine gap: 60 s silence is the engine's call", () => {
    const sixHours = 6 * 60 * 60 * 1000;
    expect(FOREGROUND_DECODE_SILENCE_MS).toBe(3 * GENERATION_STALL_GAP_MS);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: sixHours,
        tokenSilenceMs: GENERATION_STALL_GAP_MS + 15_000,
      }),
    ).toBe(false);
  });

  test("cold 1046 s prefill is not disposed before its first token", () => {
    // c45fd1f defect B: the pre-token branch killed at 900 s of USER idle
    // while the reference device prefills 5441 tokens at ~5.2 tok/s
    // (~1046 s). The engine's prompt-scaled deadline owns this window; the
    // app imposes no bound before the first token.
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: 1_200_000,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(false);
  });

  test("a genuinely silent decode past 3 engine gaps is still disposed", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
        tokenSilenceMs: FOREGROUND_DECODE_SILENCE_MS,
      }),
    ).toBe(true);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
        tokenSilenceMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });

  test("quiet idle still disposes at any large age", () => {
    const sixHours = 6 * 60 * 60 * 1000;
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: sixHours,
      }),
    ).toBe(true);
  });

  test("does not dispose when the engine is not ready", () => {
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: false,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS,
      }),
    ).toBe(false);
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: false,
        idleMs: FOREGROUND_IDLE_DISPOSE_MS - 1,
      }),
    ).toBe(false);
  });
});
