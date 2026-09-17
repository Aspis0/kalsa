/**
 * Pure-function tests: computePromptEnvHash (sessionPersistence).
 * Memory facts ride the last user message (MEMORY_FACTS_ON_USER_TAIL) and are
 * deliberately not hashed: a new fact re-encodes only that tail, so the stable
 * prefix — and its KV cache — stays valid.
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

import { getStrings } from "../i18n";
import { computePromptEnvHash } from "./sessionPersistence";

describe("computePromptEnvHash", () => {
  test("4: facts stay outside the hash in tail mode; other inputs differ", () => {
    const a = computePromptEnvHash("en", ["User likes espresso"], true);
    const b = computePromptEnvHash("en", ["User likes espresso"], true);
    expect(a).toBe(b);

    // Facts ride the user tail and do not invalidate the stable prefix.
    expect(computePromptEnvHash("en", ["A"], true)).toBe(
      computePromptEnvHash("en", ["B"], true),
    );
    expect(computePromptEnvHash("en", [], true)).toBe(
      computePromptEnvHash("en", ["something"], true),
    );
    // null/undefined facts join to "" — same as [].
    expect(computePromptEnvHash("en", null, true)).toBe(
      computePromptEnvHash("en", undefined, true),
    );
    expect(computePromptEnvHash("en", null, true)).toBe(
      computePromptEnvHash("en", [], true),
    );

    // hasTools is a real input (was hardcoded true before the hash fix).
    // AppShell load and streamAssistantTurn save both use promptEnvToolHashFields
    // so toolChoiceMode none hashes as hasTools false / empty names.
    expect(computePromptEnvHash("en", [], true)).not.toBe(
      computePromptEnvHash("en", [], false),
    );

    // Locale still matters.
    expect(computePromptEnvHash("en", [], true)).not.toBe(
      computePromptEnvHash("it", [], true),
    );

    // Tool *set* is hashed (sorted): Web on vs off is not the same stem when
    // document_chat keeps hasTools true. Order of names must not matter.
    expect(
      computePromptEnvHash("en", [], true, ["document_chat", "web_search"]),
    ).toBe(
      computePromptEnvHash("en", [], true, ["web_search", "document_chat"]),
    );
    expect(
      computePromptEnvHash("en", [], true, ["document_chat"]),
    ).not.toBe(
      computePromptEnvHash("en", [], true, ["document_chat", "web_search"]),
    );
    expect(computePromptEnvHash("en", [], true, [], "none")).not.toBe(
      computePromptEnvHash("en", [], true, [], "user-note"),
    );

    // Sanity: the static system prompt itself switches on hasTools (hash tracks that).
    expect(getStrings("en").systemPromptWithSearch).not.toBe(getStrings("en").systemPrompt);
  });
});
