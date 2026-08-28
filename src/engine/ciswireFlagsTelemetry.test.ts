/**
 * Omission rule for the ciswireFlags telemetry field (S1/S5 prep):
 * the field must be ABSENT from formatted lines when all bits are clear
 * (or unset) so pre-CisWire lines stay byte-identical, and present with
 * the raw bitmask when any bit is set.
 */

import { formatDigestLine } from "./digestTelemetry";
import {
  formatTelemetryLine,
  type RoundTelemetry,
} from "./turnTelemetry";
import { formatMemoryLine } from "../memory/memoryTelemetry";

const baseRound: RoundTelemetry = {
  round: 1,
  tokensCached: 10,
  tokensEvaluated: 20,
  tokensPredicted: 5,
  draftTokens: 0,
  draftAccepted: 0,
  promptMs: 100,
  predictedMs: 200,
  predictedPerSecond: 25,
  contextFull: false,
  interrupted: false,
};

const baseMemory = {
  memoryEnabled: 0,
  factsExtracted: -1,
  factsStored: -1,
  factsRejectedSensitive: -1,
  factsRejectedFull: -1,
  factsInjected: -1,
  totalFactsInStore: -1,
  dnaDeferred: -1,
  dnaInjected: -1,
  dnaBudgetTokens: -1,
  extractParseOutcome: -1,
  extractGateSource: -1,
  extractStopReason: -1,
};

const baseDigest = { durationMs: 3, corpusSize: 7, selectedCount: 2 };

function payloadOf(line: string): Record<string, unknown> {
  return JSON.parse(line.slice(line.indexOf(" ") + 1)) as Record<string, unknown>;
}

describe("ciswireFlags omission rule", () => {
  test("formatTelemetryLine omits the field when absent or 0", () => {
    expect(payloadOf(formatTelemetryLine("t1", baseRound))).not.toHaveProperty(
      "ciswireFlags",
    );
    expect(
      payloadOf(formatTelemetryLine("t1", { ...baseRound, ciswireFlags: 0 })),
    ).not.toHaveProperty("ciswireFlags");
  });

  test("formatMemoryLine omits the field when absent or 0", () => {
    expect(payloadOf(formatMemoryLine(baseMemory))).not.toHaveProperty(
      "ciswireFlags",
    );
    expect(
      payloadOf(formatMemoryLine({ ...baseMemory, ciswireFlags: 0 })),
    ).not.toHaveProperty("ciswireFlags");
  });

  test("formatDigestLine omits the field when absent or 0", () => {
    expect(payloadOf(formatDigestLine(baseDigest))).not.toHaveProperty(
      "ciswireFlags",
    );
    expect(
      payloadOf(formatDigestLine({ ...baseDigest, ciswireFlags: 0 })),
    ).not.toHaveProperty("ciswireFlags");
  });

  test("every formatter emits the raw bitmask when bits are set", () => {
    expect(
      payloadOf(formatTelemetryLine("t1", { ...baseRound, ciswireFlags: 5 })),
    ).toHaveProperty("ciswireFlags", 5);
    expect(
      payloadOf(formatMemoryLine({ ...baseMemory, ciswireFlags: 2 })),
    ).toHaveProperty("ciswireFlags", 2);
    expect(
      payloadOf(formatDigestLine({ ...baseDigest, ciswireFlags: 1 })),
    ).toHaveProperty("ciswireFlags", 1);
  });
});
