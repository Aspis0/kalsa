import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { gitlab } from "../src/providers/gitlab";
import { start } from "../src/routes/start";
import { ORIGIN, PROVIDERS, type ProviderName, callbackUrl, get, mockIdentity, mockToken, mockTokenFailure, rows, startSignIn, useWorker } from "./helpers";

useWorker();

const NAMES: ProviderName[] = ["github", "huggingface", "gitlab"];

async function expectNoAccount(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await rows("users")).toHaveLength(0);
  expect(await rows("sessions")).toHaveLength(0);
  expect(response.headers.getSetCookie().some((value) => value.startsWith("__Host-kalsa_session="))).toBe(false);
}

describe.each(NAMES)("%s refuses or fails upstream", (name) => {
  it("returns 400 when the user denies the authorization", async () => {
    const started = await startSignIn(name);
    const response = await get(callbackUrl(name, started.state, { error: "access_denied" }), started.cookie);
    await expectNoAccount(response, 400);
  });

  it("returns 400 when the callback carries no code", async () => {
    const started = await startSignIn(name);
    const response = await get(`/auth/${name}/callback?state=${started.state}`, started.cookie);
    await expectNoAccount(response, 400);
  });

  it("returns 502 when the token endpoint refuses the code", async () => {
    const started = await startSignIn(name);
    mockTokenFailure(name, 400, { error: "invalid_grant", error_description: "The code is incorrect or expired." });
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });

  it("returns 502 when the token endpoint answers 500", async () => {
    const started = await startSignIn(name);
    mockTokenFailure(name, 500, { error: "server_error" });
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });

  it("returns 502 when the token endpoint sends no access token", async () => {
    const started = await startSignIn(name);
    mockTokenFailure(name, 200, { token_type: "bearer" });
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });

  it("returns 502 when the token endpoint sends a body that is not JSON", async () => {
    const started = await startSignIn(name);
    mockTokenFailure(name, 200, "<html>gateway timeout</html>");
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });

  it("returns 502 when the identity read is refused", async () => {
    const started = await startSignIn(name);
    mockToken(name, "provider-token-identity-refused");
    mockIdentity(name, 401, { message: "Bad credentials" });
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });

  it("returns 502 when the identity has no username", async () => {
    const started = await startSignIn(name);
    const spec = PROVIDERS[name];
    mockToken(name, "provider-token-no-username");
    mockIdentity(name, 200, { ...spec.identity, [spec.usernameKey]: "" });
    const response = await get(callbackUrl(name, started.state), started.cookie);
    await expectNoAccount(response, 502);
  });
});

describe("GitHub answers 200 with an error body", () => {
  it("treats bad_verification_code as a failure, not a sign-in", async () => {
    const started = await startSignIn("github");
    mockTokenFailure("github", 200, {
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
      error_uri: "https://docs.github.com/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code",
    });
    const response = await get(callbackUrl("github", started.state), started.cookie);
    await expectNoAccount(response, 502);
  });
});

describe("a provider that is not configured", () => {
  it("answers 503 instead of redirecting with an empty client id", async () => {
    const unconfigured: Env = { ...env, GITLAB_CLIENT_ID: "", GITLAB_CLIENT_SECRET: "" };
    const response = await start(new Request(`${ORIGIN}/auth/gitlab/start`), unconfigured, gitlab);
    expect(response.status).toBe(503);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain("GitLab");
  });
});
