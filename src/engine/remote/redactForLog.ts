/**
 * Redaction for anything that came off the network and is about to be logged.
 *
 * The log has to keep enough to diagnose ("the server said: model not found"),
 * but a hostile or misconfigured server can quote back a URL carrying a token in
 * its query, a bearer header, or a bare API key. Those never reach logcat.
 */
import { redactUrl } from "./remoteUrl";

/** A URL, with any punctuation that followed it kept as it was. */
const URL = /(https?:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)])([.,;:!?)]*)/g;
/** `Bearer <token>` / `Basic <base64>`: the scheme stays, the value does not. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
/**
 * `token=…`, `api_key: …`, `authorization: …`. The value must not already be a
 * redaction (or a scheme) or the second pass would eat the first one's label.
 */
const CREDENTIAL =
  /\b(token|api[-_]?key|authorization|secret|password)\b(\s*[:=]\s*|\s+)(?!\[redacted\])(?!Bearer\b)(?!Basic\b)([^\s"',;]+)/gi;
/** Vendor-shaped keys, which need no label to be recognised. */
const OPAQUE_KEY = /\b(?:sk|pk|ghp|gho|glpat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g;

export function redactForLog(text: string): string {
  return text
    .replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} [redacted]`)
    .replace(URL, (_match, url: string, tail: string) => `${redactUrl(url)}${tail}`)
    .replace(
      CREDENTIAL,
      (_match, name: string, separator: string) => `${name}${separator}[redacted]`,
    )
    .replace(OPAQUE_KEY, "[redacted]");
}
