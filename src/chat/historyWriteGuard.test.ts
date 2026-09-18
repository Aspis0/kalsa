import {
  assessLoadedHistory,
  baselineImpliesStoredMessages,
  copyToQuarantineUnlessPresent,
  evaluateHistoryWrite,
  type HistoryKv,
} from "./historyWriteGuard";

const MESSAGES_KEY = "kalsa.messages.testconv";

/** 17-entry history in the persisted shape (id/role/text per message). */
const raw17 = JSON.stringify(
  Array.from({ length: 17 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `text ${i}`,
  })),
);

/** Map-backed fake KV standing in for AsyncStorage in these tests. */
function fakeKv(seed?: Record<string, string>): HistoryKv {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

describe("historyWriteGuard", () => {
  test("2-over-17: a shrink without opt-in is refused", () => {
    const decision = evaluateHistoryWrite({
      baseline: { kind: "known", count: 17 },
      incomingCount: 2,
      optIn: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.nextBaseline).toEqual({ kind: "known", count: 17 });
  });

  test("2-over-17 with explicit opt-in is allowed and adopts the new count", () => {
    const decision = evaluateHistoryWrite({
      baseline: { kind: "known", count: 17 },
      incomingCount: 2,
      optIn: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.nextBaseline).toEqual({ kind: "known", count: 2 });
  });

  test("unparseable raw: unknown baseline refuses every non-opt-in write, raw routed to quarantine, original untouched", async () => {
    const broken = '{"messages": [';
    const assessment = assessLoadedHistory({
      raw: broken,
      sanitize: (entries) => entries,
    });
    expect(assessment.baseline).toEqual({ kind: "unknown" });
    expect(assessment.quarantineRaw).toBe(true);
    expect(assessment.messages).toEqual([]);
    // Unknown means non-zero by assumption: nothing may overwrite the key.
    for (const incomingCount of [1, 2, 17, 100]) {
      expect(
        evaluateHistoryWrite({
          baseline: assessment.baseline,
          incomingCount,
          optIn: false,
        }).allowed,
      ).toBe(false);
    }
    expect(baselineImpliesStoredMessages(assessment.baseline)).toBe(true);

    const kv = fakeKv({ [MESSAGES_KEY]: broken });
    const copied = await copyToQuarantineUnlessPresent(
      kv,
      MESSAGES_KEY,
      broken,
    );
    expect(copied).toBe(true);
    expect(await kv.getItem(MESSAGES_KEY)).toBe(broken);
    expect(await kv.getItem(`${MESSAGES_KEY}.quarantine`)).toBe(broken);
  });

  test("sanitize yields 0 from a 17-entry raw: baseline is the raw length, write refused, raw quarantined", async () => {
    const assessment = assessLoadedHistory({
      raw: raw17,
      sanitize: () => [],
    });
    expect(assessment.baseline).toEqual({ kind: "known", count: 17 });
    expect(assessment.quarantineRaw).toBe(true);
    expect(assessment.messages).toEqual([]);
    expect(
      evaluateHistoryWrite({
        baseline: assessment.baseline,
        incomingCount: 2,
        optIn: false,
      }).allowed,
    ).toBe(false);
    // Invariant 3 hook: the store is NOT empty even though the screen shows 0.
    expect(baselineImpliesStoredMessages(assessment.baseline)).toBe(true);

    const kv = fakeKv({ [MESSAGES_KEY]: raw17 });
    expect(
      await copyToQuarantineUnlessPresent(kv, MESSAGES_KEY, raw17),
    ).toBe(true);
    expect(await kv.getItem(MESSAGES_KEY)).toBe(raw17);
  });

  test("no false positives: growth and equal-length writes always pass", () => {
    const known17 = { kind: "known", count: 17 } as const;
    expect(
      evaluateHistoryWrite({
        baseline: known17,
        incomingCount: 17,
        optIn: false,
      }).allowed,
    ).toBe(true);
    const growth = evaluateHistoryWrite({
      baseline: known17,
      incomingCount: 18,
      optIn: false,
    });
    expect(growth.allowed).toBe(true);
    expect(growth.nextBaseline).toEqual({ kind: "known", count: 18 });
    // A genuinely empty conversation accepts its first message.
    expect(
      evaluateHistoryWrite({
        baseline: { kind: "known", count: 0 },
        incomingCount: 1,
        optIn: false,
      }).allowed,
    ).toBe(true);
    const emptyRaw = assessLoadedHistory({
      raw: "[]",
      sanitize: () => [],
    });
    expect(emptyRaw.baseline).toEqual({ kind: "known", count: 0 });
    expect(emptyRaw.quarantineRaw).toBe(false);
    expect(
      assessLoadedHistory({ raw: null, sanitize: () => [] }).baseline,
    ).toEqual({ kind: "known", count: 0 });
  });

  test("quarantine never clobbers an existing quarantine", async () => {
    const firstCopy = '{"oldest": true}';
    const kv = fakeKv({
      [MESSAGES_KEY]: raw17,
      [`${MESSAGES_KEY}.quarantine`]: firstCopy,
    });
    const copied = await copyToQuarantineUnlessPresent(
      kv,
      MESSAGES_KEY,
      raw17,
    );
    expect(copied).toBe(false);
    expect(await kv.getItem(`${MESSAGES_KEY}.quarantine`)).toBe(firstCopy);
    expect(await kv.getItem(MESSAGES_KEY)).toBe(raw17);
  });
});
