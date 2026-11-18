import { pkceChallenge, randomToken, signingKeyUsable } from "../crypto";
import { credentials } from "../providers";
import type { Provider } from "../providers/types";
import { safeNext } from "../redirect";
import { failure, redirect } from "../respond";
import { nowSeconds } from "../session";
import { rememberState } from "../signin-states";
import { STATE_TTL_SECONDS, stateCookie } from "../state";

export async function start(request: Request, env: Env, provider: Provider): Promise<Response> {
  if (!signingKeyUsable(env.SESSION_HMAC_KEY)) return failure(503, "Sign-in is not configured.");
  const url = new URL(request.url);
  const { clientId, clientSecret } = credentials(env, provider.id);
  if (!clientId || !clientSecret) return failure(503, `Sign-in with ${provider.label} is not set up yet.`);

  const now = nowSeconds();
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
