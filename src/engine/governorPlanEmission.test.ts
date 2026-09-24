/**
 * Shape-only guard: LlamaService imports llama.rn, so Jest cannot reach its
 * init call. This pins the computed-plan and runtime-fallback emission gates.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("governor plan log emission shape", () => {
  test("logs computed plans and suppresses runtime-fallback reloads", () => {
    const marker = source.indexOf("KALSA_GOVERNOR_PLAN ");
    const guardStart = source.lastIndexOf("if (", marker);
    const fallbackStart = source.indexOf(
      "if (governorBase != null && !governorBase.enabled)",
      marker,
    );
    const emission = source.slice(guardStart, fallbackStart);

    expect(marker).toBeGreaterThan(-1);
    expect(emission).toMatch(
      /if \(governorBase != null && pricedModel != null && !governorRuntimeOff\) \{\s*console\.log\(/,
    );
    expect(emission).toContain("governorBase,");
    expect(emission).not.toContain("governorLoad");
  });
});
