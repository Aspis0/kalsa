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

import { sessionStem } from "./sessionKey";
import { pickEvictionStems, staleStemsForConversation } from "./sessionPool";

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
