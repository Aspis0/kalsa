/**
 * Shape-only guard: LlamaService imports llama.rn, so Jest cannot reach its
 * init call. With the governor ON by default, the "enabled but not loaded ->
 * CPU-only" fallback must stay Android-only, or every iOS load drops Metal.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("governor CPU-only fallback scope", () => {
  test("zeroes n_gpu_layers only on Android", () => {
    const zeroing = source.indexOf("params.n_gpu_layers = 0;");
    const guard = source.lastIndexOf("if (", zeroing);

    expect(zeroing).toBeGreaterThan(-1);
    expect(source.slice(guard, zeroing)).toMatch(
      /^if \(Platform\.OS === "android" && governorFeatureEnabled && !governorLoad\) \{\s*$/,
    );
  });
});
