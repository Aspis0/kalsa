import { MIN_KEY_LENGTH, keyMatches } from "./keys";

const KEY = "a".repeat(MIN_KEY_LENGTH);

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
