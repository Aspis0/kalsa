/**
 * Truncated-answer observability: the native completion result's `truncated`
 * flag must land in the turn record next to interrupted, ride the
 * KALSA_TELEMETRY line, and produce one distinct KALSA_ANSWER_TRUNCATED line
 * with the counters already on the record.
 */

import {
  formatTelemetryLine,
  formatTruncationLine,
  roundTelemetryFromResult,
  type RoundTelemetry,
} from "./turnTelemetry";

const baseRound: RoundTelemetry = {
  round: 2,
  tokensCached: 512,
  tokensEvaluated: 900,
  tokensPredicted: 120,
  draftTokens: 0,
  draftAccepted: 0,
  promptMs: 900,
  promptN: 300,
  predictedMs: 2400,
  predictedPerSecond: 50,
  contextFull: false,
  interrupted: false,
  truncated: false,
};

function payloadOf(line: string): Record<string, unknown> {
  return JSON.parse(line.slice(line.indexOf(" ") + 1)) as Record<string, unknown>;
}

describe("truncated prompt telemetry", () => {
  test("roundTelemetryFromResult defaults truncated to false", () => {
    expect(roundTelemetryFromResult({}, 0).truncated).toBe(false);
  });

  test("roundTelemetryFromResult reads truncated from the result", () => {
    expect(roundTelemetryFromResult({ truncated: true }, 0).truncated).toBe(
      true,
    );
  });

  test("KALSA_TELEMETRY carries the truncated flag", () => {
    const line = formatTelemetryLine("t1", { ...baseRound, truncated: true });
    expect(line.startsWith("KALSA_TELEMETRY ")).toBe(true);
    expect(payloadOf(line)).toHaveProperty("truncated", true);
  });

  test("formatTruncationLine emits the distinct marker with in-hand counters", () => {
    const line = formatTruncationLine("turn-7", {
      ...baseRound,
      truncated: true,
    });
    expect(line.startsWith("KALSA_ANSWER_TRUNCATED ")).toBe(true);
    expect(payloadOf(line)).toEqual({
      turnId: "turn-7",
      round: 2,
      tokensEvaluated: 900,
      tokensPredicted: 120,
      tokensCached: 512,
    });
  });
});
