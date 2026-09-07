import { highlightMatches } from "./highlightMatches";

describe("highlightMatches", () => {
  it("merges overlapping token matches", () => {
    expect(highlightMatches("abcd", ["abc", "bcd"])).toEqual([
      { text: "abcd", highlighted: true },
    ]);
  });

  it("preserves the original case in highlighted text", () => {
    expect(highlightMatches("HeLLo World", ["hello", "world"])).toEqual([
      { text: "HeLLo", highlighted: true },
      { text: " ", highlighted: false },
      { text: "World", highlighted: true },
    ]);
  });

  it("returns plain text for empty tokens", () => {
    expect(highlightMatches("Hello", [])).toEqual([
      { text: "Hello", highlighted: false },
    ]);
  });
});
