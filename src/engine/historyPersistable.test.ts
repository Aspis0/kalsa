import {
  restoreTerminalFlags,
  toPersistableHistoryMessages,
} from "./historyPersistable";

describe("restoreTerminalFlags", () => {
  test("restores truncated and interrupted for nonempty text", () => {
    expect(
      restoreTerminalFlags({ interrupted: true, truncated: true }, "hello"),
    ).toEqual({ interrupted: true, truncated: true });
  });

  test("empty text does not restore markers", () => {
    expect(
      restoreTerminalFlags({ interrupted: true, truncated: true }, "   "),
    ).toEqual({});
  });
});

describe("toPersistableHistoryMessages", () => {
  test("keeps truncated on a nonempty assistant and drops it on empty text", () => {
    const out = toPersistableHistoryMessages([
      {
        id: "a1",
        role: "assistant",
        text: "cut off",
        truncated: true,
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        text: "   ",
        truncated: true,
        streaming: false,
      },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]?.truncated).toBe(true);
    expect(out[1]?.truncated).toBeUndefined();
  });

  test("round-trip: persisted truncated hydrates after reload", () => {
    const persisted = toPersistableHistoryMessages([
      {
        id: "a1",
        role: "assistant",
        text: "token limit",
        truncated: true,
      },
    ]) as Array<Record<string, unknown>>;
    const rec = persisted[0] ?? {};
    const flags = restoreTerminalFlags(rec, String(rec.text ?? ""));
    expect(flags.truncated).toBe(true);
    expect(flags.interrupted).toBeUndefined();
  });
});
