/**
 * Conversation-count budget ↔ disk bytes (§7.25: ~5.2 kB/token, ~41 MB/chat).
 */

import {
  DEFAULT_SESSION_POOL_CONVERSATIONS,
  KV_BYTES_PER_CONVERSATION,
  parseSessionPoolConversations,
  sessionPoolBudgetBytes,
} from "./sessionBudget";

describe("sessionPoolBudgetBytes", () => {
  test("default 7 chats is ~300 MB", () => {
    expect(DEFAULT_SESSION_POOL_CONVERSATIONS).toBe(7);
    const bytes = sessionPoolBudgetBytes(7);
    expect(bytes).toBe(7 * KV_BYTES_PER_CONVERSATION);
    // 7 × 8192 × 5200 = 298_188_800 ≈ 284 MiB / ~300 MB as documented.
    expect(bytes).toBe(298_188_800);
  });

  test("1 chat uses one loaded-context artefact", () => {
    expect(sessionPoolBudgetBytes(1)).toBe(KV_BYTES_PER_CONVERSATION);
  });
});

describe("parseSessionPoolConversations", () => {
  test("accepts picker values and rejects junk", () => {
    expect(parseSessionPoolConversations("1")).toBe(1);
    expect(parseSessionPoolConversations("3")).toBe(3);
    expect(parseSessionPoolConversations("7")).toBe(7);
    expect(parseSessionPoolConversations("15")).toBe(15);
    expect(parseSessionPoolConversations(null)).toBe(7);
    expect(parseSessionPoolConversations("")).toBe(7);
    expect(parseSessionPoolConversations("2")).toBe(7);
    expect(parseSessionPoolConversations("nope")).toBe(7);
  });
});
