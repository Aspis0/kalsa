import fs from "fs";
import path from "path";
import {
  deriveTokenSilenceMs,
  FOREGROUND_DECODE_SILENCE_MS,
  FOREGROUND_IDLE_DISPOSE_MS,
  shouldRunForegroundIdleDispose,
} from "./foregroundIdleDispose";
import { GENERATION_STALL_GAP_MS } from "../engine/stallWatchdog";
import { createThinkStreamCleaner } from "../engine/thinkStream";

const disposeSource = fs.readFileSync(path.join(__dirname, "foregroundIdleDispose.ts"), "utf8");
const gateSource = fs.readFileSync(
  path.join(__dirname, "../../scripts/campaign/metroGate.mjs"),
  "utf8",
);
const gateNeedle = gateSource.match(
  /POST_FIX_IN_FLIGHT_NEEDLE\s*=\s*"([^"]+)"/,
)?.[1];

describe("shouldRunForegroundIdleDispose", () => {
  test("gate needle stays present in the predicate source", () => {
    if (!gateNeedle) throw new Error("metro gate needle is missing");
    expect(disposeSource).toContain(gateNeedle);
  });

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

describe("deriveTokenSilenceMs — the AppShell wiring", () => {
  const TURN_START = 1_000_000;

  test("a token from the PREVIOUS turn is not this turn's liveness", () => {
    // The pulse is one monotonic clock shared by every turn. A turn that has
    // not decoded yet must read as undefined even when the clock is recent,
    // otherwise the tail of the previous turn keeps the next one alive.
    expect(
      deriveTokenSilenceMs({
        streamInFlight: true,
        turnStartedAt: TURN_START,
        lastRawTokenAt: TURN_START - 1,
        now: TURN_START + 5_000,
      }),
    ).toBeUndefined();
  });

  test("a token exactly at turn start is still the previous turn's", () => {
    expect(
      deriveTokenSilenceMs({
        streamInFlight: true,
        turnStartedAt: TURN_START,
        lastRawTokenAt: TURN_START,
        now: TURN_START + 5_000,
      }),
    ).toBeUndefined();
  });

  test("once this turn decodes, silence is measured from its own token", () => {
    expect(
      deriveTokenSilenceMs({
        streamInFlight: true,
        turnStartedAt: TURN_START,
        lastRawTokenAt: TURN_START + 2_000,
        now: TURN_START + 9_000,
      }),
    ).toBe(7_000);
  });

  test("no stream, or no turn, is undefined rather than zero", () => {
    expect(
      deriveTokenSilenceMs({
        streamInFlight: false,
        turnStartedAt: TURN_START,
        lastRawTokenAt: TURN_START + 2_000,
        now: TURN_START + 9_000,
      }),
    ).toBeUndefined();
    expect(
      deriveTokenSilenceMs({
        streamInFlight: true,
        turnStartedAt: 0,
        lastRawTokenAt: TURN_START + 2_000,
        now: TURN_START + 9_000,
      }),
    ).toBeUndefined();
  });

  test("undefined reaches the predicate as pre-first-token, never disposed", () => {
    // The wiring contract: whatever the clock says, a turn that has not
    // decoded is never app-disposed, at any age.
    const silence = deriveTokenSilenceMs({
      streamInFlight: true,
      turnStartedAt: TURN_START,
      lastRawTokenAt: TURN_START - 1,
      now: TURN_START + 86_400_000,
    });
    expect(
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: 86_400_000,
        tokenSilenceMs: silence,
      }),
    ).toBe(false);
  });

  test("a decoding turn silent past the backstop is disposed, and not before", () => {
    const at = (silenceMs: number) =>
      shouldRunForegroundIdleDispose({
        engineReady: true,
        inFlight: true,
        idleMs: 0,
        tokenSilenceMs: deriveTokenSilenceMs({
          streamInFlight: true,
          turnStartedAt: TURN_START,
          lastRawTokenAt: TURN_START + 1,
          now: TURN_START + 1 + silenceMs,
        }),
      });
    expect(at(FOREGROUND_DECODE_SILENCE_MS - 1)).toBe(false);
    expect(at(FOREGROUND_DECODE_SILENCE_MS)).toBe(true);
    // Strictly looser than the engine's own abort, which owns one gap window.
    expect(at(GENERATION_STALL_GAP_MS)).toBe(false);
  });
});
