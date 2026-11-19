import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ORIGIN, useWorker } from "./helpers";

useWorker();

// 33 bytes after base64 decode.
const VALID_KEY = "a2Fsc2EtdGVzdC1zaWduaW5nLWtleS0zMi1ieXRlcyEh";
const PLACEHOLDER = "replace-with-base64-of-32-random-bytes";

/** Bindings cannot be varied per test through SELF on this pool, so the real handler is invoked directly. */
function startWith(bound: Env): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/auth/github/start`), bound);
}

async function expectNotConfigured(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.text()).toContain("Sign-in is not configured");
}

describe("SESSION_HMAC_KEY is validated before any crypto", () => {
  it("refuses an absent key", async () => {
    const absent = { ...env } as Record<string, unknown>;
    delete absent.SESSION_HMAC_KEY;
    // A missing secret is a real deployment state that Env cannot express, so the cast is deliberate.
    await expectNotConfigured(await startWith(absent as unknown as Env));
  });

  it("refuses an empty key", async () => {
    await expectNotConfigured(await startWith({ ...env, SESSION_HMAC_KEY: "" }));
  });

  it("refuses a key that decodes to one byte", async () => {
    await expectNotConfigured(await startWith({ ...env, SESSION_HMAC_KEY: "YQ==" }));
  });

  it("refuses a key that decodes to 31 bytes", async () => {
    await expectNotConfigured(await startWith({ ...env, SESSION_HMAC_KEY: Buffer.from("x".repeat(31)).toString("base64") }));
  });

  it("refuses the .dev.vars.example placeholder", async () => {
    await expectNotConfigured(await startWith({ ...env, SESSION_HMAC_KEY: PLACEHOLDER }));
  });

  it("refuses a value that is not base64 at all", async () => {
    await expectNotConfigured(await startWith({ ...env, SESSION_HMAC_KEY: "not base64 !!!" }));
  });

  it("accepts a key of 32 bytes or more", async () => {
    const response = await startWith({ ...env, SESSION_HMAC_KEY: VALID_KEY });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("Location") ?? "").searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/github/callback`);
  });

  it("refuses a callback with an unusable key instead of throwing", async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/auth/github/callback?code=x&state=y`),
      { ...env, SESSION_HMAC_KEY: "" },
    );
    await expectNotConfigured(response);
  });
});
