import {
  clipChars,
  filterConversations,
  SEARCH_BLOB_CAP,
  searchBlobFromMessages,
} from "./ConversationsStore";
import { filterByTokens, tokensFromQuery } from "../util/filterByTokens";

describe("chat search pure functions", () => {
  it("filters with case-insensitive AND tokens and keeps short tokens with no long token", () => {
    const items = [
      { title: "Local Llama", body: "Fast model" },
      { title: "Search", body: "Remote model" },
      { title: "Local Notes", body: "Draft" },
    ];

    expect(filterByTokens(items, "LOCAL model", (item) => [item.title, item.body])).toEqual([
      items[0],
    ]);
    expect(filterByTokens(items, "lo", (item) => [item.title, item.body])).toEqual([
      items[0],
      items[2],
    ]);
  });

  it("filters conversations by all tokens and recency", () => {
    const items = [
      { id: "old", title: "Model notes", updatedAt: 1, preview: "", searchBlob: "local" },
      { id: "new", title: "Local chat", updatedAt: 3, preview: "", searchBlob: "model" },
      { id: "other", title: "Unrelated", updatedAt: 4, preview: "", searchBlob: "" },
    ];

    expect(filterConversations(items, "local model").map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("normalizes query tokens using the existing short-token rule", () => {
    expect(tokensFromQuery("  A search  ")).toEqual(["search"]);
    expect(tokensFromQuery(" a ")).toEqual(["a"]);
    expect(tokensFromQuery(" ")).toBeNull();
  });

  it("guards clipChars edge cases and clips by code point from either end", () => {
    expect(clipChars("", 5)).toBe("");
    expect(clipChars("abc", 0)).toBe("");
    expect(clipChars("abc", -1)).toBe("");
    expect(clipChars("abc", Number.NaN)).toBe("");
    expect(clipChars("abc", 5)).toBe("abc");
    expect(clipChars("😀abc", 2)).toBe("😀a");
    expect(clipChars("ab😀cd", 3, true)).toBe("😀cd");
  });

  it("handles missing and malformed messages while lowercasing valid text", () => {
    expect(searchBlobFromMessages(null)).toBe("");
    expect(searchBlobFromMessages([])).toBe("");
    expect(
      searchBlobFromMessages([{ text: null }, { text: 42 }, { text: "  Hello World  " }]),
    ).toBe("hello world");
  });

  it("keeps the recent tail of a long search blob", () => {
    const blob = searchBlobFromMessages([
      { text: "early-only-marker" },
      { text: "x".repeat(SEARCH_BLOB_CAP) },
      { text: "recent-only-marker" },
    ]);

    expect(blob).toHaveLength(SEARCH_BLOB_CAP);
    expect(blob).toContain("recent-only-marker");
    expect(blob).not.toContain("early-only-marker");
  });
});
