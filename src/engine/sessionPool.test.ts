/**
 * LRU eviction decision + stale prompt-env discard.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => undefined),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));

import { STATIC_PREFIX_CONVERSATION_ID, sessionStem } from "./sessionKey";
import {
  deleteSessionsForModelConversation,
  pickEvictionStems,
  staleStemsForConversation,
} from "./sessionPool";

describe("pickEvictionStems", () => {
  test("does nothing when under budget", () => {
    const files = [
      { stem: "keep", bytes: 40_000_000, lastUsedAt: 3 },
      { stem: "old", bytes: 40_000_000, lastUsedAt: 1 },
    ];
    expect(pickEvictionStems(files, 100_000_000, "keep")).toEqual([]);
  });

  test("evicts least-recently-used first and never the keep stem", () => {
    const files = [
      { stem: "keep", bytes: 90_000_000, lastUsedAt: 10 },
      { stem: "oldest", bytes: 50_000_000, lastUsedAt: 1 },
      { stem: "middle", bytes: 50_000_000, lastUsedAt: 5 },
    ];
    // 190 used vs 100 budget: drop oldest (140 still over) then middle.
    // keep stays even though it alone is 90.
    expect(pickEvictionStems(files, 100_000_000, "keep")).toEqual([
      "oldest",
      "middle",
    ]);
  });

  test("the static-prefix snapshot is neither charged nor evicted", () => {
    // The budget is expressed in CONVERSATIONS (sessionBudget.ts:
    // 5200 x 8192 = 42.6 MB each, and the picker offers 1), while the
    // snapshot is shared infrastructure of ~12.6 MB. Charging it made the
    // two evict each other: save, evict, recompute a 40 s prefill, save.
    const snapshot = sessionStem("lfm2.5", STATIC_PREFIX_CONVERSATION_ID, "pfx1")!;
    const chat = sessionStem("lfm2.5", "conv-1", "env")!;
    const files = [
      { stem: snapshot, bytes: 12_600_000, lastUsedAt: 1 },
      { stem: chat, bytes: 30_000_000, lastUsedAt: 2 },
    ];
    // 42.6 MB total would be over a 42,598,400 budget if the snapshot counted;
    // the chat alone is not, so nothing is evicted and the oldest file — the
    // snapshot — is not the victim it would otherwise be.
    expect(pickEvictionStems(files, 42_598_400, chat)).toEqual([]);
    // And even when the chats really are over budget, the snapshot is not
    // offered as a victim: only the chat stems are.
    const chat2 = sessionStem("lfm2.5", "conv-2", "env")!;
    expect(
      pickEvictionStems(
        [
          { stem: snapshot, bytes: 12_600_000, lastUsedAt: 0 },
          { stem: chat, bytes: 30_000_000, lastUsedAt: 1 },
          { stem: chat2, bytes: 30_000_000, lastUsedAt: 2 },
        ],
        42_598_400,
        chat2,
      ),
    ).toEqual([chat]);
  });

  test("stops once remaining fits", () => {
    const files = [
      { stem: "keep", bytes: 40, lastUsedAt: 9 },
      { stem: "a", bytes: 40, lastUsedAt: 1 },
      { stem: "b", bytes: 40, lastUsedAt: 2 },
    ];
    expect(pickEvictionStems(files, 80, "keep")).toEqual(["a"]);
  });

  test("evicts foreign-model files before same-model LRU", () => {
    const keep = sessionStem("lfm2.5-2.6b", "c-keep", "env")!;
    const sameOld = sessionStem("lfm2.5-2.6b", "c-old", "env")!;
    const foreignNew = sessionStem("minicpm5-8b", "c-new", "env")!;
    const foreignOld = sessionStem("minicpm5-8b", "c-old", "env")!;
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 10 },
      { stem: sameOld, bytes: 40, lastUsedAt: 1 },
      { stem: foreignNew, bytes: 50, lastUsedAt: 9 },
      { stem: foreignOld, bytes: 50, lastUsedAt: 2 },
    ];
    // 180 used vs 80 budget: drop both MiniCPM5 (100) and stop. sameOld stays.
    expect(pickEvictionStems(files, 80, keep)).toEqual([foreignOld, foreignNew]);
    expect(pickEvictionStems(files, 80, keep)).not.toContain(keep);
  });

  test("same-model still LRU after foreign files are gone", () => {
    const keep = sessionStem("lfm2.5-2.6b", "c-keep", "env")!;
    const older = sessionStem("lfm2.5-2.6b", "c-older", "env")!;
    const newer = sessionStem("lfm2.5-2.6b", "c-newer", "env")!;
    const foreign = sessionStem("minicpm5-8b", "c-x", "env")!;
    const files = [
      { stem: keep, bytes: 40, lastUsedAt: 10 },
      { stem: older, bytes: 40, lastUsedAt: 2 },
      { stem: newer, bytes: 40, lastUsedAt: 8 },
      { stem: foreign, bytes: 50, lastUsedAt: 9 },
    ];
    // 170 vs 80: foreign (50) then same-model older (40) → 80. newer stays.
    expect(pickEvictionStems(files, 80, keep)).toEqual([foreign, older]);
    expect(pickEvictionStems(files, 80, keep)).not.toContain(keep);
    expect(pickEvictionStems(files, 80, keep)).not.toContain(newer);
  });
});

describe("staleStemsForConversation", () => {
  test("drops same model+conversation with a different env hash", () => {
    const keep = sessionStem("m", "c1", "envA");
    const stale = sessionStem("m", "c1", "envB");
    const other = sessionStem("m", "c2", "envB");
    const names = [`${keep}.kvs`, `${stale}.kvs`, `${other}.kvs`, "m.kvs"];
    expect(staleStemsForConversation(names, "m", "c1", "envA")).toEqual([stale]);
  });
});

describe("deleteSessionsForModelConversation", () => {
  test("throws when a matching .kvs survives the delete", async () => {
    const FileSystem = await import("expo-file-system/legacy");
    const stem = sessionStem("lfm2.5-2.6b", "chat-1", "env")!;
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      isDirectory: true,
    });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      `${stem}.kvs`,
    ]);
    // deleteAsync is a no-op mock, so the re-list still sees the file.
    await expect(
      deleteSessionsForModelConversation("lfm2.5-2.6b", "chat-1"),
    ).rejects.toThrow(/left 1 \.kvs/);
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: false,
      isDirectory: false,
    });
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
  });
});
