/**
 * Admission: a request gets past the secret only with the right host, the https
 * scheme and a matching key for its own scope. Every request runs exactly one key
 * comparison, and any failure on the way rejects instead of throwing.
 */
import { PLACEHOLDER, keyMatches, usableSecret } from "./keys";
import { ZONE_HOST, parseRoute, type Route } from "./routes";

export type Secrets = { LINK_KEY?: string; UPDATE_KEY?: string };
/** `key` is the validated secret of the route's scope. */
export type Admission = { route: Route; key: string };

export async function admit(requestUrl: string, secrets: Secrets): Promise<Admission | null> {
  try {
    const url = new URL(requestUrl);
    const host = url.hostname.replace(/\.$/, "");
    const parsed = host === ZONE_HOST && url.protocol === "https:" ? parseRoute(url.pathname) : null;
    const secret = parsed?.scope === "update" ? secrets.UPDATE_KEY : secrets.LINK_KEY;
    const key = usableSecret(secret);
    const matched = await keyMatches(secret, parsed?.candidate ?? PLACEHOLDER);
    if (parsed === null || key === null || !matched) return null;
    return { route: parsed.route, key };
  } catch {
    return null;
  }
}
