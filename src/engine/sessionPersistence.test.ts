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
  getFreeDiskStorageAsync: jest.fn(async () => 1_000_000_000),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { sessionStem } from "./sessionKey";
import { toPersistableHistoryMessages } from "./historyPersistable";
import {
  computeHistoryHashFromMessages,
  extractChatKvPaths,
  extractChatKvRestoreSource,
  markSessionDivergesAtLastExchange,
  readSessionMeta,
  sessionDiskGate,
  sessionDiskDeficitBytes,
  sessionFilePath,
  sessionMetaMismatchField,
  sessionAssembleBoundary,
  SESSION_FORMAT_VERSION,
  sessionHistoryPrefixAccepts,
  sessionKvSaveWouldBeInconsistent,
  sessionCheckpointCaptureIsHonest,
  sessionRecoverTrimIsHonest,
  sessionNativeSaveCoversNPast,
  chatKvHoldAfterNativeClear,
  lastSaveAfterHoldDrop,
  lastSaveTokensForHint,
  nativeEmptyForHoldDrop,
  rememberSuccessfulSessionSave,
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

describe("emissionSource upgrade invariant", () => {
  // The flag lives in the persisted JSON, so it changes history hashes by
  // design. The one thing that must NEVER change is the projection of a
  // record WITHOUT the flag: those are every conversation stored before the
  // upgrade, and if their bytes move, their saved hash no longer matches on
  // first boot and each one pays a cold prefill. The value below was frozen
  // by running commit 204298f's own toPersistableHistoryMessages +
  // historyHash over this exact record. SCOPE: the fixture carries only
  // id/role/text/createdAt/modelEmittedText — a pre-upgrade record can also
  // carry interrupted, edited, thinkingText, sources, miniapp, attachments,
  // images, downloads or ctas, so a change to mapPersistableAttachments, to
  // the thinkingText policy, or to the transient-key deletion set can shift
  // stored hashes with this test still green.
  const FROZEN_204298F_HASH = "3986477111";
  const flagFree = [
    { id: "u1", role: "user", text: "ciao", createdAt: 1 },
    {
      id: "a1",
      role: "assistant",
      text: "hey",
      createdAt: 2,
      modelEmittedText: "  hey  ",
    },
  ];

  test("a flag-free record hashes byte-identically to the pre-upgrade projection", () => {
    expect(computeHistoryHashFromMessages(flagFree)).toBe(FROZEN_204298F_HASH);
  });

  test("the projection of a flag-free record carries no emissionSource key", () => {
    const projected = JSON.stringify(toPersistableHistoryMessages(flagFree));
    expect(projected).not.toContain("emissionSource");
  });

  test("a flagged record hashes differently — the stakes are real, not ceremonial", () => {
    const flagged = flagFree.map((m, i) =>
      i === 1 ? { ...m, emissionSource: "parsed" as const } : m,
    );
    expect(computeHistoryHashFromMessages(flagged)).not.toBe(FROZEN_204298F_HASH);
  });
});

describe("history hash persistable projection", () => {
  test("raw boot extras hash as persistable of the same turn", () => {
    // ONE turn, ONE byte sequence: the padded emission rides on both sides
    // deliberately. The raw boot form and the persistable form of a turn must
    // hash identically because the projection strips only the transient boot
    // fields — never because trimming reconciles them. This fixture once
    // carried "  hey  " on one side and "hey" on the other, pinning the
    // reconciliation-by-trimming that 7b5b79b removed at save and the
    // load-path fix removed too; bytes are preserved, so the bytes must be
    // the same bytes.
    const emitted = "  hey  ";
    const persistable = [
      { id: "u1", role: "user", text: "ciao", createdAt: 1 },
      {
        id: "a1",
        role: "assistant",
        text: "hey",
        createdAt: 2,
        modelEmittedText: emitted,
      },
    ];
    const rawBoot = [
      { ...persistable[0], streaming: false, statusLabel: "Writing…" },
      {
        ...persistable[1],
        statusHistory: ["x"],
        modelEmittedText: emitted,
      },
    ];
    expect(computeHistoryHashFromMessages(rawBoot)).toBe(
      computeHistoryHashFromMessages(persistable),
    );
  });

  test("native 512-token save does not cover n_past 5632", () => {
    expect(sessionNativeSaveCoversNPast(512, 5632)).toBe(false);
    expect(sessionNativeSaveCoversNPast(3099, undefined)).toBe(true);
    expect(sessionNativeSaveCoversNPast(2357, 2357)).toBe(true);
    expect(sessionNativeSaveCoversNPast(undefined, 2357)).toBe(false);
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
    // Missing/invalid assembleBoundary reads as UNKNOWN (not 0): the restored
    // KV is held with no start fact and the next send reconciles before
    // assembling. Only a genuinely full-history KV carries the factual 0.
    expect(sessionAssembleBoundary(undefined)).toBeUndefined();
    expect(sessionAssembleBoundary({})).toBeUndefined();
    expect(sessionAssembleBoundary({ assembleBoundary: -1 })).toBeUndefined();
    expect(sessionAssembleBoundary({ assembleBoundary: 1.5 })).toBeUndefined();
    expect(sessionAssembleBoundary({ assembleBoundary: 12 })).toBe(12);
    expect(sessionAssembleBoundary({ assembleBoundary: 0 })).toBe(0);
  });

  test("readSessionMeta keeps assembleBoundary (omit → unknown)", async () => {
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
    expect((await readSessionMeta("b0"))?.assembleBoundary).toBeUndefined();
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

  test("S23 t2 extract-restore diverge: untrimmed tail then append", () => {
    // logcat S23-D39FA51-G2-T20-BATT-2026-09-13:
    // loadSession n_tokens=2441 pos_max=2440 resumable=1
    // t2 KVPREFIX embd=2441 text_tokens=2160 n_common=2137
    // TELEMETRY tokensCached=2360 tokensEvaluated=2160 tokensPredicted=199 prompt_n=333
    // save_refused n_tokens=2360 pos_max=2973
    const restoredTokens = 2441;
    const recoveredLabel = 2160 - 333; // 1827, KVDIAG checkpoints=[1827,1829,]
    const generated = 2360 - 2160; // 200 (predicted 199 + last token)
    expect(recoveredLabel).toBe(1827);
    expect(2440 + 333 + generated).toBe(2973);
    expect(restoredTokens - recoveredLabel).toBe(2973 - (2360 - 1));
    expect(sessionKvSaveWouldBeInconsistent(2360, 2973)).toBe(true);
    expect(sessionCheckpointCaptureIsHonest(1827, 2440)).toBe(false);
    expect(sessionCheckpointCaptureIsHonest(2441, 2440)).toBe(true);
    expect(sessionRecoverTrimIsHonest(1827, 2440, false)).toBe(false);
    expect(sessionRecoverTrimIsHonest(1827, 1826, true)).toBe(true);
  });

  test("t3 same extra-cell gap after another diverge", () => {
    // save_refused n_tokens=2316 pos_max=2929 — same 614 extra as t2
    expect(2973 - (2360 - 1)).toBe(2929 - (2316 - 1));
    expect(sessionKvSaveWouldBeInconsistent(2316, 2929)).toBe(true);
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

  test("load failure keeps the .kvs for kv_inconsistent and history_not_reproducible", () => {
    expect(shouldDeleteSessionArtifactsOnLoadFailure("kv_inconsistent")).toBe(
      false,
    );
    expect(
      shouldDeleteSessionArtifactsOnLoadFailure("history_not_reproducible"),
    ).toBe(false);
    expect(
      shouldDeleteSessionArtifactsOnLoadFailure(
        "meta_mismatch:history_not_reproducible",
      ),
    ).toBe(false);
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
      lastSuccessfulSessionSave: null,
    });
  });
});

describe("lastSaveTokensForHint", () => {
  const identity = { engineBuild: "eng-1", conversationId: "chat-a" };
  const saved = rememberSuccessfulSessionSave(
    null,
    {
      stem: "m__chat-a__env",
      historyHash: "h",
      usedTokens: 7189,
      engineBuild: identity.engineBuild,
      conversationId: identity.conversationId,
    },
    true,
  );

  test("after successful save, lastSaveTokens is positive", () => {
    expect(lastSaveTokensForHint(saved, identity)).toBe(7189);
  });

  test("after proven native clear, lastSaveTokens is undefined", () => {
    const cleared = chatKvHoldAfterNativeClear();
    expect(cleared.lastSuccessfulSessionSave).toBeNull();
    expect(
      lastSaveTokensForHint(cleared.lastSuccessfulSessionSave, identity),
    ).toBeUndefined();
  });

  test("leftover save from chat A does not hint chat B or another engine", () => {
    expect(
      lastSaveTokensForHint(saved, {
        engineBuild: identity.engineBuild,
        conversationId: "chat-b",
      }),
    ).toBeUndefined();
    expect(
      lastSaveTokensForHint(saved, {
        engineBuild: "eng-2",
        conversationId: identity.conversationId,
      }),
    ).toBeUndefined();
  });
});

describe("dropChatKvHold nativeEmpty contract", () => {
  const identity = { engineBuild: "eng-1", conversationId: "chat-a" };
  const saved = rememberSuccessfulSessionSave(
    null,
    {
      stem: "m__chat-a__env",
      historyHash: "h",
      usedTokens: 7189,
      engineBuild: identity.engineBuild,
      conversationId: identity.conversationId,
    },
    true,
  );

  test("drop(true) only after nativeEmpty", () => {
    expect(nativeEmptyForHoldDrop({})).toBe(false);
    expect(nativeEmptyForHoldDrop({ clearCacheSucceeded: false })).toBe(false);
    expect(nativeEmptyForHoldDrop({ contextReleased: false })).toBe(false);
    expect(nativeEmptyForHoldDrop({ clearCacheSucceeded: true })).toBe(true);
    expect(nativeEmptyForHoldDrop({ contextReleased: true })).toBe(true);
    expect(lastSaveAfterHoldDrop(saved, true)).toBeNull();
    expect(
      lastSaveTokensForHint(lastSaveAfterHoldDrop(saved, true), identity),
    ).toBeUndefined();
  });

  test("overwrite completion return does not imply nativeEmpty", () => {
    expect(nativeEmptyForHoldDrop({})).toBe(false);
    expect(
      lastSaveAfterHoldDrop(saved, nativeEmptyForHoldDrop({})),
    ).toEqual(saved);
    expect(
      lastSaveTokensForHint(lastSaveAfterHoldDrop(saved, false), identity),
    ).toBe(7189);
  });

  test("t10 flag-only drop keeps last-save fingerprint", () => {
    const kept = lastSaveAfterHoldDrop(saved, false);
    expect(kept).toEqual(saved);
    expect(lastSaveTokensForHint(kept, identity)).toBe(7189);
  });

  test("invalidation without clear does not null lastSuccessfulSessionSave", () => {
    const nativeEmpty = nativeEmptyForHoldDrop({ clearCacheSucceeded: false });
    expect(nativeEmpty).toBe(false);
    const kept = lastSaveAfterHoldDrop(saved, nativeEmpty);
    expect(kept).toEqual(saved);
    expect(lastSaveTokensForHint(kept, identity)).toBe(7189);
  });

  test("failed extract restore without clear keeps last-save fingerprint", () => {
    const nativeEmpty = nativeEmptyForHoldDrop({ clearCacheSucceeded: false });
    expect(lastSaveAfterHoldDrop(saved, nativeEmpty)).toEqual(saved);
  });

  test("failed load without clear keeps lastSaveTokens", () => {
    const nativeEmpty = nativeEmptyForHoldDrop({ clearCacheSucceeded: false });
    expect(nativeEmpty).toBe(false);
    const kept = lastSaveAfterHoldDrop(saved, nativeEmpty);
    expect(kept).toEqual(saved);
    expect(lastSaveTokensForHint(kept, identity)).toBe(7189);
  });

  test("utility drop(true) only after clearCache success", () => {
    expect(
      nativeEmptyForHoldDrop({
        clearCacheSucceeded: false,
      }),
    ).toBe(false);
    expect(
      lastSaveAfterHoldDrop(
        saved,
        nativeEmptyForHoldDrop({ clearCacheSucceeded: false }),
      ),
    ).toEqual(saved);
    expect(
      lastSaveAfterHoldDrop(
        saved,
        nativeEmptyForHoldDrop({ clearCacheSucceeded: true }),
      ),
    ).toBeNull();
  });
});

describe("sessionDiskGate", () => {
  const input = { nPast: 100, nCtx: 8192, bytesPerToken: 5200 };

  test("exact-fit eviction still leaves one byte for the strict gate", () => {
    const required = 100;
    const free = 90;
    const evictable = required - free;

    expect(sessionDiskDeficitBytes(required, free)).toBe(evictable + 1);
    expect(sessionDiskDeficitBytes(required, required)).toBe(0);
  });

  afterEach(() => {
    (FileSystem.getFreeDiskStorageAsync as jest.Mock)
      .mockReset()
      .mockResolvedValue(1_000_000_000);
  });

  test("plenty of free space passes, with the requirement named", async () => {
    const gate = await sessionDiskGate(input);
    expect(gate.ok).toBe(true);
    expect(gate.reason).toBeNull();
    expect(gate.requiredBytes).toBeGreaterThan(0);
    expect(gate.freeBytes).toBe(1_000_000_000);
  });

  test("free below the requirement is short — the only deleting refusal", async () => {
    (FileSystem.getFreeDiskStorageAsync as jest.Mock).mockResolvedValue(
      1_000,
    );
    const gate = await sessionDiskGate(input);
    expect(gate).toMatchObject({ ok: false, reason: "short" });
    expect(gate.freeBytes).toBe(1_000);
    expect(gate.requiredBytes).toBeGreaterThan(1_000);
  });

  test("a negative free reading is unreadable, never short", async () => {
    // -1-for-unknown must not classify as a small amount of free space:
    // "short" is the one refusal that authorizes deleting caches.
    (FileSystem.getFreeDiskStorageAsync as jest.Mock).mockResolvedValue(-1);
    const gate = await sessionDiskGate(input);
    expect(gate).toMatchObject({
      ok: false,
      reason: "disk_unreadable",
      freeBytes: null,
    });
  });
});
