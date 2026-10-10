import { envWith, send, standardObjects } from "./fakes";

const env = () => envWith(standardObjects());

describe("routes", () => {
  test("/download and /download/ serve the page", async () => {
    for (const path of ["/download", "/download/"]) {
      const res = await send(env(), path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    }
  });

  test("any other path is 404, including near misses of the routed ones", async () => {
    for (const path of ["/downloads", "/download/linux", "/download/windows/extra", "/download/windows/", "/"]) {
      const res = await send(env(), path);
      expect(res.status).toBe(404);
    }
  });

  test("a foreign host is 404 even on our paths", async () => {
    expect((await send(env(), "/download", {}, "example.com")).status).toBe(404);
  });
});

describe("methods", () => {
  test.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("%s on the page → 405 with Allow", async (method) => {
    const res = await send(env(), "/download", { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("POST on an installer route → 405, even with no manifest", async () => {
    for (const path of ["/download/windows", "/download/mac"]) {
      const res = await send(envWith({}), path, { method: "POST" });
      expect(res.status).toBe(405);
    }
  });

  test("an unknown path answers 404 before the method is considered", async () => {
    expect((await send(env(), "/download/linux", { method: "POST" })).status).toBe(404);
  });
});
