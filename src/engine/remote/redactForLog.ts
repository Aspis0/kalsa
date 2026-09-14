/**
 * Redaction for text that came off the network and is about to be logged.
 *
 * # Defence in depth, never the boundary
 *
 * Enumerating the shapes a secret can take is a game we lose on the next input.
 * An earlier version of this file missed all five of these:
 *
 * ```text
 * {"outer":{"token":"SECRET"}}            JSON quoting
 * {"access_token":"SECRET"}               `_` is a word character, so `\btoken\b`
 *                                         never matched inside it
 * https://host/path#access_token=SECRET   the fragment was not cleared
 * HTTPS://host/?access_token=SECRET       the URL pattern had no `i` flag
 * Authorization: Basic "SECRET"           a quoted scheme value
 * ```
 *
 * So the boundary is upstream: the transport logs a bounded, structured subset it
 * chooses — a code, a byte count, a truncated excerpt — instead of arbitrary
 * server text. What is left here is a second line over content that is already
 * restricted, and the shapes above are its tests.
 */
import { redactUrl } from "./remoteUrl";

/**
 * A URL, with any punctuation that followed it kept as it was. Case-insensitive:
 * an uppercase scheme is still a URL.
 */
const URL = /(https?:\/\/[^\s"'<>]*[^\s"'<>.,;:!?)])([.,;:!?)]*)/gi;
/** `Bearer …` / `Basic …`, quoted or not: the scheme stays, the value does not. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+\S+/gi;
/**
 * A label ending in token/key/secret/password/authorization — bare (`token`) or
 * suffixed (`access_token`, `api_key`) — followed by `:` or `=`, optionally
 * inside JSON quotes, and a value. The character before the label must not be a
 * word character, so `monkey` is not a key.
 */
const CREDENTIAL =
  /(^|[^A-Za-z0-9_])((?:[A-Za-z0-9]+_)*(?:token|secret|password|key|authorization))(["']?\s*[:=]\s*["']?)(?!\[redacted\])(?!Bearer\b)(?!Basic\b)([^\s"',;}]+)/gi;
/** Vendor-shaped keys, which need no label to be recognised. */
const OPAQUE_KEY = /\b(?:sk|pk|ghp|gho|glpat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g;

export function redactForLog(text: string): string {
  return text
    .replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} [redacted]`)
    .replace(URL, (_match, url: string, tail: string) => `${redactUrl(url)}${tail}`)
    .replace(
      CREDENTIAL,
      (_match, before: string, name: string, separator: string) =>
        `${before}${name}${separator}[redacted]`,
    )
    .replace(OPAQUE_KEY, "[redacted]");
}
