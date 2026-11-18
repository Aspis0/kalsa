/** An upstream refusal. The message never carries provider payload, so nothing secret reaches a log. */
export class ProviderError extends Error {}

export async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    // A redirect from a token endpoint is not an answer: never follow it off to another host.
    redirect: "manual",
  });
  const payload = await readJson(response);
  // GitHub answers 200 with an error body, so the body is checked as well as the status.
  if (!response.ok || typeof payload.error === "string") throw new ProviderError("the token request was refused");
  return payload;
}

export async function bearerJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "kalsa-site" },
    redirect: "manual",
  });
  if (!response.ok) throw new ProviderError("the identity request was refused");
  return readJson(response);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProviderError("the provider sent an unreadable answer");
  }
  return payload as Record<string, unknown>;
}

export function accessToken(payload: Record<string, unknown>): string {
  const token = payload.access_token;
  if (typeof token !== "string" || token === "") throw new ProviderError("the provider sent no access token");
  return token;
}

/** GitHub and GitLab send a numeric id, Hugging Face a string sub: both become the stored text id. */
export function requireId(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value !== "") return value;
  throw new ProviderError(`the provider sent no ${key}`);
}

export function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value === "") throw new ProviderError(`the provider sent no ${key}`);
  return value;
}

export function optionalString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}
