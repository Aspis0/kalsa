import { github } from "./github";
import { gitlab } from "./gitlab";
import { huggingface } from "./huggingface";
import type { Provider, ProviderId } from "./types";

const PROVIDERS: Record<ProviderId, Provider> = { github, huggingface, gitlab };

export function providerById(value: string): Provider | null {
  return value === "github" || value === "huggingface" || value === "gitlab" ? PROVIDERS[value] : null;
}

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export function credentials(env: Env, id: ProviderId): Credentials {
  switch (id) {
    case "github":
      return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
    case "huggingface":
      return { clientId: env.HF_CLIENT_ID, clientSecret: env.HF_CLIENT_SECRET };
    case "gitlab":
      return { clientId: env.GITLAB_CLIENT_ID, clientSecret: env.GITLAB_CLIENT_SECRET };
  }
}
