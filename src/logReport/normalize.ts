/**
 * The final safety pass EVERY accepted report line goes through, whatever its
 * source: deny-word drop, URL query/fragment strip, IP and home-path
 * redaction, a length cap, ISO timestamp prefix. Defense in depth on top of
 * the schema — a validated field still walks out through here. Two entry
 * points: free text is clipped, a schema-projected record is kept whole or
 * dropped (a clipped JSON record is not a record).
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

/** Free text longer than this is clipped. */
const MAX_LINE_CHARS = 300;
/** A schema-projected record (`TAG {json}`) longer than this is dropped whole. */
const MAX_RECORD_CHARS = 1024;

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

/** The deny-word drop and the redaction every line shares; null is a drop. */
function scrub(line: string): string | null {
  const lower = line.toLowerCase();
  for (const word of DENY_WORDS) {
    if (lower.includes(word)) return null;
  }
  return redactText(stripUrlQueryAndFragment(line));
}

function stamp(content: string): string {
  return `${new Date().toISOString()} ${content}`;
}

/** Free text: null means the line is dropped entirely, else it is clipped. */
export function finalizeLine(line: string): string | null {
  const redacted = scrub(line);
  if (redacted === null) return null;
  const clipped =
    redacted.length > MAX_LINE_CHARS ? redacted.slice(0, MAX_LINE_CHARS) : redacted;
  return stamp(clipped);
}

/** A schema-projected record: kept whole, or dropped. Never sliced, because a
 *  cut JSON line is invalid JSON and loses every field after the cut. */
export function finalizeRecord(record: string): string | null {
  const redacted = scrub(record);
  if (redacted === null || redacted.length > MAX_RECORD_CHARS) return null;
  return stamp(redacted);
}
