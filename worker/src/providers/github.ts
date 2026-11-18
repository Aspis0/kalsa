import { accessToken, bearerJson, optionalString, postForm, requireId, requireString } from "./http";
import type { Identity, Provider } from "./types";

// Authorize, token and identity endpoints, and the S256 PKCE parameters:
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
// Token error bodies (bad_verification_code and friends):
// https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export const github: Provider = {
  id: "github",
  label: "GitHub",

  authorize(input) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    // No scope parameter: the public identity is all sign-in reads.
    return url.toString();
  },

  async exchange(input) {
    const payload = await postForm(TOKEN_URL, {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    });
    return accessToken(payload);
  },

  async identity(token): Promise<Identity> {
    const payload = await bearerJson(USER_URL, token);
    return {
      providerUserId: requireId(payload, "id"),
      username: requireString(payload, "login"),
      avatarUrl: optionalString(payload, "avatar_url"),
    };
  },
};
