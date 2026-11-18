import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64Url, sha256Hex } from "../src/crypto";
import {
  PROVIDERS,
  type ProviderName,
  callbackUrl,
  cookieValue,
  get,
  jar,
  mockIdentity,
  mockToken,
  rows,
  setCookies,
  signIn,
  startSignIn,
  useWorker,
} from "./helpers";

useWorker();

const NAMES: ProviderName[] = ["github", "huggingface", "gitlab"];

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

describe.each(NAMES)("sign-in with %s", (name) => {
  it("redirects to the provider with state and an S256 challenge", async () => {
    const started = await startSignIn(name);
    expect(started.response.status).toBe(302);

    const location = new URL(started.response.headers.get("Location") ?? "");
    const clientId = { github: env.GITHUB_CLIENT_ID, huggingface: env.HF_CLIENT_ID, gitlab: env.GITLAB_CLIENT_ID }[name];
    expect(location.searchParams.get("client_id")).toBe(clientId);
    expect(location.searchParams.get("redirect_uri")).toBe(`https://kalsa.io/auth/${name}/callback`);
    expect(location.searchParams.get("state")).toBe(started.state);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(await s256(started.verifier));
    expect(started.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("asks only for the identity scope", async () => {
    const started = await startSignIn(name);
    const scope = new URL(started.response.headers.get("Location") ?? "").searchParams.get("scope");
    const expected = { github: null, huggingface: "openid profile", gitlab: "read_user" }[name];
    expect(scope).toBe(expected);
  });

  it("sets a signed, short-lived state cookie and no session yet", async () => {
    const started = await startSignIn(name);
    const cookie = setCookies(started.response).find((value) => value.startsWith("__Host-kalsa_oauth=")) ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).not.toContain("Domain=");
    expect(started.next).toBe("/");
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("sends the PKCE verifier to the token endpoint and reads the identity once", async () => {
    const { token, bodies, authorization, started, response } = await signIn(name);
    expect(response.status).toBe(302);
    expect(bodies).toHaveLength(1);
    const form = new URLSearchParams(bodies[0] ?? "");
    expect(form.get("code_verifier")).toBe(started.verifier);
    expect(form.get("code")).toBe("provider-code");
    expect(form.get("redirect_uri")).toBe(`https://kalsa.io/auth/${name}/callback`);
    expect(authorization).toEqual([`Bearer ${token}`]);
  });

  it("stores the public identity and a hashed session, then answers /api/me", async () => {
    const { token, response } = await signIn(name);
    const spec = PROVIDERS[name];

    const users = (await rows("users")) as Record<string, unknown>[];
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      provider: name,
      provider_user_id: spec.providerUserId,
      username: spec.account.username,
      avatar_url: spec.account.avatar,
    });

    const sessions = (await rows("sessions")) as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
    const session = cookieValue(response, "__Host-kalsa_session") ?? "";
    expect(sessions[0]?.hash).toBe(await sha256Hex(session));
    expect(sessions[0]?.hash).not.toBe(token);
    expect(JSON.stringify(sessions)).not.toContain(token);
    expect(sessions[0]?.user_id).toBe(users[0]?.id);

    const me = await get("/api/me", jar(response));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual(spec.account);
  });

  it("sets a 30-day __Host- session cookie and expires the state cookie", async () => {
    const { response } = await signIn(name);
    const session = setCookies(response).find((value) => value.startsWith("__Host-kalsa_session=")) ?? "";
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Path=/");
    expect(session).toContain("Max-Age=2592000");
    expect(session).not.toContain("Domain=");

    const cleared = setCookies(response).find((value) => value.startsWith("__Host-kalsa_oauth=")) ?? "";
    expect(cleared).toContain("Max-Age=0");
    expect(jar(response)).not.toContain("__Host-kalsa_oauth");
  });

  it("returns to the allowlisted page the flow started from", async () => {
    const { response } = await signIn(name, "/submit/");
    expect(response.headers.get("Location")).toBe("https://kalsa.io/submit/");
  });

  it("keeps one account across two sign-ins and refreshes the username", async () => {
    await signIn(name);
    const spec = PROVIDERS[name];
    mockToken(name, "second-provider-token");
    mockIdentity(name, 200, { ...spec.identity, [spec.usernameKey]: "renamed" });
    const started = await startSignIn(name);
    const response = await get(callbackUrl(name, started.state), started.cookie);
    expect(response.status).toBe(302);

    const users = (await rows("users")) as Record<string, unknown>[];
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe("renamed");
    expect(await rows("sessions")).toHaveLength(2);
  });
});
