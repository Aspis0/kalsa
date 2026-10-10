import { BASE, LINK_KEY, UPDATE_BASE, UPDATE_KEY, envWith, send, standardObjects } from "./fakes";
import { admit, type Secrets } from "./admission";

const wrongKey = "z".repeat(LINK_KEY.length);
const secrets: Secrets = { LINK_KEY, UPDATE_KEY };
const digest = () => jest.spyOn(crypto.subtle, "digest");

afterEach(() => jest.restoreAllMocks());

describe("every request runs the same key comparison", () => {
  const cases: [string, string, Secrets][] = [
    ["an unknown path", "https://kalsa.io/nope", secrets],
    ["a wrong link key", `https://kalsa.io/download/${wrongKey}`, secrets],
    ["a plaintext right link key", `http://kalsa.io${BASE}`, secrets],
    ["a foreign host right link key", `https://example.com${BASE}`, secrets],
    ["a short link secret", `https://kalsa.io${BASE}`, { ...secrets, LINK_KEY: "a".repeat(31) }],
    ["no link secret", `https://kalsa.io${BASE}`, { UPDATE_KEY }],
    ["an admitted page", `https://kalsa.io${BASE}`, secrets],
    ["an admitted installer", `https://kalsa.io${BASE}/mac`, secrets],
    ["a wrong update key", `https://kalsa.io/download/update/${wrongKey}/darwin/aarch64/0.0.0`, secrets],
    ["a plaintext right update key", `http://kalsa.io${UPDATE_BASE}/artifact/mac`, secrets],
    ["no update secret", `https://kalsa.io${UPDATE_BASE}/artifact/mac`, { LINK_KEY }],
    ["an admitted update check", `https://kalsa.io${UPDATE_BASE}/darwin/aarch64/0.0.0`, secrets],
    ["an admitted artifact", `https://kalsa.io${UPDATE_BASE}/artifact/windows`, secrets],
  ];

  test.each(cases)("%s does exactly two digests", async (_label, url, given) => {
    const spy = digest();
    await admit(url, given);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("hashing that fails before the key matches answers the same 404", () => {
  test("a wrong key, and the right keys too, are the unkeyed 404 when digest throws", async () => {
    const env = envWith(standardObjects());
    const reference = await send(env, "/download/windows");
    const expected = { status: reference.status, body: await reference.text() };
    jest.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("hash unavailable"));
    for (const path of [`/download/${wrongKey}`, BASE, `${UPDATE_BASE}/artifact/mac`]) {
      const res = await send(env, path);
      expect({ status: res.status, body: await res.text() }).toEqual(expected);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});
