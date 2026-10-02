/**
 * The final safety pass EVERY accepted report line goes through, whatever its
 * source: deny-word drop, URL query/fragment strip, IP and home-path
 * redaction, 300-char clip, ISO timestamp prefix. Defense in depth on top of
 * the schema — a validated field still walks out through here.
 */

const DENY_WORDS = [
  "got exception",
  "last read",
  "parse_error",
  "json.exception",
  "api_keys:",
  "old: ",
  "new: ",
] as const;

const MAX_LINE_CHARS = 300;

function stripUrlQueryAndFragment(line: string): string {
  return line.replace(/https?:\/\/[^\s"']+/g, (url) => url.split(/[?#]/)[0]);
}

function redactText(line: string): string {
  return (
    line
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
      .replace(
        /\b(?:[0-9A-Fa-f]{1,4}:){6,7}[0-9A-Fa-f]{1,4}\b|\b[0-9A-Fa-f]{0,4}::(?:[0-9A-Fa-f]{1,4}:?){0,6}\b/g,
        "<ip6>",
      )
      .replace(/\/Users\/[A-Za-z0-9._-]+/g, "/Users/<user>")
      .replace(/\/home\/[A-Za-z0-9._-]+/g, "/home/<user>")
      .replace(/\/data\/user\/\d+\/[A-Za-z0-9._]+/g, "/data/user/<n>/<pkg>")
  );
}

/** The one line builder: null means the line is dropped entirely. */
export function finalizeLine(line: string): string | null {
  const lower = line.toLowerCase();
  for (const word of DENY_WORDS) {
    if (lower.includes(word)) return null;
  }
  const redacted = redactText(stripUrlQueryAndFragment(line));
  const clipped =
    redacted.length > MAX_LINE_CHARS ? redacted.slice(0, MAX_LINE_CHARS) : redacted;
  return `${new Date().toISOString()} ${clipped}`;
}
