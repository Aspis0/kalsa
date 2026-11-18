import { describe, expect, it } from "vitest";
import { get, jar, post, signIn, useWorker } from "./helpers";
import { SELF } from "cloudflare:test";

useWorker();

const JSON_POST = { Origin: "https://kalsa.io", "Content-Type": "application/json" };

async function expectJson(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(await response.json()).toEqual({ error });
}

describe("unknown dynamic paths are the Worker's own JSON 404", () => {
  it("answers JSON for an unknown /api path", async () => {
    await expectJson(await get("/api/unknown"), 404, "not_found");
  });

  it("answers JSON for an unknown /auth path", async () => {
    await expectJson(await get("/auth/unknown"), 404, "not_found");
    await expectJson(await get("/auth/github/unknown"), 404, "not_found");
    await expectJson(await get("/auth/"), 404, "not_found");
  });

  it("answers JSON for an unknown provider", async () => {
    await expectJson(await get("/auth/example/start"), 404, "not_found");
  });

  it("answers JSON for an unknown path under a POST", async () => {
    await expectJson(await post("/api/unknown", JSON_POST), 404, "not_found");
  });
});

describe("405 carries Allow", () => {
  it("lists GET and HEAD for /api/me", async () => {
    const response = await post("/api/me", JSON_POST);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("lists POST for /auth/signout", async () => {
    const response = await get("/auth/signout");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("lists GET and HEAD for the provider routes", async () => {
    for (const path of ["/auth/github/start", "/auth/github/callback"]) {
      const response = await post(path, JSON_POST);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
    }
  });
});

describe("HEAD is allowed where GET is", () => {
  it("answers HEAD /api/me with the GET status and no body", async () => {
    const anonymous = await SELF.fetch("https://kalsa.io/api/me", { method: "HEAD" });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toBe("");

    const { response } = await signIn("github");
    const signedIn = await SELF.fetch("https://kalsa.io/api/me", { method: "HEAD", headers: { Cookie: jar(response) } });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toBe("");
  });

  it("answers HEAD on a provider start with the GET status", async () => {
    const head = await SELF.fetch("https://kalsa.io/auth/github/start", { method: "HEAD", redirect: "manual" });
    expect(head.status).toBe(302);
    expect(new URL(head.headers.get("Location") ?? "").origin).toBe("https://github.com");
  });

  it("answers HEAD on an unknown path with 404", async () => {
    const response = await SELF.fetch("https://kalsa.io/api/unknown", { method: "HEAD" });
    expect(response.status).toBe(404);
  });

  it("still refuses HEAD on the sign-out route", async () => {
    const response = await SELF.fetch("https://kalsa.io/auth/signout", { method: "HEAD" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
