import { BASE, LINK_KEY, envWith, send, standardObjects } from "./fakes";

const env = () => envWith(standardObjects());

describe("keyed routes", () => {
  test("/download/<key> and /download/<key>/ serve the page", async () => {
    for (const path of [BASE, `${BASE}/`]) {
      const res = await send(env(), path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    }
  });

  test("the installer routes answer under the key", async () => {
    expect((await send(env(), `${BASE}/windows`)).status).toBe(302);
    expect((await send(env(), `${BASE}/mac`)).status).toBe(302);
  });
});

describe("methods on a keyed path", () => {
  test.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("%s on the page → 405 with Allow", async (method) => {
    const res = await send(env(), BASE, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("POST on an installer route → 405, even with no manifest", async () => {
    for (const path of [`${BASE}/windows`, `${BASE}/mac`]) {
      const res = await send(envWith({}), path, { method: "POST" });
      expect(res.status).toBe(405);
    }
  });

  test("a wrong key with POST is the same 404 as a wrong key with GET, not a 405", async () => {
    const wrong = `/download/${"x".repeat(LINK_KEY.length)}`;
    expect((await send(env(), wrong, { method: "POST" })).status).toBe(404);
    expect((await send(env(), wrong)).status).toBe(404);
  });
});

describe("host", () => {
  test("a foreign host is 404 even on the keyed path", async () => {
    expect((await send(env(), BASE, {}, "example.com")).status).toBe(404);
  });
});
