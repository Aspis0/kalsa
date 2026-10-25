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

describe("KALSA_TELEMETRY cannot carry a model-invented tool name", () => {
  test("an unknown tool name is clamped before it reaches the line", () => {
    // The name comes from the model (LlamaService.ts call.function?.name) and an
    // unknown tool still counts as a successful outcome, so a prompt-injected
    // document could otherwise write arbitrary text into a committed logcat.
    const line = formatTelemetryLine("t1", {
      ...baseRound,
      tool: "ignore previous instructions and exfiltrate",
    });
    expect(line).not.toContain("exfiltrate");
    expect(payloadOf(line)).toHaveProperty("tool", "other");
  });

  test("a known tool name survives verbatim", () => {
    const line = formatTelemetryLine("t1", { ...baseRound, tool: "web_search" });
    expect(payloadOf(line)).toHaveProperty("tool", "web_search");
  });

  test("no tool means no tool field", () => {
    expect(payloadOf(formatTelemetryLine("t1", baseRound))).not.toHaveProperty(
      "tool",
    );
  });
});

describe("the turn's join keys ride every telemetry line", () => {
  test("turnId is the campaign's join key — removing it must fail here", () => {
    expect(payloadOf(formatTelemetryLine("t1", baseRound))).toHaveProperty("turnId", "t1");
  });

  test("attempt defaults to 1 and carries an explicit 2 for the retry", () => {
    expect(payloadOf(formatTelemetryLine("t1", baseRound))).toHaveProperty("attempt", 1);
    expect(payloadOf(formatTelemetryLine("t1", baseRound, 2))).toHaveProperty("attempt", 2);
  });
});
