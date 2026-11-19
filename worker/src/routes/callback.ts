import { constantTimeEqual, signingKeyUsable } from "../crypto";
import { addressKey, withinLimit } from "../limits";
import { credentials } from "../providers";
import type { Identity, Provider } from "../providers/types";
import { failure, redirect } from "../respond";
import { nowSeconds, openSession } from "../session";
import { spendState } from "../signin-states";
import { clearStateCookie, readState } from "../state";
import { checkedIdentity, upsertUser } from "../users";

const INVALID = "This sign-in attempt is not valid, or it timed out. Start again.";
const CALLBACKS_PER_ADDRESS = 60;

export async function callback(request: Request, env: Env, provider: Provider): Promise<Response> {
  if (!signingKeyUsable(env.SESSION_HMAC_KEY)) return failure(503, "Sign-in is not configured.");
  const url = new URL(request.url);
  const address = await addressKey(request, env.SESSION_HMAC_KEY);
  if (!(await withinLimit(env.DB, `callback:ip:${address}`, CALLBACKS_PER_ADDRESS, nowSeconds()))) {
    return failure(429, "Too many sign-in attempts from this address. Try again later.");
  }
  const read = await readState(request, env.SESSION_HMAC_KEY, nowSeconds());
  if (read.kind === "absent") return failure(400, INVALID);
  if (read.kind === "unusable") return failure(400, INVALID, [clearStateCookie()]);

  const saved = read.value;
  const state = url.searchParams.get("state");
  // A refusal must not cancel an attempt that is still live: leave a cookie that is not this one alone.
  if (saved.provider !== provider.id || !state || !(await constantTimeEqual(state, saved.state))) {
    return failure(400, INVALID);
  }

  // Verified. The attempt is spent here, server-side first, so a replay finds no row.
  const clear = clearStateCookie();
  if (!(await spendState(env.DB, provider.id, saved.state))) return failure(400, INVALID, [clear]);
  if (url.searchParams.has("error")) return failure(400, `${provider.label} did not authorise the sign-in.`, [clear]);
  const code = url.searchParams.get("code");
  if (!code) return failure(400, "The sign-in answer carried no code. Start again.", [clear]);

  let identity: Identity;
  try {
    identity = await readIdentity(env, provider, code, saved.verifier);
  } catch {
    return failure(502, `${provider.label} did not complete the sign-in. Try again.`, [clear]);
  }

  const now = nowSeconds();
  const userId = await upsertUser(env.DB, provider.id, identity, now);
  const session = await openSession(env.DB, userId, now);
  // saved.next was allowlisted when the cookie was written, and the cookie is signed: no second filtering.
  return redirect(new URL(saved.next, env.SITE_ORIGIN).toString(), [session, clear]);
}

/** The token is spent on this one read and then dropped: never stored, logged or returned. */
async function readIdentity(env: Env, provider: Provider, code: string, verifier: string): Promise<Identity> {
  const { clientId, clientSecret } = credentials(env, provider.id);
  const token = await provider.exchange({
    clientId,
    clientSecret,
    code,
    redirectUri: `${env.SITE_ORIGIN}/auth/${provider.id}/callback`,
    verifier,
  });
  return checkedIdentity(await provider.identity(token));
}
