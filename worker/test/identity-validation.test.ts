import { describe, expect, it } from "vitest";
import { PROVIDERS, callbackUrl, get, jar, mockIdentity, mockToken, rows, startSignIn, useWorker } from "./helpers";

useWorker();

const BASE = PROVIDERS.github.identity;

async function flowWith(identity: Record<string, unknown>): Promise<Response> {
  mockToken("github", "provider-token-identity-validation");
  mockIdentity("github", 200, identity);
  const started = await startSignIn("github");
  return get(callbackUrl("github", started.state), started.cookie);
}

describe("the provider username is validated before it is stored", () => {
  it("refuses a username longer than 64 characters", async () => {
    const response = await flowWith({ ...BASE, login: "u".repeat(65) });
    expect(response.status).toBe(502);
    expect(await rows("users")).toHaveLength(0);
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("refuses a username carrying a control character", async () => {
    for (const login of ["octo\ncat", "octo\tcat", "octo\u0000cat", "octo\u007fcat"]) {
      const response = await flowWith({ ...BASE, login });
      expect(response.status).toBe(502);
    }
    expect(await rows("users")).toHaveLength(0);
  });

  it("accepts a username of exactly 64 characters", async () => {
    const response = await flowWith({ ...BASE, login: "u".repeat(64) });
    expect(response.status).toBe(302);
    const users = (await rows("users")) as Record<string, unknown>[];
    expect(users[0]?.username).toBe("u".repeat(64));
  });
});

describe("the provider avatar is https only, bounded, and otherwise null", () => {
  it("stores null for an http avatar", async () => {
    const response = await flowWith({ ...BASE, avatar_url: "http://avatars.example/4242.png" });
    expect(response.status).toBe(302);
    expect((await rows("users"))[0]).toMatchObject({ avatar_url: null });
    expect(await (await get("/api/me", jar(response))).json()).toMatchObject({ avatar: null });
  });

  it("stores null for a javascript: avatar", async () => {
    const response = await flowWith({ ...BASE, avatar_url: "javascript:alert(1)" });
    expect(response.status).toBe(302);
    expect((await rows("users"))[0]).toMatchObject({ avatar_url: null });
  });

  it("stores null for an avatar longer than 512 characters", async () => {
    const long = `https://avatars.example/${"a".repeat(512)}.png`;
    const response = await flowWith({ ...BASE, avatar_url: long });
    expect(response.status).toBe(302);
    expect((await rows("users"))[0]).toMatchObject({ avatar_url: null });
  });

  it("keeps an https avatar of exactly 512 characters", async () => {
    const exact = `https://avatars.example/${"a".repeat(512 - "https://avatars.example/".length)}`;
    expect(exact.length).toBe(512);
    const response = await flowWith({ ...BASE, avatar_url: exact });
    expect(response.status).toBe(302);
    expect((await rows("users"))[0]).toMatchObject({ avatar_url: exact });
  });

  it("stores null when the provider sends no avatar", async () => {
    const response = await flowWith({ id: BASE.id, login: BASE.login });
    expect(response.status).toBe(302);
    expect((await rows("users"))[0]).toMatchObject({ avatar_url: null });
  });
});
