import {
  BASE,
  LINK_KEY,
  MAC_UPDATE,
  UPDATE_BASE,
  UPDATE_KEY,
  WIN,
  brokenBucket,
  entryFor,
  envWith,
  manifestWithUpdates,
  send,
  standardObjects,
} from "./fakes";

const winSha = entryFor(WIN).sha256;
const env = () => envWith(standardObjects());

/** Everything a client can observe about a response, with headers in a fixed order. */
async function snapshot(res: Response) {
  return {
    status: res.status,
    body: await res.text(),
    headers: [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

/** The 404 an unkeyed request gets, with the same method as the probe. */
async function reference(init: RequestInit = {}) {
  return snapshot(await send(env(), "/download/windows", init));
}

const wrongKey = "z".repeat(LINK_KEY.length);
const probes: [string, string, RequestInit?][] = [
  ["an unkeyed page", "/download"],
  ["an unkeyed page with a slash", "/download/"],
  ["unkeyed installers", "/download/windows"],
  ["unkeyed mac", "/download/mac"],
  ["a wrong key", `/download/${wrongKey}`],
  ["a wrong key on an installer", `/download/${wrongKey}/windows`],
  ["the key as a prefix", `/download/${LINK_KEY.slice(0, -1)}`],
  ["the key with extra characters", `/download/${LINK_KEY}x`],
  ["extra segments after the page", `${BASE}/extra`],
  ["extra segments after an installer", `${BASE}/windows/extra`],
  ["an installer with a trailing slash", `${BASE}/windows/`],
  ["an unknown platform under the key", `${BASE}/linux`],
  ["the root", "/"],
  ["a wrong key with POST", `/download/${wrongKey}`, { method: "POST" }],
  ["a wrong key with HEAD", `/download/${wrongKey}`, { method: "HEAD" }],
  ["a wrong key on an installer with HEAD", `/download/${wrongKey}/windows`, { method: "HEAD" }],
  ["a query string on a wrong key", `/download/${wrongKey}?v=x`],
  ["a percent-encoded slash before the key", `/download%2F${LINK_KEY}`],
  ["a percent-encoded slash before the platform", `${BASE}%2Fwindows`],
  ["a lower-case percent-encoded slash before the platform", `${BASE}%2fwindows`],
  ["a percent-encoded character in the key", `/download/%66${LINK_KEY.slice(1)}`],
  ["a double slash before download", `//download/${LINK_KEY}`],
  ["a double slash before the key", `/download//${LINK_KEY}`],
  ["a double slash before the platform", `${BASE}//windows`],
  ["the download segment in another case", `/Download/${LINK_KEY}`],
  ["the key upper-cased", `/download/${LINK_KEY.toUpperCase()}`],
  ["the platform upper-cased", `${BASE}/WINDOWS`],
  ["a wrong update key on the check", `/download/update/${wrongKey}/darwin/aarch64/0.0.0`],
  ["the link key on the updater", `/download/update/${LINK_KEY}/artifact/mac`],
  ["the update key on the link", `/download/${UPDATE_KEY}/windows`],
  ["the update key on the link page", `/download/${UPDATE_KEY}`],
  ["the update check with a trailing slash", `${UPDATE_BASE}/darwin/aarch64/0.0.0/`],
  ["an artifact for an unknown platform", `${UPDATE_BASE}/artifact/linux`],
  ["the artifact without a platform", `${UPDATE_BASE}/artifact`],
  ["the updater root", UPDATE_BASE],
  ["a wrong update key with HEAD", `/download/update/${wrongKey}/darwin/aarch64/0.0.0`, { method: "HEAD" }],
  ["a wrong update key with POST", `/download/update/${wrongKey}/artifact/mac`, { method: "POST" }],
  ["a query on a wrong update key", `/download/update/${wrongKey}/artifact/mac?v=x`],
  ["a percent-encoded update key", `/download/update/%75${UPDATE_KEY.slice(1)}/artifact/mac`],
  ["a double slash before the updater", `//download/update/${UPDATE_KEY}/artifact/mac`],
  ["the updater in another case", `/download/Update/${UPDATE_KEY}/artifact/mac`],
  ["the update key upper-cased", `/download/update/${UPDATE_KEY.toUpperCase()}/artifact/mac`],
];

describe("everything that is not the link answers the same 404", () => {
  // A third declared parameter would make jest-each wait for a done() callback.
  test.each(probes)("%s", async (_label, path, init: RequestInit = {}) => {
    expect(await snapshot(await send(env(), path, init))).toEqual(await reference(init));
  });

  test("a foreign host with the right key is the same 404", async () => {
    expect(await snapshot(await send(env(), BASE, {}, "example.com"))).toEqual(await reference());
  });

  test("a plaintext request with the right key is the same 404, page and installers", async () => {
    expect(await snapshot(await send(env(), BASE, {}, "kalsa.io", "http"))).toEqual(await reference());
    expect(await snapshot(await send(env(), `${BASE}/windows`, {}, "kalsa.io", "http"))).toEqual(await reference());
  });

  test("a missing LINK_KEY turns the correct path into the same 404", async () => {
    const unset = { ...env(), LINK_KEY: undefined };
    expect(await snapshot(await send(unset, BASE))).toEqual(await reference());
    expect(await snapshot(await send(unset, `${BASE}/windows`))).toEqual(await reference());
  });

  test("a LINK_KEY shorter than 32 characters turns the correct path into the same 404", async () => {
    const short = { ...env(), LINK_KEY: "a".repeat(31) };
    expect(await snapshot(await send(short, `/download/${"a".repeat(31)}`))).toEqual(await reference());
  });
});

describe("the right key opens the page and the installers", () => {
  test("the keyed page, its trailing-slash form and HEAD", async () => {
    expect((await send(env(), BASE)).status).toBe(200);
    expect((await send(env(), `${BASE}/`)).status).toBe(200);
    expect((await send(env(), BASE, { method: "HEAD" })).status).toBe(200);
  });

  test("the keyed installer redirects to its keyed versioned URL", async () => {
    const res = await send(env(), `${BASE}/windows`);
    expect(res.headers.get("location")).toBe(`${BASE}/windows?v=${winSha}`);
  });

  test("the host with a trailing dot is the same host", async () => {
    expect((await send(env(), BASE, {}, "kalsa.io.")).status).toBe(200);
  });
});

describe("privacy headers on every response", () => {
  const privacy = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

  function expectPrivacy(res: Response) {
    for (const [name, value] of Object.entries(privacy)) {
      expect({ name, value: res.headers.get(name) }).toEqual({ name, value });
    }
  }

  test("200, 302, 304, 404 and 405 carry them", async () => {
    expectPrivacy(await send(env(), BASE));
    expectPrivacy(await send(env(), `${BASE}/windows`));
    expectPrivacy(await send(env(), `${BASE}/windows?v=${winSha}`, { headers: { "if-none-match": `"${winSha}"` } }));
    expectPrivacy(await send(env(), "/download"));
    expectPrivacy(await send(env(), BASE, { method: "POST" }));
  });

  test("503 carries them", async () => {
    expectPrivacy(await send({ DOWNLOADS: brokenBucket(), LINK_KEY }, BASE));
  });
});

describe("the two keys are independent", () => {
  const withUpdates = () =>
    standardObjects({ "current.json": manifestWithUpdates(), [MAC_UPDATE.key]: MAC_UPDATE.bytes });

  test("a missing UPDATE_KEY turns the updater into the 404; the tester link keeps working", async () => {
    const env = { ...envWith(withUpdates()), UPDATE_KEY: undefined };
    expect(await snapshot(await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`))).toEqual(await reference());
    expect((await send(env, BASE)).status).toBe(200);
  });

  test("a short UPDATE_KEY turns the updater into the 404", async () => {
    const env = { ...envWith(withUpdates()), UPDATE_KEY: "u".repeat(31) };
    expect(await snapshot(await send(env, `/download/update/${"u".repeat(31)}/artifact/mac`))).toEqual(await reference());
  });

  test("a LINK_KEY of update is refused, so /download/update is never a tester link", async () => {
    const env = { ...envWith(withUpdates()), LINK_KEY: "update" };
    expect(await snapshot(await send(env, "/download/update"))).toEqual(await reference());
    expect((await send(env, `${UPDATE_BASE}/artifact/mac`)).status).toBe(200);
  });
});
