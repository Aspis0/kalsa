import { MAC, WIN, entryFor, envWith, manifestJson, send, standardObjects } from "./fakes";

const winSha = entryFor(WIN).sha256;
const macSha = entryFor(MAC).sha256;

describe("installer GET streams the object the manifest names", () => {
  test("windows: bytes and the download headers", async () => {
    const res = await send(envWith(standardObjects()), `/download/windows?v=${winSha}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(WIN.bytes);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(WIN.bytes)));
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${WIN.name}"`);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("etag")).toBe(`"${winSha}"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("the file is revalidated on every use, never cached as immutable", async () => {
    const res = await send(envWith(standardObjects()), `/download/windows?v=${winSha}`);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("mac streams the mac installer under its own name", async () => {
    const res = await send(envWith(standardObjects()), `/download/mac?v=${macSha}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MAC.bytes);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${MAC.name}"`);
  });

  test("If-None-Match with the current sha answers 304 without a body", async () => {
    const res = await send(envWith(standardObjects()), `/download/windows?v=${winSha}`, {
      headers: { "if-none-match": `"${winSha}"` },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(`"${winSha}"`);
    expect(await res.text()).toBe("");
  });
});

describe("installer URL without the current version", () => {
  test("no ?v= redirects to the versioned URL, never cached", async () => {
    const res = await send(envWith(standardObjects()), "/download/windows");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/download/windows?v=${winSha}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a superseded ?v= redirects to the current version", async () => {
    const res = await send(envWith(standardObjects()), `/download/mac?v=${"0".repeat(64)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/download/mac?v=${macSha}`);
  });
});

describe("installer HEAD", () => {
  test("versioned HEAD returns the headers and no body", async () => {
    const res = await send(envWith(standardObjects()), `/download/windows?v=${winSha}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(WIN.bytes)));
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${WIN.name}"`);
    expect(await res.text()).toBe("");
  });

  test("unversioned HEAD redirects like GET does", async () => {
    const res = await send(envWith(standardObjects()), "/download/mac", { method: "HEAD" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/download/mac?v=${macSha}`);
  });
});

describe("bytes must match the manifest", () => {
  test("R2 reports a sha256 that differs from the manifest → 503, no bytes", async () => {
    const env = envWith(standardObjects(), { checksums: { [WIN.key]: "f".repeat(64) } });
    const res = await send(env, `/download/windows?v=${winSha}`);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).not.toContain(WIN.bytes);
  });

  test("R2 reports a matching sha256 → served", async () => {
    const env = envWith(standardObjects(), { checksums: { [WIN.key]: winSha } });
    const res = await send(env, `/download/windows?v=${winSha}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(WIN.bytes);
  });

  test("the object size differs from the manifest size → 503", async () => {
    const objects = standardObjects({ "current.json": manifestJson({ windows: { ...entryFor(WIN), size: 999_999 } }) });
    const res = await send(envWith(objects), `/download/windows?v=${winSha}`);
    expect(res.status).toBe(503);
  });

  test("a checksum mismatch is refused on HEAD too", async () => {
    const env = envWith(standardObjects(), { checksums: { [WIN.key]: "e".repeat(64) } });
    const res = await send(env, `/download/windows?v=${winSha}`, { method: "HEAD" });
    expect(res.status).toBe(503);
  });

  test("no checksum on the object → served on the size check alone", async () => {
    const res = await send(envWith(standardObjects()), `/download/windows?v=${winSha}`);
    expect(res.status).toBe(200);
  });
});

describe("installer missing", () => {
  test("the manifest names a key the bucket does not hold → 404", async () => {
    const objects = standardObjects();
    delete objects[WIN.key];
    const res = await send(envWith(objects), `/download/windows?v=${winSha}`);
    expect(res.status).toBe(404);
  });

  test("no manifest → both installer routes 404, with or without ?v=", async () => {
    const objects = { [WIN.key]: WIN.bytes, [MAC.key]: MAC.bytes };
    for (const path of [`/download/windows?v=${winSha}`, "/download/mac", `/download/mac?v=${macSha}`]) {
      expect((await send(envWith(objects), path)).status).toBe(404);
    }
  });

  test("a manifest entry that fails validation → 404 for that platform", async () => {
    const objects = standardObjects({ "current.json": manifestJson({ mac: { ...entryFor(MAC), size: 0 } }) });
    expect((await send(envWith(objects), `/download/mac?v=${macSha}`)).status).toBe(404);
    expect((await send(envWith(objects), `/download/windows?v=${winSha}`)).status).toBe(200);
  });
});
