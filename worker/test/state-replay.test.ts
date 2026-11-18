import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { callbackUrl, get, mockIdentity, mockToken, rows, startSignIn, useWorker } from "./helpers";

// The replay below registers provider mocks that a correct implementation never reaches,
// so this file does not assert that every mock was consumed.
useWorker({ requireAllMocks: false });

describe("a sign-in state is single-use on the server", () => {
  it("refuses the same cookie and state a second time, and opens no second session", async () => {
    mockToken("github", "provider-token-first");
    mockIdentity("github");
    const started = await startSignIn("github");
    const first = await get(callbackUrl("github", started.state), started.cookie);
    expect(first.status).toBe(302);
    expect(await rows("sessions")).toHaveLength(1);

    // A replay would reach the provider again if the server kept no record of the state.
    mockToken("github", "provider-token-replay");
    mockIdentity("github");
    const replay = await get(callbackUrl("github", started.state), started.cookie);
    expect(replay.status).toBe(400);
    expect(await rows("sessions")).toHaveLength(1);
    expect(await rows("users")).toHaveLength(1);
  });

  it("stores only the hash of the state, and removes it once spent", async () => {
    mockToken("github", "provider-token-hash");
    mockIdentity("github");
    const started = await startSignIn("github");
    const pending = (await rows("signin_states")) as Record<string, unknown>[];
    expect(pending).toHaveLength(1);
    expect(pending[0]?.provider).toBe("github");
    expect(JSON.stringify(pending)).not.toContain(started.state);
    expect(String(pending[0]?.hash)).toMatch(/^[0-9a-f]{64}$/);

    await get(callbackUrl("github", started.state), started.cookie);
    expect(await rows("signin_states")).toHaveLength(0);
  });

  it("refuses a state whose row is gone even though the cookie is still signed and unexpired", async () => {
    const started = await startSignIn("github");
    await env.DB.prepare("DELETE FROM signin_states").run();
    const response = await get(callbackUrl("github", started.state), started.cookie);
    expect(response.status).toBe(400);
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("purges expired state rows when a new sign-in starts", async () => {
    const started = await startSignIn("github");
    await env.DB.prepare("UPDATE signin_states SET expires_at = ? WHERE provider = 'github'")
      .bind(Math.floor(Date.now() / 1000) - 1)
      .run();
    expect(await rows("signin_states")).toHaveLength(1);
    await startSignIn("gitlab");
    const left = (await rows("signin_states")) as Record<string, unknown>[];
    expect(left).toHaveLength(1);
    expect(left[0]?.provider).toBe("gitlab");
    expect(started.state).toBeTruthy();
  });
});
