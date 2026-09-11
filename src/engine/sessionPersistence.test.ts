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
import { sessionStem } from "./sessionKey";
import {
  computeHistoryHashFromMessages,
  extractChatKvPaths,
  extractChatKvRestoreSource,
  markSessionDivergesAtLastExchange,
  readSessionMeta,
  sessionFilePath,
  sessionMetaMismatchField,
  sessionAssembleBoundary,
  SESSION_FORMAT_VERSION,
  sessionHistoryPrefixAccepts,
  sessionKvSaveWouldBeInconsistent,
  chatKvHoldAfterNativeClear,
  sessionMetaKey,
  sessionNativeErrorReason,
  shouldDeleteSessionArtifactsOnLoadFailure,
  shouldSaveSession,
  writeSessionMeta,
  type SessionMeta,
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

  test("rejects short KV meta paired with a completed-assistant boot", () => {
    const userOnly = [{ role: "user", text: "ciao" }];
    expect(
      sessionHistoryPrefixAccepts(
        {
          historyHash: computeHistoryHashFromMessages(userOnly),
          historyMessageCount: 1,
        },
        [...userOnly, { role: "assistant", text: "ciao!" }],
      ),
    ).toEqual({ accept: false, reason: "stale_kv_completed_turn" });
  });
});

describe("extract chat KV restore", () => {
  const modelId = "lfm2.5-2.6b";
  const stem = sessionStem(modelId, "conv-g1-i14-1789042691", "71419929")!;

  test("prefers live snapshot over an existing disk file", () => {
    expect(
      extractChatKvRestoreSource({ snapshotOk: true, diskExists: true }),
    ).toBe("snapshot");
  });

  test("falls back to disk only when snapshot fails", () => {
    expect(
      extractChatKvRestoreSource({ snapshotOk: false, diskExists: true }),
    ).toBe("disk");
    expect(
      extractChatKvRestoreSource({ snapshotOk: false, diskExists: false }),
    ).toBe("none");
  });

  test("disk restore path is the pooled stem, not modelId", () => {
    const paths = extractChatKvPaths(stem);
    expect(paths.disk).toBe(sessionFilePath(stem));
    expect(paths.snapshot).toBe(`${paths.disk}.extract-ckpt`);
    expect(paths.disk).not.toBe(sessionFilePath(modelId));
  });
});

describe("session meta marker", () => {
  test("mark round-trips through AsyncStorage", async () => {
    let raw = JSON.stringify({
      formatVersion: SESSION_FORMAT_VERSION,
      modelFileId: "123:4500",
      engineBuild: "kalsa-native-patches-v1:app:7",
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
    const meta = await readSessionMeta("tool");
    expect(meta?.divergesAtLastExchange).toBe(true);
    expect(meta?.modelFileId).toBe("123:4500");
    expect(meta?.engineBuild).toBe("kalsa-native-patches-v1:app:7");
  });

  test("reports model file and engine build mismatches", () => {
    const base: SessionMeta = {
      formatVersion: SESSION_FORMAT_VERSION,
      modelFileId: "1:2",
      engineBuild: "build-a",
      nCtx: 4096,
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      historyHash: "hash",
    };
    expect(
      sessionMetaMismatchField({ ...base, modelFileId: "3:4" }, base),
    ).toBe("modelFileId");
    expect(
      sessionMetaMismatchField({ ...base, engineBuild: "build-b" }, base),
    ).toBe("engineBuild");
    expect(
      sessionMetaMismatchField({ ...base, assembleBoundary: 12 }, base),
    ).toBe(null);
    expect(sessionAssembleBoundary(undefined)).toBe(0);
    expect(sessionAssembleBoundary({ assembleBoundary: 12 })).toBe(12);
  });

  test("readSessionMeta keeps assembleBoundary (omit → 0)", async () => {
    const required = {
      formatVersion: SESSION_FORMAT_VERSION,
      modelFileId: "1:2",
      engineBuild: "build-a",
      nCtx: 4096,
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      historyHash: "hash",
    };
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === sessionMetaKey("b12")
        ? JSON.stringify({ ...required, assembleBoundary: 12 })
        : key === sessionMetaKey("b0")
          ? JSON.stringify(required)
          : null,
    );
    expect((await readSessionMeta("b12"))?.assembleBoundary).toBe(12);
    expect((await readSessionMeta("b0"))?.assembleBoundary).toBe(0);
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

describe("hybrid snapshot consistency", () => {
  test("native save-refuse: pos_max+1 must equal n_tokens", () => {
    expect(sessionKvSaveWouldBeInconsistent(5927, 6093)).toBe(true);
    expect(sessionKvSaveWouldBeInconsistent(5927, 5926)).toBe(false);
    expect(sessionKvSaveWouldBeInconsistent(0, -1)).toBe(false);
    expect(sessionKvSaveWouldBeInconsistent(5927, 5000)).toBe(true);
  });

  test("maps native kv_inconsistent throw to a stable reason", () => {
    expect(sessionNativeErrorReason(new Error("kv_inconsistent"))).toBe(
      "kv_inconsistent",
    );
    expect(
      sessionNativeErrorReason(new Error("Failed to load session: kv_inconsistent")),
    ).toBe("kv_inconsistent");
    expect(sessionNativeErrorReason(new Error("Failed to load session"))).toBe(
      null,
    );
  });

  test("load failure keeps the .kvs only for kv_inconsistent", () => {
    expect(shouldDeleteSessionArtifactsOnLoadFailure("kv_inconsistent")).toBe(
      false,
    );
    expect(shouldDeleteSessionArtifactsOnLoadFailure("tokens_loaded:0")).toBe(
      true,
    );
    expect(shouldDeleteSessionArtifactsOnLoadFailure("error:Error")).toBe(true);
    expect(shouldDeleteSessionArtifactsOnLoadFailure("")).toBe(true);
  });

  test("native clear drops chat-KV hold so save cannot overwrite a kept file", () => {
    expect(chatKvHoldAfterNativeClear()).toEqual({
      kvHoldsChatSession: false,
      lastChatNPast: undefined,
      chatKvDiskCurrent: false,
    });
  });
});
