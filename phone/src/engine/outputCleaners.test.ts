import { cleanTranslationOutput, stripThinkAndFences } from "./outputCleaners";

describe("stripThinkAndFences", () => {
  test("returns an empty string for empty or non-string input", () => {
    expect(stripThinkAndFences("")).toBe("");
    expect(stripThinkAndFences(undefined as unknown as string)).toBe("");
  });

  test("returns an empty string for truthy non-string input", () => {
    expect(stripThinkAndFences(123 as unknown as string)).toBe("");
    expect(stripThinkAndFences({} as unknown as string)).toBe("");
  });

  test("removes closed, unclosed and stray think tags", () => {
    expect(stripThinkAndFences("<think>plan first</think>Answer")).toBe("Answer");
    expect(stripThinkAndFences("Answer<think>still thinking")).toBe("Answer");
    expect(stripThinkAndFences("Answer</think>")).toBe("Answer");
  });

  test("matches think tags case-insensitively", () => {
    expect(stripThinkAndFences("<THINK>plan</Think>Answer")).toBe("Answer");
    expect(stripThinkAndFences("Answer<Think>still thinking")).toBe("Answer");
  });

  test("unwraps a fence only when it wraps the whole output", () => {
    expect(stripThinkAndFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripThinkAndFences("Use ```x``` here")).toBe("Use ```x``` here");
  });
});

describe("cleanTranslationOutput", () => {
  test("strips think blocks and a whole-output fence", () => {
    expect(cleanTranslationOutput("<think>hmm</think>Ciao mondo")).toBe("Ciao mondo");
    expect(cleanTranslationOutput("```\nCiao mondo\n```")).toBe("Ciao mondo");
    expect(cleanTranslationOutput("Use ```x``` here")).toBe("Use ```x``` here");
  });

  test("drops a known preamble line and the blank lines after it", () => {
    expect(cleanTranslationOutput("Here is the translation:\n\nCiao mondo")).toBe("Ciao mondo");
    expect(cleanTranslationOutput("Traduzione:\nRiga 1\nRiga 2")).toBe("Riga 1\nRiga 2");
  });

  test("drops a preamble whose colon sits on the next line", () => {
    expect(cleanTranslationOutput("Translation\n: Ciao")).toBe("Ciao");
  });

  test("keeps wrapping quotes", () => {
    expect(cleanTranslationOutput('"Ciao mondo"')).toBe('"Ciao mondo"');
  });
});
