import { describe, expect, it } from "vitest";
import { get, jar, post, rows, signIn, useWorker } from "./helpers";

useWorker();

const OWN = { Origin: "https://kalsa.io", "Content-Type": "application/json" };

describe("POST /auth/signout origin and content type", () => {
  it("refuses a POST with no Origin header", async () => {
    const response = await post("/auth/signout", { "Content-Type": "application/json" });
    expect(response.status).toBe(403);
  });

  it("refuses a POST from another origin", async () => {
    const response = await post("/auth/signout", { ...OWN, Origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("refuses a POST whose Origin is null", async () => {
    const response = await post("/auth/signout", { ...OWN, Origin: "null" });
    expect(response.status).toBe(403);
  });

  it("refuses a POST from a look-alike origin", async () => {
    for (const origin of ["https://kalsa.io.evil.example", "http://kalsa.io", "https://sub.kalsa.io"]) {
      expect((await post("/auth/signout", { ...OWN, Origin: origin })).status).toBe(403);
    }
  });

  it("does not touch the session when the Origin is foreign", async () => {
    const { response } = await signIn("github");
    const cookie = jar(response);
    const refused = await post("/auth/signout", { ...OWN, Origin: "https://evil.example", Cookie: cookie });
    expect(refused.status).toBe(403);
    expect(await rows("sessions")).toHaveLength(1);
    expect((await get("/api/me", cookie)).status).toBe(200);
  });

  it("refuses a POST with no Content-Type", async () => {
    const response = await post("/auth/signout", { Origin: "https://kalsa.io" });
    expect(response.status).toBe(415);
  });

  it("refuses a form-encoded POST", async () => {
    const response = await post("/auth/signout", { ...OWN, "Content-Type": "application/x-www-form-urlencoded" });
    expect(response.status).toBe(415);
  });

  it("refuses a text/plain POST", async () => {
    const response = await post("/auth/signout", { ...OWN, "Content-Type": "text/plain" });
    expect(response.status).toBe(415);
  });

  it("accepts application/json with a charset parameter", async () => {
    const response = await post("/auth/signout", { ...OWN, "Content-Type": "application/json; charset=utf-8" });
    expect(response.status).toBe(200);
  });
});

describe("methods", () => {
  it("refuses GET on the sign-out route", async () => {
    expect((await get("/auth/signout")).status).toBe(405);
  });

  it("refuses POST on /api/me", async () => {
    expect((await post("/api/me", OWN)).status).toBe(405);
  });

  it("refuses POST on a provider start route", async () => {
    expect((await post("/auth/github/start", OWN)).status).toBe(405);
  });

  it("refuses POST on a provider callback route", async () => {
    expect((await post("/auth/github/callback", OWN)).status).toBe(405);
  });
});
