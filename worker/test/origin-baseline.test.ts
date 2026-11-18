import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { useWorker } from "./helpers";

useWorker();

const ATTACKER = "https://attacker.example";

describe("the origin baseline is SITE_ORIGIN, not the Host header", () => {
  it("refuses a sign-in start served under a foreign host", async () => {
    const response = await SELF.fetch(`${ATTACKER}/auth/github/start`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).not.toContain("attacker.example");
  });

  it("never builds a redirect_uri on a foreign host, for any provider", async () => {
    for (const provider of ["github", "huggingface", "gitlab"]) {
      const response = await SELF.fetch(`${ATTACKER}/auth/${provider}/start`, { redirect: "manual" });
      expect(response.headers.get("Location") ?? "").not.toContain("attacker.example");
      expect(response.status).not.toBe(302);
    }
  });

  it("refuses a callback under a foreign host", async () => {
    const response = await SELF.fetch(`${ATTACKER}/auth/github/callback?code=x&state=y`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("refuses /api/me under a foreign host", async () => {
    const response = await SELF.fetch(`${ATTACKER}/api/me`);
    expect(response.status).toBe(400);
  });

  it("refuses sign-out under a foreign host even with a matching Origin header", async () => {
    const response = await SELF.fetch(`${ATTACKER}/auth/signout`, {
      method: "POST",
      headers: { Origin: ATTACKER, "Content-Type": "application/json" },
    });
    expect(response.status).toBe(400);
  });
});
