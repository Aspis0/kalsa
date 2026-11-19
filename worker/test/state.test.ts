import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64Url, sign } from "../src/crypto";
import { nowSeconds } from "../src/session";
import { STATE_COOKIE, type SignInState, stateCookie } from "../src/state";
import { ORIGIN, callbackUrl, get, jar, mockIdentity, mockToken, rows, signIn, startSignIn, useWorker } from "./helpers";

useWorker();

const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(43);

function forged(overrides: Partial<SignInState> = {}): SignInState {
  return {
    provider: "github",
    state: STATE,
    verifier: VERIFIER,
    next: "/",
    expiresAt: nowSeconds() + 600,
    ...overrides,
  };
}

async function cookieFor(overrides: Partial<SignInState> = {}, secret = env.SESSION_HMAC_KEY): Promise<string> {
  return stateCookie(forged(overrides), secret);
}

/** A payload edited after signing: the signature no longer covers what the cookie claims. */
async function tamperedCookie(): Promise<string> {
  const honest = await cookieFor();
  const value = honest.slice(`${STATE_COOKIE}=`.length).split(";")[0] ?? "";
  const payload = value.slice(0, value.lastIndexOf("."));
  const signature = value.slice(value.lastIndexOf(".") + 1);
  const edited = base64Url(new TextEncoder().encode(JSON.stringify(forged({ next: "//evil.example" }))));
  return `${STATE_COOKIE}=${edited}.${signature}`;
}

/** clearsCookie: only an unusable cookie, or a verified attempt, may be expired by the answer. */
async function expectRejected(response: Response, clearsCookie: boolean): Promise<void> {
  expect(response.status).toBe(400);
  expect(await rows("sessions")).toHaveLength(0);
  expect(await rows("users")).toHaveLength(0);
  expect(response.headers.get("Location")).toBeNull();
  const clearing = response.headers.getSetCookie().some((value) => value.startsWith(`${STATE_COOKIE}=`) && value.includes("Max-Age=0"));
  expect(clearing).toBe(clearsCookie);
  if (clearsCookie) expect(jar(response)).toBe("");
}

describe("callback state checks", () => {
  it("rejects a callback with no state cookie", async () => {
    await expectRejected(await get(callbackUrl("github", STATE)), false);
  });

  it("rejects a callback with no state parameter and leaves the live cookie alone", async () => {
    const cookie = await cookieFor();
    await expectRejected(await get("/auth/github/callback?code=provider-code", cookie), false);
  });

  it("rejects a state that does not match the cookie and leaves the live cookie alone", async () => {
    const cookie = await cookieFor();
    await expectRejected(await get(callbackUrl("github", "x".repeat(43)), cookie), false);
  });

  it("rejects an expired state cookie and clears it", async () => {
    const cookie = await cookieFor({ expiresAt: nowSeconds() - 1 });
    await expectRejected(await get(callbackUrl("github", STATE), cookie), true);
  });

  it("rejects a state cookie whose payload was edited and clears it", async () => {
    await expectRejected(await get(callbackUrl("github", STATE), await tamperedCookie()), true);
  });

  it("rejects a state cookie whose signature was edited and clears it", async () => {
    const honest = await cookieFor();
    const value = honest.slice(`${STATE_COOKIE}=`.length).split(";")[0] ?? "";
    const payload = value.slice(0, value.lastIndexOf("."));
    const signature = value.slice(value.lastIndexOf(".") + 1);
    const broken = `${STATE_COOKIE}=${payload}.${signature.slice(0, -2)}xx`;
    await expectRejected(await get(callbackUrl("github", STATE), broken), true);
  });

  it("rejects a state cookie signed with another key and clears it", async () => {
    const cookie = await cookieFor({}, "a-different-signing-key");
    await expectRejected(await get(callbackUrl("github", STATE), cookie), true);
  });

  it("rejects a malformed state cookie and clears it", async () => {
    await expectRejected(await get(callbackUrl("github", STATE), `${STATE_COOKIE}=not-a-signed-payload`), true);
  });

  it("rejects a state cookie issued for another provider and leaves that attempt alive", async () => {
    const started = await startSignIn("github");
    await expectRejected(await get(callbackUrl("gitlab", started.state), started.cookie), false);
  });

  it("lets the original attempt finish after a foreign-provider callback was refused", async () => {
    const started = await startSignIn("github");
    await get(callbackUrl("gitlab", started.state), started.cookie);
    mockToken("github", "provider-token-after-mixup");
    mockIdentity("github");
    const response = await get(callbackUrl("github", started.state), started.cookie);
    expect(response.status).toBe(302);
    expect(await rows("sessions")).toHaveLength(1);
  });

  it("clears the cookie once the attempt is verified but the provider refuses", async () => {
    const started = await startSignIn("github");
    const response = await get(callbackUrl("github", started.state, { error: "access_denied" }), started.cookie);
    await expectRejected(response, true);
  });

  it("rejects an unknown provider", async () => {
    const response = await get("/auth/example/start");
    expect(response.status).toBe(404);
  });
});

describe("redirect back", () => {
  const attacks = [
    "//evil.example",
    "https://evil.example",
    "http://evil.example/path",
    "/\\evil.example",
    "\n/evil.example",
    "/%2F%2Fevil.example",
    "javascript:alert(1)",
    "/engines/../../secret",
    "/elsewhere/",
    "///evil.example",
  ];

  it.each(attacks)("refuses %s and lands on the home page", async (attack) => {
    const { started, response } = await signIn("github", attack);
    expect(started.next).toBe("/");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}/`);
  });

  const allowed = [
    "/",
    "/signin/",
    "/submit/",
    "/engines/",
    "/engines/frink/",
    "/hardware/m1/",
    "/listed-and-community/",
    "/app/",
    "/dev/octocat/",
    "/engines/?hw=apple",
  ];

  it.each(allowed)("keeps the allowlisted path %s", async (path) => {
    const { started, response } = await signIn("github", path);
    expect(started.next).toBe(path);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}${path}`);
  });

  it("never puts an off-origin authority in the Location header", async () => {
    const { response } = await signIn("github", "//evil.example");
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin).toBe(ORIGIN);
    expect(location.host).toBe(new URL(ORIGIN).host);
  });
});

describe("state cookie signing", () => {
  it("signs the payload the cookie carries", async () => {
    const value = forged();
    const cookie = await stateCookie(value, env.SESSION_HMAC_KEY);
    const raw = cookie.slice(`${STATE_COOKIE}=`.length).split(";")[0] ?? "";
    const payload = raw.slice(0, raw.lastIndexOf("."));
    expect(raw.slice(raw.lastIndexOf(".") + 1)).toBe(await sign(payload, env.SESSION_HMAC_KEY));
  });
});
