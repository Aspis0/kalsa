import { PROMPT_FACT_CHARS } from "../memory/dnaBounding";
import { parseMemoryExtract } from "./memoryExtractParse";

describe("parseMemoryExtract outcomes", () => {
  test("returns outcome 0 for empty or non-string input", () => {
    expect(parseMemoryExtract("")).toEqual({ add: [], remove: [], parseOutcome: 0 });
    expect(parseMemoryExtract(undefined as unknown as string)).toEqual({
      add: [],
      remove: [],
      parseOutcome: 0,
    });
  });

  test("returns outcome 2 when there is no object at all", () => {
    expect(parseMemoryExtract("no json here")).toEqual({ add: [], remove: [], parseOutcome: 2 });
    expect(parseMemoryExtract('["a","b"]')).toEqual({ add: [], remove: [], parseOutcome: 2 });
  });

  test("returns outcome 2 for malformed JSON", () => {
    expect(parseMemoryExtract('{"add": [}')).toEqual({ add: [], remove: [], parseOutcome: 2 });
  });

  test("returns outcome 1 for a valid object with no keys", () => {
    expect(parseMemoryExtract("{}")).toEqual({ add: [], remove: [], parseOutcome: 1 });
  });
});

describe("parseMemoryExtract extraction", () => {
  test("drops a think block before the first object is scanned", () => {
    const raw = '<think>draft {"add":["wrong"]}</think>{"add":["right"],"remove":[]}';
    expect(parseMemoryExtract(raw)).toEqual({ add: ["right"], remove: [], parseOutcome: 1 });
  });

  test("drops fence markers that sit inside the braces", () => {
    const raw = '{"add":["kept"],```json\n"remove":["gone"]```}';
    expect(parseMemoryExtract(raw)).toEqual({
      add: ["kept"],
      remove: ["gone"],
      parseOutcome: 1,
    });
  });

  test("takes only the first object and fails closed when it is malformed", () => {
    const raw = '{"add": [oops]} {"add":["x"]}';
    expect(parseMemoryExtract(raw)).toEqual({ add: [], remove: [], parseOutcome: 2 });
  });

  test("keeps braces and escaped quotes inside a JSON string from closing the object", () => {
    const raw = '{"add":["use } and { in text", "say \\"hi }\\" now"],"remove":[]}';
    expect(parseMemoryExtract(raw)).toEqual({
      add: ["use } and { in text", 'say "hi }" now'],
      remove: [],
      parseOutcome: 1,
    });
  });

  test("ignores trailing prose after the first balanced object", () => {
    const raw = 'Here you go: {"add":["a"],"remove":["b"]} hope this helps {oops';
    expect(parseMemoryExtract(raw)).toEqual({ add: ["a"], remove: ["b"], parseOutcome: 1 });
  });

  test("caps add at 3 items, each at PROMPT_FACT_CHARS, with whitespace collapsed", () => {
    const raw = JSON.stringify({
      add: ["  one\n\n two  ", "x".repeat(200), "three", "four"],
    });
    expect(parseMemoryExtract(raw).add).toEqual(["one two", "x".repeat(PROMPT_FACT_CHARS), "three"]);
  });

  test("caps remove at 10 items and collapses whitespace in each", () => {
    const remove = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
    remove[0] = "  spaced   out ";
    const parsed = parseMemoryExtract(JSON.stringify({ remove }));
    expect(parsed.remove).toHaveLength(10);
    expect(parsed.remove[0]).toBe("spaced out");
  });

  test("filters non-string and empty items out of add and remove", () => {
    const raw = JSON.stringify({
      add: [1, null, "keep", { x: 1 }, "   "],
      remove: [null, "gone", 3, ""],
    });
    expect(parseMemoryExtract(raw)).toEqual({
      add: ["keep"],
      remove: ["gone"],
      parseOutcome: 1,
    });
  });
});
