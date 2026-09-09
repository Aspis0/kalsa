jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///kalsa/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  computeHistoryHashFromMessages,
  markSessionDivergesAtLastExchange,
  readSessionMeta,
  sessionHistoryPrefixAccepts,
  sessionMetaKey,
  shouldSaveSession,
  writeSessionMeta,
} from "./sessionPersistence";

describe("sessionHistoryPrefixAccepts", () => {
  const prefix = [
    { role: "user", text: "old question" },
    { role: "assistant", text: "old answer" },
  ];
  const saved = {
    historyHash: computeHistoryHashFromMessages(prefix),
    historyMessageCount: prefix.length,
    divergesAtLastExchange: true,
  };

  test("accepts one marked completed tool exchange after the prefix", () => {
    expect(
      sessionHistoryPrefixAccepts(saved, [
        ...prefix,
        { role: "user", text: "search this" },
        { role: "assistant", text: "found it" },
      ]),
    ).toEqual({ accept: true });
  });

  test("keeps the completed-turn rejection for an unmarked prefix", () => {
    const current = [
      ...prefix,
      { role: "user", text: "completed" },
      { role: "assistant", text: "reply" },
    ];

    expect(
      sessionHistoryPrefixAccepts(
        { ...saved, divergesAtLastExchange: false },
        current,
      ),
    ).toEqual({ accept: false, reason: "stale_kv_completed_turn" });
  });

  test("rejects divergence earlier than the last exchange", () => {
    const current = [
      ...prefix,
      { role: "user", text: "first tool turn" },
      { role: "assistant", text: "first answer" },
      { role: "user", text: "second tool turn" },
      { role: "assistant", text: "second answer" },
    ];

    expect(sessionHistoryPrefixAccepts(saved, current)).toEqual({
      accept: false,
      reason: "stale_kv_completed_turn",
    });
  });

  test("rejects history shorter than the saved prefix", () => {
    expect(sessionHistoryPrefixAccepts(saved, prefix.slice(0, 1))).toEqual({
      accept: false,
      reason: "historyHash",
    });
  });

  test("rejects an equal-length prefix with a different hash", () => {
    expect(
      sessionHistoryPrefixAccepts(saved, [
        { role: "user", text: "changed question" },
        { role: "assistant", text: "old answer" },
      ]),
    ).toEqual({ accept: false, reason: "historyHash" });
  });

  test("rejects an interrupted assistant suffix", () => {
    expect(
      sessionHistoryPrefixAccepts(saved, [
        ...prefix,
        { role: "user", text: "search this" },
        { role: "assistant", text: "partial", interrupted: true },
      ]),
    ).toEqual({ accept: false, reason: "stale_kv_completed_turn" });
  });

  test("still accepts a pending user suffix", () => {
    expect(
      sessionHistoryPrefixAccepts(saved, [
        ...prefix,
        { role: "user", text: "pending" },
      ]),
    ).toEqual({ accept: true });
  });
});

describe("session meta marker", () => {
  test("mark round-trips through AsyncStorage", async () => {
    let raw = JSON.stringify({
      formatVersion: 1,
      nCtx: 4096,
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      historyHash: "hash",
      historyMessageCount: 2,
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === sessionMetaKey("tool") ? raw : null,
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (_key: string, value: string) => {
        raw = value;
      },
    );
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      isDirectory: false,
    });

    expect(
      await writeSessionMeta("tool", JSON.parse(raw)),
    ).toBe(true);
    expect(await markSessionDivergesAtLastExchange("tool")).toBe(true);
    expect((await readSessionMeta("tool"))?.divergesAtLastExchange).toBe(true);
  });
});

describe("shouldSaveSession", () => {
  const common = {
    hasContext: true,
    disposing: false,
    kvHoldsChatSession: true,
  };

  test("preserves the prefix for a marked last-exchange divergence", () => {
    expect(
      shouldSaveSession({
        ...common,
        kvReproducible: false,
        kvDivergesAtLastExchange: true,
      }),
    ).toEqual({ save: true, preservePrefix: true });
  });

  test("still refuses an unclassified non-reproducible KV", () => {
    expect(
      shouldSaveSession({ ...common, kvReproducible: false }),
    ).toEqual({ save: false, reason: "kv_not_reproducible" });
  });
});
