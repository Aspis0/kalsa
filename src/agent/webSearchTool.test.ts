/**
 * The 500-character query cap must hold whatever type the model sent: the
 * fallback tool-call parser can return an array for `query`.
 */
jest.mock("../search", () => ({
  searchWeb: jest.fn(),
  normalizeNumResults: jest.fn(),
  buildWebSearchSnippet: jest.fn(),
  PROVIDERS: {},
  NO_PREVIEW_SNIPPET: "",
}));

import { clipWebSearchArgs } from "./webSearchTool";

describe("clipWebSearchArgs", () => {
  test("cuts a string query longer than 500 characters", () => {
    const out = clipWebSearchArgs({ query: "a".repeat(800) });
    expect(out.query).toBe("a".repeat(500));
  });

  test("cuts an array query whose stringified form is longer than 500 characters", () => {
    const out = clipWebSearchArgs({ query: Array.from({ length: 300 }, () => "ab") });
    expect(typeof out.query).toBe("string");
    expect((out.query as string).length).toBe(500);
  });

  test("turns a number query into a string", () => {
    expect(clipWebSearchArgs({ query: 12345 }).query).toBe("12345");
  });

  test("turns a missing query into an empty string", () => {
    expect(clipWebSearchArgs({}).query).toBe("");
  });

  test("leaves a short query unchanged and keeps the other arguments", () => {
    expect(clipWebSearchArgs({ query: "Samsung news today", numResults: 4 })).toEqual({
      query: "Samsung news today",
      numResults: 4,
    });
  });
});
