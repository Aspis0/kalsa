export type ProviderId = "github" | "huggingface" | "gitlab";

/** The public identity read once at sign-in. No token, no email, no scope list. */
export interface Identity {
  providerUserId: string;
  username: string;
  avatarUrl: string | null;
}

export interface AuthorizeInput {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

export interface TokenInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  authorize(input: AuthorizeInput): string;
  /** Resolves to the access token, which the caller spends on one identity read and then drops. */
  exchange(input: TokenInput): Promise<string>;
  identity(token: string): Promise<Identity>;
}
