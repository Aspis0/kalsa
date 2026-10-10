import { MIN_KEY_LENGTH, installerPath, keyMatches, linkBase, parseLinkPath } from "./link";

const KEY = "a".repeat(MIN_KEY_LENGTH);

describe("link paths", () => {
  test("a keyed page path, with or without its trailing slash", () => {
    expect(parseLinkPath(`/download/${KEY}`)).toEqual({ kind: "page", key: KEY });
    expect(parseLinkPath(`/download/${KEY}/`)).toEqual({ kind: "page", key: KEY });
  });

  test("the two keyed installer paths", () => {
    expect(parseLinkPath(`/download/${KEY}/windows`)).toEqual({ kind: "installer", key: KEY, platform: "windows" });
    expect(parseLinkPath(`/download/${KEY}/mac`)).toEqual({ kind: "installer", key: KEY, platform: "mac" });
  });

  test("an unkeyed installer path parses as a page under the key 'windows', which the key check rejects", () => {
    expect(parseLinkPath("/download/windows")).toEqual({ kind: "page", key: "windows" });
    expect(parseLinkPath("/download/mac")).toEqual({ kind: "page", key: "mac" });
  });

  test.each([
    ["the unkeyed page", "/download"],
    ["the unkeyed page with a slash", "/download/"],
    ["an installer with a trailing slash", `/download/${KEY}/windows/`],
    ["an unknown platform", `/download/${KEY}/linux`],
    ["extra segments", `/download/${KEY}/windows/extra`],
    ["an empty key", "/download//windows"],
    ["another prefix", `/downloads/${KEY}`],
    ["no download segment", `/${KEY}`],
    ["the root", "/"],
  ])("%s is not a link path", (_label, pathname) => {
    expect(parseLinkPath(pathname)).toBeNull();
  });

  test("links are built from the key alone", () => {
    expect(linkBase(KEY)).toBe(`/download/${KEY}`);
    expect(installerPath(KEY, "mac")).toBe(`/download/${KEY}/mac`);
  });
});

describe("key comparison", () => {
  test("the exact key matches", async () => {
    expect(await keyMatches(KEY, KEY)).toBe(true);
  });

  test.each([
    ["a same-length wrong key", "b".repeat(MIN_KEY_LENGTH)],
    ["a longer key", `${KEY}a`],
    ["a prefix of the key", KEY.slice(0, -1)],
    ["an empty candidate", ""],
    ["a candidate differing in one character", `${"a".repeat(MIN_KEY_LENGTH - 1)}b`],
  ])("%s does not match", async (_label, candidate) => {
    expect(await keyMatches(KEY, candidate)).toBe(false);
  });

  test("no key configured matches nothing", async () => {
    expect(await keyMatches(undefined, "")).toBe(false);
    expect(await keyMatches(undefined, KEY)).toBe(false);
  });

  test("a key shorter than the minimum matches nothing, even as itself", async () => {
    const short = "a".repeat(MIN_KEY_LENGTH - 1);
    expect(await keyMatches(short, short)).toBe(false);
  });

  test("a key with characters outside the URL-safe set matches nothing, even as itself", async () => {
    for (const bad of ["a".repeat(31) + "/", "a".repeat(31) + "+", "a".repeat(31) + "=", "a".repeat(31) + " "]) {
      expect(await keyMatches(bad, bad)).toBe(false);
    }
  });
});
