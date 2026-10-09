/**
 * Shape-only guard (LlamaService imports llama.rn, so Jest cannot reach the
 * load call): the governorLoad condition must carry the platform check itself.
 * On iOS readGovernorThermo's bench path (kalsa.bench.thermo) satisfies the
 * sensor gate with no battery read, so the fallbacks' guard is not enough.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("governor load platform scope", () => {
  test("the governorLoad condition opens with the Android-only guard", () => {
    const at = source.indexOf("const governorLoad =");
    expect(at).toBeGreaterThan(-1);
    const end = source.indexOf("?", at);
    expect(end).toBeGreaterThan(at);
    expect(source.slice(at, end)).toMatch(
      /const governorLoad =\s*Platform\.OS === "android" &&/,
    );
  });
});
