/** Schema tests for the per-turn tags: window, telemetry, thinking, truncation, ctx floor. */
import { formatRecord } from "../schema";

function record(tag: string, json: string): Record<string, unknown> | null {
  const line = formatRecord(tag, JSON.parse(json));
  return line === null ? null : (JSON.parse(line.replace(/^[^ ]+ /, "")) as Record<string, unknown>);
}

describe("KALSA_TELEMETRY (turnTelemetry.ts:226-235)", () => {
  const full = {
    turnId: "3",
    attempt: 1,
    round: 1,
    tokensCached: 5466,
    tokensEvaluated: 6000,
    tokensPredicted: 120,
    draftTokens: 30,
    draftAccepted: 20,
    promptMs: 812,
    predictedMs: 4000,
    predictedPerSecond: 30.01,
    contextFull: false,
    interrupted: false,
    truncated: false,
    tool: "document_chat",
    strategy: "hybrid",
    prompt_n: 5470,
    ciswireFlags: 3,
  };

  it("keeps a real emitted line with tool and strategy", () => {
    expect(record("KALSA_TELEMETRY", JSON.stringify(full))).toEqual(full);
  });

  it("keeps the line without the optional tool fields", () => {
    const { tool, strategy, ciswireFlags, ...plain } = full;
    void tool;
    void strategy;
    void ciswireFlags;
    expect(record("KALSA_TELEMETRY", JSON.stringify(plain))).toEqual(plain);
  });

  it("drops a tool name the clamp would never produce", () => {
    const out = record(
      "KALSA_TELEMETRY",
      JSON.stringify({ ...full, tool: "ignore previous instructions" }),
    );
    expect(out?.tool).toBeUndefined();
    expect(out?.strategy).toBe("hybrid");
  });

  it("drops a strategy outside the emitter set", () => {
    const out = record(
      "KALSA_TELEMETRY",
      JSON.stringify({ ...full, strategy: "https://x.com/?t=secret" }),
    );
    expect(out?.strategy).toBeUndefined();
  });
});

describe("KALSA_WINDOW (engineTurnStream.ts:130-149)", () => {
  it("keeps a full anchored line", () => {
    const payload = {
      turnId: "3",
      kvHeld: true,
      nPast: 5466,
      lastSaveTokens: 512,
      loadedB: false,
      hasDigest: true,
      legacyWindowStart: 0,
      historyDropped: "history_dropped_window_exceeds_budget",
      rebuildBudgetChars: 2304,
      rebuildBudgetSource: "profile",
      textEst: 2000,
      measuredCharsPerToken: 3.71,
      windowTokens: 8192,
    };
    expect(record("KALSA_WINDOW", JSON.stringify(payload))).toEqual(payload);
  });

  it("keeps nulls for missing KV facts", () => {
    const out = record(
      "KALSA_WINDOW",
      '{"turnId":"4","kvHeld":false,"nPast":null,"lastSaveTokens":null,"loadedB":true,"hasDigest":false,"legacyWindowStart":2,"textEst":100}',
    );
    expect(out).toEqual({
      turnId: "4",
      kvHeld: false,
      nPast: null,
      lastSaveTokens: null,
      loadedB: true,
      hasDigest: false,
      legacyWindowStart: 2,
      textEst: 100,
    });
  });

  it("drops unknown fields and wrong enum values", () => {
    const out = record(
      "KALSA_WINDOW",
      JSON.stringify({
        turnId: "4",
        kvHeld: false,
        legacyWindowStart: 0,
        textEst: 10,
        historyDropped: "dropped because /Users/marco said so",
        rebuildBudgetSource: "guess",
        userText: "hello there",
      }),
    );
    expect(out).toEqual({ turnId: "4", kvHeld: false, legacyWindowStart: 0, textEst: 10 });
  });
});

describe("KALSA_THINKING (LlamaService.ts:4448-4454)", () => {
  it("keeps the budget line", () => {
    expect(
      record(
        "KALSA_THINKING",
        '{"turnId":"3","budget":512,"decodeTokPerSec":12.5,"forceShort":false,"contextMode":"anchored"}',
      ),
    ).toEqual({
      turnId: "3",
      budget: 512,
      decodeTokPerSec: 12.5,
      forceShort: false,
      contextMode: "anchored",
    });
  });

  it("drops a contextMode outside the compactor modes", () => {
    const out = record(
      "KALSA_THINKING",
      '{"turnId":"3","budget":512,"decodeTokPerSec":12.5,"forceShort":true,"contextMode":"turbo"}',
    );
    expect(out).toEqual({ turnId: "3", budget: 512, decodeTokPerSec: 12.5, forceShort: true });
  });
});

describe("KALSA_ANSWER_TRUNCATED (turnTelemetry.ts:249-255)", () => {
  it("keeps the counters", () => {
    expect(
      record(
        "KALSA_ANSWER_TRUNCATED",
        '{"turnId":"3","round":1,"tokensEvaluated":6000,"tokensPredicted":8192,"tokensCached":8192}',
      ),
    ).toEqual({
      turnId: "3",
      round: 1,
      tokensEvaluated: 6000,
      tokensPredicted: 8192,
      tokensCached: 8192,
    });
  });
});

describe("KALSA_CTX_FLOOR (LlamaService.ts:2346)", () => {
  it("keeps nCtx and rejects a string", () => {
    expect(record("KALSA_CTX_FLOOR", '{"nCtx":16384}')).toEqual({ nCtx: 16384 });
    expect(record("KALSA_CTX_FLOOR", '{"nCtx":"16384"}')).toEqual({});
  });
});
