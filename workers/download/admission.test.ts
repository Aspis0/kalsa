import { BASE, LINK_KEY, envWith, send, standardObjects } from "./fakes";
import { admit } from "./link";

const wrongKey = "z".repeat(LINK_KEY.length);
const digest = () => jest.spyOn(crypto.subtle, "digest");

afterEach(() => jest.restoreAllMocks());

describe("every request runs the same key comparison", () => {
  const cases: [string, string, string | undefined][] = [
    ["an unknown path", "https://kalsa.io/nope", LINK_KEY],
    ["a wrong key", `https://kalsa.io/download/${wrongKey}`, LINK_KEY],
    ["a plaintext right key", `http://kalsa.io${BASE}`, LINK_KEY],
    ["a foreign host right key", `https://example.com${BASE}`, LINK_KEY],
    ["a short secret", `https://kalsa.io${BASE}`, "a".repeat(31)],
    ["no secret", `https://kalsa.io${BASE}`, undefined],
    ["an admitted page", `https://kalsa.io${BASE}`, LINK_KEY],
    ["an admitted installer", `https://kalsa.io${BASE}/mac`, LINK_KEY],
  ];

  test.each(cases)("%s does exactly two digests", async (_label, url, secret) => {
    const spy = digest();
    await admit(url, secret);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("hashing that fails before the key matches answers the same 404", () => {
  test("a wrong key, and the right key too, are the unkeyed 404 when digest throws", async () => {
    const env = envWith(standardObjects());
    const reference = await send(env, "/download/windows");
    const expected = { status: reference.status, body: await reference.text() };
    jest.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("hash unavailable"));
    for (const path of [`/download/${wrongKey}`, BASE]) {
      const res = await send(env, path);
      expect({ status: res.status, body: await res.text() }).toEqual(expected);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});
