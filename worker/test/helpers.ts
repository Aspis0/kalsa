import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { setupNetwork } from "@msw/cloudflare";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { decodeBase64Url, verify } from "../src/crypto";

export const ORIGIN = "https://kalsa.io";

/** Outbound fetch is intercepted here; an unmocked request errors instead of reaching the network. */
export const network = setupNetwork();

export const PROVIDERS = {
  github: {
    tokenOrigin: "https://github.com",
    tokenPath: "/login/oauth/access_token",
    identityOrigin: "https://api.github.com",
    identityPath: "/user",
    identity: { id: 4242, login: "octocat", avatar_url: "https://avatars.example/4242.png" },
    account: { username: "octocat", avatar: "https://avatars.example/4242.png", provider: "github" },
    providerUserId: "4242",
    usernameKey: "login",
  },
  huggingface: {
    tokenOrigin: "https://huggingface.co",
    tokenPath: "/oauth/token",
    identityOrigin: "https://huggingface.co",
    identityPath: "/oauth/userinfo",
    identity: { sub: "6f1c-hf", preferred_username: "octocat", picture: "https://cdn.example/4242.png" },
    account: { username: "octocat", avatar: "https://cdn.example/4242.png", provider: "huggingface" },
    providerUserId: "6f1c-hf",
    usernameKey: "preferred_username",
  },
  gitlab: {
    tokenOrigin: "https://gitlab.com",
    tokenPath: "/oauth/token",
    identityOrigin: "https://gitlab.com",
    identityPath: "/api/v4/user",
    identity: { id: 4242, username: "octocat", avatar_url: "https://gitlab.example/4242.png" },
    account: { username: "octocat", avatar: "https://gitlab.example/4242.png", provider: "gitlab" },
    providerUserId: "4242",
    usernameKey: "username",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

const reached = new Map<string, boolean>();
let requireAllMocks = true;

/**
 * Every test file starts from an empty database and an outbound fetch that only answers mocks.
 * requireAllMocks: false is for tests that register a mock the correct code must never reach.
 */
export function useWorker(options: { requireAllMocks?: boolean } = {}): void {
  requireAllMocks = options.requireAllMocks ?? true;
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    network.configure({ onUnhandledFrame: "error" });
    await network.enable();
  });
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions"),
      env.DB.prepare("DELETE FROM users"),
      env.DB.prepare("DELETE FROM signin_states"),
    ]);
    reached.clear();
  });
  afterEach(() => {
    if (requireAllMocks) {
      const unused = [...reached].filter(([, hit]) => !hit).map(([label]) => label);
      expect(unused, "every registered provider mock must be reached").toEqual([]);
    }
    network.resetHandlers();
  });
  afterAll(async () => {
    await network.disable();
  });
}

function mark(label: string): void {
  reached.set(label, true);
}

export function get(path: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

export function post(path: string, headers: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { method: "POST", redirect: "manual", headers });
}

export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

export function cookieValue(response: Response, name: string): string | null {
  for (const value of setCookies(response)) {
    if (value.startsWith(`${name}=`)) return value.slice(name.length + 1).split(";")[0] ?? "";
  }
  return null;
}

/** The Cookie header a browser would send back, dropping cookies the response expired. */
export function jar(...responses: Response[]): string {
  const kept = new Map<string, string>();
  for (const response of responses) {
    for (const value of setCookies(response)) {
      const pair = value.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const contents = pair.slice(separator + 1);
      if (contents === "") kept.delete(name);
      else kept.set(name, contents);
    }
  }
  return [...kept].map(([name, contents]) => `${name}=${contents}`).join("; ");
}

export interface Started {
  response: Response;
  state: string;
  verifier: string;
  challenge: string;
  next: string;
  cookie: string;
}

export async function startSignIn(name: ProviderName, next?: string): Promise<Started> {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = await get(`/auth/${name}/start${query}`);
  const cookie = jar(response);
  const raw = cookieValue(response, "__Host-kalsa_oauth") ?? "";
  const separator = raw.lastIndexOf(".");
  const payload = raw.slice(0, separator);
  // Decoding blindly would read a forged cookie as if it were genuine: verify it the way the Worker does.
  if (!(await verify(payload, raw.slice(separator + 1), env.SESSION_HMAC_KEY))) {
    throw new Error("the sign-in cookie is not signed with the test key");
  }
  const decoded = JSON.parse(decodeBase64Url(payload) ?? "{}") as Record<string, string>;
  const location = new URL(response.headers.get("Location") ?? "");
  return {
    response,
    cookie,
    state: decoded.state ?? "",
    verifier: decoded.verifier ?? "",
    next: decoded.next ?? "",
    challenge: location.searchParams.get("code_challenge") ?? "",
  };
}

export function callbackUrl(name: ProviderName, state: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ code: "provider-code", state, ...extra });
  return `/auth/${name}/callback?${query.toString()}`;
}

/** Records the form body of the token request, so a test can assert the verifier was sent. */
export function mockToken(name: ProviderName, token: string): string[] {
  const spec = PROVIDERS[name];
  const bodies: string[] = [];
  const label = `token:${name}`;
  reached.set(label, false);
  network.use(
    http.post(`${spec.tokenOrigin}${spec.tokenPath}`, async ({ request }) => {
      mark(label);
      bodies.push(await request.text());
      return HttpResponse.json({ access_token: token, token_type: "bearer" });
    }),
  );
  return bodies;
}

export function mockTokenFailure(name: ProviderName, status: number, body: unknown): void {
  const spec = PROVIDERS[name];
  const label = `token-failure:${name}`;
  reached.set(label, false);
  network.use(
    http.post(`${spec.tokenOrigin}${spec.tokenPath}`, () => {
      mark(label);
      return typeof body === "string"
        ? new HttpResponse(body, { status, headers: { "Content-Type": "text/html" } })
        : HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
}

/** Records the Authorization header of the identity read, so a test can assert where the token went. */
export function mockIdentity(name: ProviderName, status = 200, body?: unknown): string[] {
  const spec = PROVIDERS[name];
  const authorization: string[] = [];
  const label = `identity:${name}`;
  reached.set(label, false);
  network.use(
    http.get(`${spec.identityOrigin}${spec.identityPath}`, ({ request }) => {
      mark(label);
      authorization.push(request.headers.get("Authorization") ?? "");
      return HttpResponse.json((body ?? spec.identity) as Record<string, unknown>, { status });
    }),
  );
  return authorization;
}

export async function signIn(name: ProviderName, next?: string) {
  const token = `provider-token-${name}-8c1f4b7d`;
  const bodies = mockToken(name, token);
  const authorization = mockIdentity(name);
  const started = await startSignIn(name, next);
  const response = await get(callbackUrl(name, started.state), started.cookie);
  return { token, bodies, authorization, started, response };
}

export async function rows(table: "users" | "sessions" | "signin_states"): Promise<unknown[]> {
  const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
  return result.results;
}
