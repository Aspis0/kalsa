/**
 * Session stem: model + conversation + computePromptEnvHash.
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
  documentDirectory: "/tmp/",
  cacheDirectory: "/tmp/",
}));

import { computePromptEnvHash } from "./sessionPersistence";
import {
  isLegacySessionFileName,
  parseSessionStem,
  sessionStem,
} from "./sessionKey";

describe("sessionStem", () => {
  test("includes model, conversation, and computePromptEnvHash", () => {
    const env = computePromptEnvHash("en", ["User likes espresso"], true);
    const stem = sessionStem("lfm2.5-8b-a1b-kexp", "conv-1", env);
    expect(stem).toBe(`lfm2_002e5-8b-a1b-kexp__conv-1__${env}`);
  });

  test("different prompt env hashes produce different stems", () => {
    const a = computePromptEnvHash("en", ["A"], true);
    const b = computePromptEnvHash("en", ["B"], true);
    expect(a).not.toBe(b);
    expect(sessionStem("m", "c", a)).not.toBe(sessionStem("m", "c", b));
  });

  test("null when a part is empty", () => {
    expect(sessionStem("", "c", "1")).toBeNull();
    expect(sessionStem("m", "", "1")).toBeNull();
    expect(sessionStem("m", "c", "")).toBeNull();
  });

  test("path separators are injective (a/b ≠ a_b)", () => {
    const slash = sessionStem("a/b", "c", "1");
    const under = sessionStem("a_b", "c", "1");
    expect(slash).toBe("a_002fb__c__1");
    expect(under).toBe("a_005fb__c__1");
    expect(slash).not.toBe(under);
  });
});

describe("parseSessionStem", () => {
  test("round-trips a pooled file name", () => {
    const env = computePromptEnvHash("it", [], false);
    const stem = sessionStem("qwen3.5-4b", "conv-99", env);
    expect(parseSessionStem(`${stem}.kvs`)).toEqual({
      modelId: "qwen3_002e5-4b",
      conversationId: "conv-99",
      promptEnvHash: env,
    });
  });

  test("rejects legacy per-model file and sidecars", () => {
    expect(parseSessionStem("qwen3.5-4b.kvs")).toBeNull();
    expect(parseSessionStem("qwen3.5-4b.kvs.meta")).toBeNull();
    expect(isLegacySessionFileName("qwen3.5-4b.kvs")).toBe(true);
    expect(isLegacySessionFileName("qwen3.5-4b__c__1.kvs")).toBe(false);
  });
});
