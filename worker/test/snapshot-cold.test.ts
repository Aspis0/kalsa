import { describe, expect, it } from "vitest";
import { get, useWorker } from "./helpers";

useWorker();

/**
 * A cold isolate: no successful read has published a snapshot here yet. D1 is healthy but the cache
 * write fails. That must not be mistaken for a D1 outage — the blast radius would be every catalog
 * page answering 503 while the database is fine.
 */
describe("a cache write failure on a cold isolate", () => {
  it("still serves the pages, because D1 answered", async () => {
    const original = caches.default.put.bind(caches.default);
    caches.default.put = async (key: Request | string, response: Response) => {
      if (String(typeof key === "string" ? key : key.url).includes("removals-snapshot")) throw new Error("cache write failed");
      return original(key as Request, response);
    };
    try {
      const list = await get("/engines/");
      expect(list.status).toBe(200);
      expect(await list.text()).toContain('data-engine="frink"');
      expect((await get("/engines/frink/")).status).toBe(200);
      expect((await get("/")).status).toBe(200);
    } finally {
      caches.default.put = original;
    }
  });
});
