import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

async function removeFrink(): Promise<void> {
  const { response } = await signIn("github");
  network.use(
    http.get("https://api.github.com/repos/antonellof/frink", () =>
      HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
    ),
  );
  expect((await postJson("/api/remove", { kind: "engine", id: "frink" }, jar(response))).status).toBe(200);
}

function keyOf(key: Request | string): string {
  return String(typeof key === "string" ? key : key.url);
}

describe("the page cache is best-effort, never a 5xx", () => {
  it("serves the rewritten page when the cache write fails", async () => {
    await removeFrink();
    const original = caches.default.put.bind(caches.default);
    caches.default.put = async (key: Request | string, response: Response) => {
      if (keyOf(key).includes("_kalsa_removals=")) throw new Error("cache write failed");
      return original(key as Request, response);
    };
    try {
      const list = await get("/engines/");
      expect(list.status).toBe(200);
      const body = await list.text();
      expect(body).not.toContain('data-engine="frink"');
      expect(body).toContain('data-engine="llama-cpp"');
      expect((await get("/engines/frink/")).status).toBe(410);
      expect((await get("/")).status).toBe(200);
      expect((await get("/pages.json")).status).toBe(200);
      expect((await get("/engines/engines.json")).status).toBe(200);
      expect((await get("/sitemap.xml")).status).toBe(200);
      expect((await get("/hardware/apple-m1/")).status).toBe(200);
    } finally {
      caches.default.put = original;
    }
  });

  it("serves the rewritten page when the cache read fails", async () => {
    await removeFrink();
    const original = caches.default.match.bind(caches.default);
    caches.default.match = async (key: Request | string) => {
      if (keyOf(key).includes("_kalsa_removals=")) throw new Error("cache read failed");
      return original(key as Request);
    };
    try {
      const list = await get("/engines/");
      expect(list.status).toBe(200);
      const body = await list.text();
      expect(body).not.toContain('data-engine="frink"');
      expect(body).toContain('data-engine="llama-cpp"');
      expect((await get("/pages.json")).status).toBe(200);
    } finally {
      caches.default.match = original;
    }
  });
});
