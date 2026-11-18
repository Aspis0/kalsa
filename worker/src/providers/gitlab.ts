import { accessToken, bearerJson, optionalString, postForm, requireId, requireString } from "./http";
import type { Identity, Provider } from "./types";

// Authorization code with PKCE, the authorize/token parameters and the Bearer call:
// https://docs.gitlab.com/api/oauth2/
// Current-user fields (id, username, avatar_url): https://docs.gitlab.com/api/users/
const AUTHORIZE_URL = "https://gitlab.com/oauth/authorize";
const TOKEN_URL = "https://gitlab.com/oauth/token";
const USER_URL = "https://gitlab.com/api/v4/user";

export const gitlab: Provider = {
  id: "gitlab",
  label: "GitLab",

  authorize(input) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read_user");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },

  async exchange(input) {
    const payload = await postForm(TOKEN_URL, {
      grant_type: "authorization_code",
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
      username: requireString(payload, "username"),
      avatarUrl: optionalString(payload, "avatar_url"),
    };
  },
};
