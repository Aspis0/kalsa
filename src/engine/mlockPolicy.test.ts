/**
 * The mlock rule: iOS off (wired pages count against the jetsam footprint),
 * Android on and unchanged (mlock there cannot hold the model, and the
 * measured reclaim behaviour depends on it not doing so).
 */
import { resolveUseMlock } from "./mlockPolicy";

describe("resolveUseMlock", () => {
  it("does not pin on iOS", () => {
    expect(resolveUseMlock("ios")).toBe(false);
  });

  it("keeps the pre-rule answer on Android — mlock stays requested", () => {
    expect(resolveUseMlock("android")).toBe(true);
  });

  it("flips nothing but iOS", () => {
    for (const platform of ["web", "macos", "windows", ""]) {
      expect(resolveUseMlock(platform)).toBe(true);
    }
  });
});
