import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nowSeconds } from "../src/session";
import { stateCookie } from "../src/state";
import { callbackUrl, get, jar, post, signIn, startSignIn, useWorker } from "./helpers";

useWorker();

function expectHardened(response: Response): void {
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}

describe("every Worker answer carries the security headers", () => {
  it("hardens the anonymous /api/me answer", async () => {
    expectHardened(await get("/api/me"));
  });

  it("hardens the signed-in /api/me answer", async () => {
    const { response } = await signIn("github");
    expectHardened(await get("/api/me", jar(response)));
  });

  it("hardens the redirect to the provider", async () => {
    const started = await startSignIn("github");
    expectHardened(started.response);
  });

  it("hardens the successful callback redirect", async () => {
    const { response } = await signIn("github");
    expectHardened(response);
  });

  it("hardens sign-out", async () => {
    expectHardened(await post("/auth/signout", { Origin: "https://kalsa.io", "Content-Type": "application/json" }));
  });

  it("hardens the JSON 404 and 405", async () => {
    expectHardened(await get("/api/unknown"));
    expectHardened(await post("/api/me", { Origin: "https://kalsa.io", "Content-Type": "application/json" }));
  });

  it("hardens the foreign-origin refusal", async () => {
    expectHardened(await SELF.fetch("https://attacker.example/auth/github/start", { redirect: "manual" }));
  });
});

describe("the HTML error page has a strict CSP", () => {
  async function errorPage(): Promise<Response> {
    const cookie = await stateCookie(
      { provider: "github", state: "s".repeat(43), verifier: "v".repeat(43), next: "/", expiresAt: nowSeconds() - 1 },
      env.SESSION_HMAC_KEY,
    );
    return get(callbackUrl("github", "s".repeat(43)), cookie);
  }

  it("serves HTML with default-src 'none' and no script source at all", async () => {
    const response = await errorPage();
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src");
    expectHardened(response);
  });

  it("allows only its own stylesheet, and carries no inline script or style", async () => {
    const response = await errorPage();
    expect(response.headers.get("Content-Security-Policy") ?? "").toContain("style-src 'self'");
    const body = await response.text();
    expect(body).not.toContain("<script");
    expect(body).not.toContain("style=");
    expect(body).toContain("/static/base.css");
  });
});
