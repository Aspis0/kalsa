/**
 * The platform rule of the KV pair. On iOS both paths — the unset default and
 * an explicit Standard — land on q8_0/q8_0, because mixed K/V types leave
 * Metal's fast path (that measurement, on a Mac, is in kvCacheProfile.ts). Off
 * iOS the resolution is the one the catalog always had: the stored choice, else
 * the catalog's own pair, else the shipped q8_0/q4_0.
 */
const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

import { resolveKvCacheProfile } from "./kvCacheProfile";

/** The catalog's shipped pair, as ModelRegistry carries it. */
const CATALOG = { k: "q8_0", v: "q4_0" } as const;

describe("resolveKvCacheProfile", () => {
  test("iOS: unset and Standard both load q8_0/q8_0", () => {
    mockPlatform.OS = "ios";
    expect(resolveKvCacheProfile(null, CATALOG)).toEqual({ k: "q8_0", v: "q8_0" });
    // Standard is the stored id whose catalog pair is q8_0/q4_0: on iOS it is
    // the same request as the unset default, so the mixed pair is unreachable.
    expect(resolveKvCacheProfile(CATALOG, CATALOG)).toEqual({ k: "q8_0", v: "q8_0" });
    expect(resolveKvCacheProfile({ k: "q8_0", v: "q8_0" }, CATALOG)).toEqual({
      k: "q8_0",
      v: "q8_0",
    });
  });

  test("Android: the stored choice, else the catalog pair, byte-identical", () => {
    mockPlatform.OS = "android";
    expect(resolveKvCacheProfile(null, CATALOG)).toEqual({ k: "q8_0", v: "q4_0" });
    expect(resolveKvCacheProfile(null, null)).toEqual({ k: "q8_0", v: "q4_0" });
    expect(resolveKvCacheProfile({ k: "q8_0", v: "q8_0" }, CATALOG)).toEqual({
      k: "q8_0",
      v: "q8_0",
    });
  });
});
