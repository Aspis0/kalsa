import { accessToken, bearerJson, optionalString, postForm, requireId, requireString } from "./http";
import type { Identity, Provider } from "./types";

// Scopes, public clients and the userinfo endpoint: https://huggingface.co/docs/hub/oauth
// Endpoint URLs and code_challenge_methods_supported ["S256"]:
// https://huggingface.co/.well-known/openid-configuration
const AUTHORIZE_URL = "https://huggingface.co/oauth/authorize";
const TOKEN_URL = "https://huggingface.co/oauth/token";
const USERINFO_URL = "https://huggingface.co/oauth/userinfo";

export const huggingface: Provider = {
  id: "huggingface",
  label: "Hugging Face",

  authorize(input) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile");
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
    const payload = await bearerJson(USERINFO_URL, token);
    return {
      providerUserId: requireId(payload, "sub"),
      username: requireString(payload, "preferred_username"),
      avatarUrl: optionalString(payload, "picture"),
    };
  },
};
