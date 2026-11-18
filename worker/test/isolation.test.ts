import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type ProviderName, callbackUrl, get, mockIdentity, mockToken, rows, startSignIn, useWorker } from "./helpers";

useWorker();

const NAMES: ProviderName[] = ["github", "huggingface", "gitlab"];

describe("test bindings are the ones the tests set", () => {
  it("is not shadowed by a local .dev.vars", async () => {
    // .dev.vars ships the placeholder key; if it won, every sign-in would answer 503.
    expect(env.SESSION_HMAC_KEY).toBe("a2Fsc2EtdGVzdC1zaWduaW5nLWtleS0zMi1ieXRlcyEh");
    expect(env.SESSION_HMAC_KEY).not.toBe("replace-with-base64-of-32-random-bytes");
    expect(env.SITE_ORIGIN).toBe("https://kalsa.io");
    expect(env.GITHUB_CLIENT_ID).toBe("github-client-id");
    expect(env.HF_CLIENT_ID).toBe("hf-client-id");
    expect(env.GITLAB_CLIENT_ID).toBe("gitlab-client-id");
  });
});

describe("a state issued for one provider cannot be spent on another", () => {
  const pairs = NAMES.flatMap((from) => NAMES.filter((to) => to !== from).map((to) => [from, to] as const));

  it.each(pairs)("refuses a %s state on the %s callback", async (from, to) => {
    const started = await startSignIn(from);
    const response = await get(callbackUrl(to, started.state), started.cookie);
    expect(response.status).toBe(400);
    expect(await rows("sessions")).toHaveLength(0);
    expect(await rows("users")).toHaveLength(0);
    // The row belongs to the issuing provider, and is still there.
    const pending = (await rows("signin_states")) as Record<string, unknown>[];
    expect(pending).toHaveLength(1);
    expect(pending[0]?.provider).toBe(from);
  });

  it.each(pairs)("leaves the %s attempt usable after a %s callback was refused", async (from, to) => {
    const started = await startSignIn(from);
    await get(callbackUrl(to, started.state), started.cookie);
    mockToken(from, `provider-token-${from}-after-${to}`);
    mockIdentity(from);
    const response = await get(callbackUrl(from, started.state), started.cookie);
    expect(response.status).toBe(302);
    expect(await rows("sessions")).toHaveLength(1);
    expect((await rows("users"))[0]).toMatchObject({ provider: from });
  });
});
