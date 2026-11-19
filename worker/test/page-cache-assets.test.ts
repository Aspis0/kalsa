import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ORIGIN, useWorker } from "./helpers";

useWorker();

/**
 * The allow-list asset cannot be fetched. That is an assets failure, not a reason to 5xx a page:
 * the cards whose ids are known from D1 must still be stripped. (Counts and reference labels need
 * the allow-list and stay as they are — the documented partial fail-open, not a 5xx.)
 */
function assetsWithoutAllowList(): Env {
  const failing = new Proxy(env.ASSETS, {
    get(target, property) {
      if (property === "fetch") {
        return (input: Request | string) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.endsWith("/pages.json")) throw new Error("assets failed");
          return target.fetch(input as Request);
        };
      }
      return Reflect.get(target, property);
    },
  });
  return { ...env, ASSETS: failing as unknown as Fetcher };
}

describe("an unreadable allow-list asset does not 5xx a page", () => {
  it("still serves the page with the removed cards stripped", async () => {
    // Seeded directly: going through /api/remove would warm the in-isolate allow-list cache first,
    // and the patched assets would never be read. The serving path under test is still the real handler.
    await env.DB.prepare("INSERT INTO removals (kind, target, github_user_id, created_at) VALUES (?, ?, ?, ?)")
      .bind("engine", "frink", "4242", Math.floor(Date.now() / 1000))
      .run();

    const bound = assetsWithoutAllowList();
    const list = await worker.fetch(new Request(`${ORIGIN}/engines/`), bound);
    expect(list.status).toBe(200);
    const body = await list.text();
    expect(body).not.toContain('data-engine="frink"');
    expect(body).toContain('data-engine="llama-cpp"');
    expect((await worker.fetch(new Request(`${ORIGIN}/`), bound)).status).toBe(200);
    expect((await worker.fetch(new Request(`${ORIGIN}/hardware/apple-m1/`), bound)).status).toBe(200);
  });
});
