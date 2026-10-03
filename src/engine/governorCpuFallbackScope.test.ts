/**
 * Shape-only guard: LlamaService imports llama.rn, so Jest cannot reach its
 * init call. With the governor ON by default, every "enabled but not loaded ->
 * CPU-only" fallback must stay Android-only, or every iOS load drops Metal.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

const ZEROING = "params.n_gpu_layers = 0;";
const GOVERNOR_FALLBACK =
  /^if \(Platform\.OS === "android" && governorFeatureEnabled && !governorLoad\) \{$/;
// The GPU-init-failure retry zeroes layers under its own Android-only guard.
const ANDROID_ONLY = /^if \(.*Platform\.OS === "android".*\) \{$/;

/** Start indices of every zeroing in the source, not just the first. */
function zeroingSites(): number[] {
  const sites: number[] = [];
  for (let i = source.indexOf(ZEROING); i > -1; ) {
    sites.push(i);
    i = source.indexOf(ZEROING, i + 1);
  }
  return sites;
}

describe("governor CPU-only fallback scope", () => {
  test("every n_gpu_layers zeroing is Android-guarded", () => {
    const sites = zeroingSites();
    expect(sites.length).toBeGreaterThan(0);

    for (const zeroing of sites) {
      const guard = source.lastIndexOf("if (", zeroing);
      const header = source.slice(guard, source.indexOf("{", guard) + 1);
      const expected = header.includes("governorFeatureEnabled")
        ? GOVERNOR_FALLBACK
        : ANDROID_ONLY;
      // Object names the offending copy by byte offset on failure.
      expect({ zeroing, guarded: expected.test(header) }).toEqual({
        zeroing,
        guarded: true,
      });
    }
  });
});
