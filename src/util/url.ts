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
