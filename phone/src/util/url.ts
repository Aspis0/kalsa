/**
 * Shared URL safety gate for anything that may call Linking.openURL.
 *
 * Hand-parsed instead of via `new URL()`: React Native ships a partial URL
 * polyfill whose `protocol` getter does not lowercase the scheme, and whose
 * constructor throws on some inputs (a '#' with no '://' hits
 * `undefined.includes`). Node and the device would therefore disagree, and the
 * harness would be validating a function the app never runs.
 */

/**
 * Invisible / format characters that can rewrite apparent URL authority
 * (e.g. zero-width space before `@`). Written as `\u` escapes only.
 */
const INVISIBLE_OR_FORMAT =
  /[\u00ad\u0085\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/;

/** True only when href has scheme exactly http or https (parsed, not substring). */
export function isSafeHttpUrl(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  // Raw whitespace and control characters are never valid in a URL.
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return false;
  // Zero-width / format chars: "https://example.com\u200b@evil.com" must fail.
  if (INVISIBLE_OR_FORMAT.test(trimmed)) return false;
  // Scheme grammar, RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
  const scheme = /^([a-zA-Z][a-zA-Z\d+\-.]*):/.exec(trimmed);
  if (!scheme) return false; // scheme-less ("example.com", "/path") is not tappable
  const proto = scheme[1].toLowerCase();
  if (proto !== "http" && proto !== "https") return false;
  // Require an authority, so "http:" alone or "https:evil" is not tappable either.
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/[^/?#]+/.test(trimmed);
}

/**
 * Normalize an http(s) URL for allowlist / source-ledger identity:
 * - trim, drop trailing `)` `,` `.` `;` artifacts
 * - scheme lowercased; host lowercased
 * - path + query case-sensitive
 * - drop `#fragment`
 * - drop a single trailing `/` on non-root paths (`/page/` ≡ `/page`;
 *   bare `https://host/` stays as `https://host/`)
 *
 * Returns null for non-strings / empty after trim.
 */
export function normalizeFetchUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  // Drop trailing punctuation / closing parens commonly glued to URLs in prose.
  while (s.length > 0 && /[),\.;]$/.test(s)) {
    s = s.slice(0, -1);
  }
  s = s.trim();
  if (!s) return null;

  const m = /^([a-zA-Z][a-zA-Z\d+\-.]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s);
  if (!m) {
    // Not a parseable absolute URL — best-effort key after trailing-punct strip.
    return s;
  }
  const scheme = m[1].toLowerCase();
  const authority = m[2];
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : "";
  const hostPort = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
  let path = m[3] ?? "";
  // Collapse trailing slash on non-root paths only.
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const query = m[4] ?? "";
  return `${scheme}://${userinfo}${hostPort}${path}${query}`;
}
