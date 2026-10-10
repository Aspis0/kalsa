import { isNewer, isSemver } from "./semver";

describe("isSemver", () => {
  test.each(["0.0.1", "10.2.3", "1.0.0-rc.1", "1.0.0-alpha.beta", "1.0.0+build.5", "1.0.0-rc.1+b"])(
    "%s is valid",
    (version) => expect(isSemver(version)).toBe(true),
  );

  test.each(["1.0", "v1.0.0", "01.0.0", "1.0.0-", "1.0.0 ", "1.0.0-01", "", "1.0.0/x", 1, null])(
    "%s is refused",
    (version) => expect(isSemver(version)).toBe(false),
  );
});

describe("isNewer", () => {
  test("only a strictly greater version is newer", () => {
    expect(isNewer("0.0.2", "0.0.1")).toBe(true);
    expect(isNewer("0.0.1", "0.0.1")).toBe(false);
    expect(isNewer("0.0.1", "0.0.2")).toBe(false);
  });

  test("the major, minor and patch numbers compare as numbers", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });

  test("a release is newer than its prereleases, which compare by the semver order", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 1; i < chain.length; i++) {
      expect(isNewer(chain[i], chain[i - 1])).toBe(true);
      expect(isNewer(chain[i - 1], chain[i])).toBe(false);
    }
  });

  test("build metadata does not change precedence", () => {
    expect(isNewer("0.0.1+build.9", "0.0.1")).toBe(false);
    expect(isNewer("0.0.1", "0.0.1+build.9")).toBe(false);
  });

  test("an invalid version on either side is never newer", () => {
    expect(isNewer("0.0.2", "not-a-version")).toBe(false);
    expect(isNewer("0.0.2", "")).toBe(false);
    expect(isNewer("bogus", "0.0.1")).toBe(false);
  });
});

describe("large numeric components", () => {
  test("neighbours above the safe-integer limit still order strictly", () => {
    expect(isNewer("9007199254740993.0.0", "9007199254740992.0.0")).toBe(true);
    expect(isNewer("9007199254740992.0.0", "9007199254740993.0.0")).toBe(false);
    expect(isNewer("0.0.9007199254740993", "0.0.9007199254740992")).toBe(true);
    expect(isNewer("1.0.0-9007199254740993", "1.0.0-9007199254740992")).toBe(true);
  });

  test("a component of any length is valid and compares exactly", () => {
    const huge = "9".repeat(40);
    expect(isSemver(`${huge}.0.0`)).toBe(true);
    expect(isNewer(`${huge}.0.1`, `${huge}.0.0`)).toBe(true);
  });

  test("a leading zero is refused in every component", () => {
    expect(isSemver("01.2.3")).toBe(false);
    expect(isSemver("1.02.3")).toBe(false);
    expect(isSemver("1.2.03")).toBe(false);
  });
});
