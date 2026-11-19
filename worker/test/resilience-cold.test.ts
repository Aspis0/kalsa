import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ORIGIN, useWorker } from "./helpers";

useWorker();

/**
 * A cold isolate: no successful D1 read has ever happened here, so there is no last known removals
 * list. Serving the asset would risk showing a removed page, so the affected paths answer 503.
 */
function brokenDb(): Env {
  const failing = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") return () => { throw new Error("D1 unavailable"); };
      return Reflect.get(target, property);
    },
  });
  return { ...env, DB: failing as unknown as D1Database };
}

describe("with no last known removals list, an affected page is refused rather than guessed", () => {
  it("answers 503 with Retry-After for the paths a removal could change", async () => {
    await caches.default.delete(new Request(`${ORIGIN}/__kalsa/removals-snapshot`));
    const bound = brokenDb();
    for (const path of ["/", "/engines/", "/engines/frink/", "/hardware/apple-m1/", "/dev/antonellof/", "/engines/engines.json", "/pages.json", "/sitemap.xml", "/badge/frink.svg"]) {
      const response = await worker.fetch(new Request(`${ORIGIN}${path}`), bound);
      expect(response.status, path).toBe(503);
      expect(response.headers.get("Retry-After"), path).toBeTruthy();
      expect(await response.text(), path).toContain("try again");
    }
  });
});
