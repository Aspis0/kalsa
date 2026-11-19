import { pkceChallenge, randomToken, signingKeyUsable } from "../crypto";
import { addressKey, withinLimit } from "../limits";
import { credentials } from "../providers";
import type { Provider } from "../providers/types";
import { safeNext } from "../redirect";
import { failure, redirect } from "../respond";
import { nowSeconds } from "../session";
import { rememberState } from "../signin-states";
import { STATE_TTL_SECONDS, stateCookie } from "../state";

const STARTS_PER_ADDRESS = 60;

/**
 * A sign-in starts as a top-level navigation, which means `Sec-Fetch-Dest: document`. An iframe
 * sends `Dest: iframe` with `Mode: navigate`, so the mode alone is not enough. A subresource is
 * refused before it writes a state row or touches a counter, so an embedded flood cannot lock a real
 * visitor out. A client that sends no Fetch metadata at all (curl, an older browser) stays counted.
 */
function isNavigation(request: Request): boolean {
  const dest = request.headers.get("Sec-Fetch-Dest");
  const mode = request.headers.get("Sec-Fetch-Mode");
  if (dest === null && mode === null) return true;
  return dest === "document";
}

export async function start(request: Request, env: Env, provider: Provider): Promise<Response> {
  if (!signingKeyUsable(env.SESSION_HMAC_KEY)) return failure(503, "Sign-in is not configured.");
  const url = new URL(request.url);
  const { clientId, clientSecret } = credentials(env, provider.id);
  if (!clientId || !clientSecret) return failure(503, `Sign-in with ${provider.label} is not set up yet.`);
  if (!isNavigation(request)) return failure(403, "Sign-in must be opened as a page, not embedded in another page.");

  const now = nowSeconds();
  // Each start writes a state row, so an unauthenticated flood is a database write budget attack.
  if (!(await withinLimit(env.DB, `start:ip:${await addressKey(request, env.SESSION_HMAC_KEY)}`, STARTS_PER_ADDRESS, now))) {
    return failure(429, "Too many sign-in attempts from this address. Try again later.");
  }
  const expiresAt = now + STATE_TTL_SECONDS;
  const state = randomToken();
  const verifier = randomToken();
  await rememberState(env.DB, provider.id, state, expiresAt, now);
  const cookie = await stateCookie(
    {
      provider: provider.id,
      state,
      verifier,
      next: safeNext(url.searchParams.get("next")),
      expiresAt,
    },
    env.SESSION_HMAC_KEY,
  );

  const location = provider.authorize({
    clientId,
    redirectUri: `${env.SITE_ORIGIN}/auth/${provider.id}/callback`,
    state,
    challenge: await pkceChallenge(verifier),
  });
  return redirect(location, [cookie]);
}
