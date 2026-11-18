import { cookie, expiredCookie, readCookie } from "./cookies";
import { base64Url, decodeBase64Url, sign, verify } from "./crypto";
import type { ProviderId } from "./providers/types";

export const STATE_COOKIE = "__Host-kalsa_oauth";
export const STATE_TTL_SECONDS = 600;

export interface SignInState {
  provider: ProviderId;
  state: string;
  verifier: string;
  next: string;
  expiresAt: number;
}

export async function stateCookie(value: SignInState, secret: string): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(value)));
  return cookie(STATE_COOKIE, `${payload}.${await sign(payload, secret)}`, STATE_TTL_SECONDS);
}

export function clearStateCookie(): string {
  return expiredCookie(STATE_COOKIE);
}

/** absent: nothing to clear. unusable: present but forged or expired. live: a real attempt, which a refusal must not cancel. */
export type StateRead = { kind: "absent" } | { kind: "unusable" } | { kind: "live"; value: SignInState };

export async function readState(request: Request, secret: string, now: number): Promise<StateRead> {
  const raw = readCookie(request, STATE_COOKIE);
  if (!raw) return { kind: "absent" };
  const separator = raw.lastIndexOf(".");
  if (separator < 1) return { kind: "unusable" };
  const payload = raw.slice(0, separator);
  if (!(await verify(payload, raw.slice(separator + 1), secret))) return { kind: "unusable" };
  const decoded = decodeBase64Url(payload);
  const value = decoded === null ? null : parseState(decoded);
  if (!value || value.expiresAt <= now) return { kind: "unusable" };
  return { kind: "live", value };
}

function parseState(decoded: string): SignInState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const { provider, state, verifier, next, expiresAt } = record;
  if (typeof provider !== "string" || typeof state !== "string" || typeof verifier !== "string") return null;
  if (typeof next !== "string" || typeof expiresAt !== "number") return null;
  return { provider: provider as ProviderId, state, verifier, next, expiresAt };
}
