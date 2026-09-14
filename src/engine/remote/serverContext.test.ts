import { parseServerContext } from "./serverContext";

describe("parseServerContext", () => {
  test("reads llama.cpp's /props, top level or nested", () => {
    expect(parseServerContext({ n_ctx: 8192 })).toBe(8192);
    expect(parseServerContext({ default_generation_settings: { n_ctx: 4096 } })).toBe(
      4096,
    );
    // Nested wins when both exist: it is the setting actually in use.
    expect(
      parseServerContext({ n_ctx: 32768, default_generation_settings: { n_ctx: 8192 } }),
    ).toBe(8192);
  });

  test("anything else is unknown, not a guess", () => {
    expect(parseServerContext(null)).toBeNull();
    expect(parseServerContext("n_ctx: 8192")).toBeNull();
    expect(parseServerContext({})).toBeNull();
    expect(parseServerContext({ n_ctx: 0 })).toBeNull();
    expect(parseServerContext({ n_ctx: -1 })).toBeNull();
    expect(parseServerContext({ n_ctx: "8192" })).toBeNull();
    expect(parseServerContext({ default_generation_settings: null })).toBeNull();
    expect(parseServerContext({ models: [{ id: "x" }] })).toBeNull();
  });
});
