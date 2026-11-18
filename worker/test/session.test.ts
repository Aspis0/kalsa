import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";
import { nowSeconds } from "../src/session";
import { get, jar, post, rows, setCookies, signIn, useWorker } from "./helpers";

useWorker();

const JSON_POST = { Origin: "https://kalsa.io", "Content-Type": "application/json" };

/** A session written straight into D1, so its expiry can be placed in the past. */
async function seedSession(expiresAt: number): Promise<string> {
  const token = "a-session-token-written-by-the-test";
  const user = await env.DB.prepare(
    "INSERT INTO users (provider, provider_user_id, username, avatar_url, created_at) VALUES ('github', '7', 'octocat', NULL, ?) RETURNING id",
  )
    .bind(nowSeconds())
    .first<{ id: number }>();
  await env.DB.prepare("INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), user?.id ?? 0, expiresAt)
    .run();
  return `__Host-kalsa_session=${token}`;
}

describe("/api/me", () => {
  it("answers 401 with no cookie", async () => {
    const response = await get("/api/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("answers 401 for a cookie that was never issued", async () => {
    const response = await get("/api/me", "__Host-kalsa_session=not-a-session-we-issued");
    expect(response.status).toBe(401);
  });

  it("answers 401 for an expired session", async () => {
    const cookie = await seedSession(nowSeconds() - 1);
    const response = await get("/api/me", cookie);
    expect(response.status).toBe(401);
  });

  it("answers 401 for a session whose row was deleted", async () => {
    const cookie = await seedSession(nowSeconds() + 600);
    await env.DB.prepare("DELETE FROM sessions").run();
    expect((await get("/api/me", cookie)).status).toBe(401);
  });

  it("answers with the username, avatar and provider, and is not cached", async () => {
    const { response } = await signIn("huggingface");
    const me = await get("/api/me", jar(response));
    expect(me.status).toBe(200);
    expect(me.headers.get("Cache-Control")).toBe("no-store");
    expect(await me.json()).toEqual({
      username: "octocat",
      avatar: "https://cdn.example/4242.png",
      provider: "huggingface",
    });
  });

  it("keeps a null avatar as null", async () => {
    const cookie = await seedSession(nowSeconds() + 600);
    const me = await get("/api/me", cookie);
    expect(await me.json()).toEqual({ username: "octocat", avatar: null, provider: "github" });
  });
});

describe("sign-out", () => {
  it("deletes the session row and expires the cookie", async () => {
    const { response } = await signIn("github");
    const cookie = jar(response);
    expect(await rows("sessions")).toHaveLength(1);

    const out = await post("/auth/signout", { ...JSON_POST, Cookie: cookie });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(await rows("sessions")).toHaveLength(0);

    const cleared = setCookies(out).find((value) => value.startsWith("__Host-kalsa_session=")) ?? "";
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("SameSite=Lax");
    expect(jar(out)).toBe("");
  });

  it("invalidates the cookie the browser already holds", async () => {
    const { response } = await signIn("github");
    const cookie = jar(response);
    expect((await get("/api/me", cookie)).status).toBe(200);
    await post("/auth/signout", { ...JSON_POST, Cookie: cookie });
    expect((await get("/api/me", cookie)).status).toBe(401);
  });

  it("leaves other sessions of the same account alone", async () => {
    const first = await signIn("github");
    const second = await signIn("github");
    await post("/auth/signout", { ...JSON_POST, Cookie: jar(first.response) });
    expect(await rows("sessions")).toHaveLength(1);
    expect((await get("/api/me", jar(second.response))).status).toBe(200);
    expect((await get("/api/me", jar(first.response))).status).toBe(401);
  });

  it("is harmless with no cookie at all", async () => {
    const out = await post("/auth/signout", JSON_POST);
    expect(out.status).toBe(200);
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("keeps the account row: signing out is not deleting the account", async () => {
    const { response } = await signIn("gitlab");
    await post("/auth/signout", { ...JSON_POST, Cookie: jar(response) });
    expect(await rows("users")).toHaveLength(1);
  });
});

describe("session storage", () => {
  it("drops the sessions of a deleted account", async () => {
    await signIn("github");
    expect(await rows("sessions")).toHaveLength(1);
    await env.DB.prepare("DELETE FROM users").run();
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("indexes sessions by user and by expiry", async () => {
    const listed = await env.DB.prepare("PRAGMA index_list(sessions)").all<{ name: string }>();
    const names = listed.results.map((row) => row.name);
    expect(names).toContain("sessions_user_id");
    expect(names).toContain("sessions_expires_at");
  });

  it("purges expired sessions when a new one is opened", async () => {
    await seedSession(nowSeconds() - 1);
    expect(await rows("sessions")).toHaveLength(1);
    await signIn("github");
    expect(await rows("sessions")).toHaveLength(1);
  });
});
