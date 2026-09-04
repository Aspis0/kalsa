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
