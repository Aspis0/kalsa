import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sign } from "../src/crypto";
import { ORIGIN, get, postJson, rows, useWorker } from "./helpers";

useWorker();

function from(address: string, path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual", headers: { "CF-Connecting-IP": address } });
}

describe("the auth routes are rate limited", () => {
  it("stops one address flooding the sign-in callback", async () => {
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = (await get("/auth/github/callback?code=x&state=y")).status;
    }
    expect(last).toBe(429);
  });

  it("stops one address flooding the sign-in start, which writes a state row", async () => {
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = (await get("/auth/github/start")).status;
    }
    expect(last).toBe(429);
  });

  it("stops one address flooding the removal endpoint, before any sign-in is read", async () => {
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = (await postJson("/api/remove", { kind: "engine", id: "frink" })).status;
    }
    expect(last).toBe(429);
  });

  it("counts each address separately, so one visitor cannot lock out another", async () => {
    for (let attempt = 0; attempt < 61; attempt += 1) {
      await from("203.0.113.9", "/auth/github/start");
    }
    expect((await from("203.0.113.9", "/auth/github/start")).status).toBe(429);
    expect((await from("198.51.100.7", "/auth/github/start")).status).toBe(302);
  });

  it("keeps no raw address in the counter key, and derives it with a domain label", async () => {
    await from("203.0.113.9", "/auth/github/start");
    const keys = (await env.DB.prepare("SELECT key FROM abuse_limits").all()).results as { key: string }[];
    expect(keys.length).toBeGreaterThan(0);
    for (const row of keys) {
      expect(row.key).not.toContain("203.0.113.9");
    }
    const derived = await sign("abuse-counter-v1", env.SESSION_HMAC_KEY);
    expect(keys[0]?.key).toBe(`start:ip:${await sign("203.0.113.9", derived)}`);
    expect(keys[0]?.key).not.toBe(`start:ip:${await sign("203.0.113.9", env.SESSION_HMAC_KEY)}`);
  });

  it("refuses a cross-site subresource start, and it cannot lock out a real visitor", async () => {
    const address = "203.0.113.5";
    const subresource = () =>
      SELF.fetch(`${ORIGIN}/auth/github/start`, {
        redirect: "manual",
        headers: { "CF-Connecting-IP": address, "Sec-Fetch-Dest": "image", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": "cross-site" },
      });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      expect((await subresource()).status).toBe(403);
    }
    // The same address, as a top-level navigation: still able to sign in.
    const navigation = await SELF.fetch(`${ORIGIN}/auth/github/start`, {
      redirect: "manual",
      headers: { "CF-Connecting-IP": address, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin" },
    });
    expect(navigation.status).toBe(302);
    expect(await rows("signin_states")).toHaveLength(1);
  });

  it("refuses an iframe start too, before any state row or counter is written", async () => {
    const address = "203.0.113.11";
    const iframe = () =>
      SELF.fetch(`${ORIGIN}/auth/github/start`, {
        redirect: "manual",
        headers: { "CF-Connecting-IP": address, "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site" },
      });
    for (let attempt = 0; attempt < 70; attempt += 1) {
      expect((await iframe()).status).toBe(403);
    }
    expect(await rows("signin_states")).toHaveLength(0);
    expect(await rows("abuse_limits")).toHaveLength(0);
    const navigation = await SELF.fetch(`${ORIGIN}/auth/github/start`, {
      redirect: "manual",
      headers: { "CF-Connecting-IP": address, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin" },
    });
    expect(navigation.status).toBe(302);
    expect(await rows("signin_states")).toHaveLength(1);
  });

  it("does not rate limit the read-only page endpoint", async () => {
    for (let attempt = 0; attempt < 70; attempt += 1) {
      expect((await get("/api/page?kind=engine&id=frink")).status).toBe(200);
    }
  });
});
