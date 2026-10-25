import {
  MAC_UPDATE,
  UPDATE_BASE,
  UPDATE_KEY,
  VERSION,
  WIN,
  brokenBucket,
  entryFor,
  envWith,
  manifestJson,
  manifestWithUpdates,
  send,
  standardObjects,
  updateEntry,
} from "./fakes";

const artifactObjects = (manifest = manifestWithUpdates()) =>
  standardObjects({ "current.json": manifest, [MAC_UPDATE.key]: MAC_UPDATE.bytes });
const check = (target: string, arch: string, current: string, init: RequestInit = {}) =>
  send(envWith(artifactObjects()), `${UPDATE_BASE}/${target}/${arch}/${current}`, init);

describe("update check answers 200 when something newer exists", () => {
  test("mac: version, artifact URL and signature, nothing else", async () => {
    const res = await check("darwin", "aarch64", "0.0.0");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["signature", "url", "version"]);
    expect(body.version).toBe(VERSION);
    expect(body.url).toBe(`https://kalsa.io/download/update/${UPDATE_KEY}/artifact/mac`);
    expect(body.signature).toBe(updateEntry(MAC_UPDATE).signature);
  });

  test("windows: the Windows update's own URL and signature", async () => {
    const body = await (await check("windows", "x86_64", "0.0.0")).json();
    expect(body.url).toBe(`https://kalsa.io/download/update/${UPDATE_KEY}/artifact/windows`);
    expect(body.signature).toBe(updateEntry(WIN).signature);
  });

  test("HEAD returns the same status and headers with no body", async () => {
    const res = await check("darwin", "aarch64", "0.0.0", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("the notes are included when the manifest has them", async () => {
    const env = envWith(artifactObjects(manifestWithUpdates({ notes: "Fixed the calculator." })));
    const body = await (await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`)).json();
    expect(Object.keys(body).sort()).toEqual(["notes", "signature", "url", "version"]);
    expect(body.notes).toBe("Fixed the calculator.");
  });

  test("bad notes are left out, and the update is still offered", async () => {
    const env = envWith(artifactObjects(manifestWithUpdates({ notes: "bad\u0007notes" })));
    const res = await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["signature", "url", "version"]);
  });
});

describe("update check answers 204 when nothing newer is offered", () => {
  test.each([
    ["the same version", "darwin", "aarch64", VERSION],
    ["a newer current version", "darwin", "aarch64", "0.0.2"],
    ["a malformed current version", "darwin", "aarch64", "0.0"],
    ["a current version that is not a version", "darwin", "aarch64", "abc"],
    ["an unknown target", "linux", "aarch64", "0.0.0"],
    ["an unknown architecture for mac", "darwin", "x86_64", "0.0.0"],
    ["an unknown architecture for windows", "windows", "aarch64", "0.0.0"],
  ])("%s", async (_label, target, arch, current) => {
    const res = await check(target, arch, current);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a manifest without a version offers nothing", async () => {
    const objects = standardObjects({ "current.json": manifestWithUpdates({ version: undefined }) });
    expect((await send(envWith(objects), `${UPDATE_BASE}/darwin/aarch64/0.0.0`)).status).toBe(204);
  });

  test("an old manifest without updates offers nothing, and its installers still work", async () => {
    const objects = standardObjects({ "current.json": manifestJson() });
    const env = envWith(objects);
    expect((await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`)).status).toBe(204);
    expect((await send(env, `${UPDATE_BASE}/artifact/mac`)).status).toBe(404);
  });

  test("a platform without an update entry offers nothing", async () => {
    const env = envWith(artifactObjects(manifestWithUpdates({ macUpdate: undefined })));
    expect((await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`)).status).toBe(204);
    expect((await send(env, `${UPDATE_BASE}/windows/x86_64/0.0.0`)).status).toBe(200);
  });

  test("POST is refused on the check with the right key", async () => {
    expect((await check("darwin", "aarch64", "0.0.0", { method: "POST" })).status).toBe(405);
  });
});

describe("artifact route streams the update file", () => {
  test("GET: the bytes, the download headers and private no-store", async () => {
    const res = await send(envWith(artifactObjects()), `${UPDATE_BASE}/artifact/mac`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MAC_UPDATE.bytes);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${MAC_UPDATE.name}"`);
    expect(res.headers.get("etag")).toBe(`"${entryFor(MAC_UPDATE).sha256}"`);
  });

  test("the updater is never redirected, with or without a query", async () => {
    const env = envWith(artifactObjects());
    expect((await send(env, `${UPDATE_BASE}/artifact/mac`)).status).toBe(200);
    expect((await send(env, `${UPDATE_BASE}/artifact/mac?v=${"0".repeat(64)}`)).status).toBe(200);
  });

  test("the Windows artifact is the installer's own bytes", async () => {
    const res = await send(envWith(artifactObjects()), `${UPDATE_BASE}/artifact/windows`);
    expect(await res.text()).toBe(WIN.bytes);
  });

  test("HEAD: headers and no body", async () => {
    const res = await send(envWith(artifactObjects()), `${UPDATE_BASE}/artifact/mac`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(MAC_UPDATE.bytes)));
    expect(await res.text()).toBe("");
  });

  test("If-None-Match with the current hash answers 304, still private no-store", async () => {
    const etag = `"${entryFor(MAC_UPDATE).sha256}"`;
    const res = await send(envWith(artifactObjects()), `${UPDATE_BASE}/artifact/mac`, {
      headers: { "if-none-match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("no update entry for the platform → 404", async () => {
    const env = envWith(artifactObjects(manifestWithUpdates({ macUpdate: undefined })));
    expect((await send(env, `${UPDATE_BASE}/artifact/mac`)).status).toBe(404);
  });

  test("the artifact object missing from the bucket → 404", async () => {
    const objects = artifactObjects();
    delete objects[MAC_UPDATE.key];
    expect((await send(envWith(objects), `${UPDATE_BASE}/artifact/mac`)).status).toBe(404);
  });

  test("a size that differs from the manifest → 503, no bytes", async () => {
    const wrongSize = { ...updateEntry(MAC_UPDATE), size: 9 };
    const res = await send(envWith(artifactObjects(manifestWithUpdates({ macUpdate: wrongSize }))), `${UPDATE_BASE}/artifact/mac`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("R2 reports a sha256 that differs from the manifest → 503", async () => {
    const env = envWith(artifactObjects(), { checksums: { [MAC_UPDATE.key]: "e".repeat(64) } });
    expect((await send(env, `${UPDATE_BASE}/artifact/mac`)).status).toBe(503);
  });
});

describe("the update routes carry the link headers on every status", () => {
  test("200, 204, 304, 404, 405 and 503", async () => {
    const env = envWith(artifactObjects());
    const responses = [
      await send(env, `${UPDATE_BASE}/darwin/aarch64/0.0.0`),
      await check("linux", "aarch64", "0.0.0"),
      await send(env, `${UPDATE_BASE}/artifact/mac`, { headers: { "if-none-match": `"${entryFor(MAC_UPDATE).sha256}"` } }),
      await send(env, `${UPDATE_BASE}/artifact/linux`),
      await send(env, `${UPDATE_BASE}/artifact/mac`, { method: "POST" }),
      await send({ DOWNLOADS: brokenBucket(), UPDATE_KEY }, `${UPDATE_BASE}/darwin/aarch64/0.0.0`),
    ];
    for (const res of responses) {
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});
