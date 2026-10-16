/**
 * The server-side redaction pass: a **second defense** behind the clients' own
 * log writers (`src/logReport/normalize.ts` on the phone,
 * `src-tauri/src/logging.rs` on the desktop), never a replacement for them.
 *
 * It runs on an unauthenticated 4 MiB body, so every rule is bounded and the
 * URL pass is a forward scan rather than a regex: a lazy `*?` over a repeated
 * `https://` is quadratic, and quadratic on an open POST is a CPU sink anyone
 * holding the URL can aim. The pass works line by line under a per-line cap,
 * so no rule — today or later — can cost more than a bounded scan of one line.
 *
 * It replaces what it recognises with fixed markers and counts the
 * replacements. It never logs, never returns what it removed, and leaves
 * anything it does not recognise alone.
 */

/**
 * The desktop's own per-line ceiling (`LINE_CHAR_CAP`, 8 KiB, in
 * `src-tauri/src/logging.rs` and `crates/kalsa-supervisor/src/stderr_log.rs`)
 * plus the ` …[truncated]` marker it appends. The phone clips at 300 chars
 * (`MAX_LINE_CHARS`), far below this. A longer line comes from neither client,
 * so it is dropped and counted rather than scanned.
 */
export const MAX_CLIENT_LINE_CHARS = 8 * 1024 + 16;

/**
 * Local part and each domain label carry the RFC 5321 length caps, which is
 * what makes a failing match cost O(1) per start position instead of
 * backtracking a whole run. A dotless domain is accepted: a tester typing
 * `marco@localhost` into a log is still an address.
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,9}/g;

const POSIX_USERS = /\/Users\/[A-Za-z0-9._-]+/g;
const POSIX_HOME = /\/home\/[A-Za-z0-9._-]+/g;
const ANDROID_DATA = /\/data\/user\/\d+\/[A-Za-z0-9._]+/g;

// Case-insensitive like the filesystem it lives on, and the name may hold
// spaces ("Marco Polo"): it ends at the first separator, colon or newline, so a
// profile segment goes and the sentence around it stays.
const WINDOWS_HOME = /([A-Za-z]:\\Users\\)[^\\/\r\n:]{1,64}/gi;

/**
 * The client's own IPv6 forms, which all need a `::` to anchor on. Unlike the
 * client's, a group is required before the `::`: the bare `::` in `std::io`
 * would otherwise be redacted out of a Rust error message, and it names
 * nothing.
 */
const IPV6_COMPRESSED =
  /\b(?:[0-9A-Fa-f]{1,4}:){6,7}[0-9A-Fa-f]{1,4}\b|\b[0-9A-Fa-f]{1,4}::(?:[0-9A-Fa-f]{1,4}:?){0,6}\b/g;

/** A leading `::` (`::1`, `[::1]:8080`) has no word boundary to anchor on, so
 *  it needs its own rule — and only after a space, a bracket or the line's
 *  first character, so a `::` inside a word is left alone. */
const IPV6_LEADING =
  /(?<=^|[\s(\[])::[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{0,4}){0,6}(?![0-9A-Fa-f:])/g;

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/**
 * Pass order matches both clients: URL, email, home paths, IP literals last.
 * The markers are the phone's own spellings, so a phone report reads the same
 * wherever it was redacted; the desktop uses `~`, `<addr>` and `?…` instead, and
 * the server does not reuse those (see the README). `<cred>@` is the desktop's
 * own spelling for URL credentials, which the phone has no rule for.
 *
 * Each rule declares a character it cannot match without, checked first. That
 * is a sound skip rather than a guess, and it is what keeps a real body cheap:
 * the email rule tries its 64-character local part at every position of a line
 * holding no `@` at all, and on a 4 MiB phone body that one rule costs more
 * than every other rule together.
 */
const RULES: readonly { trigger: RegExp; pattern: RegExp; marker: string }[] = [
  { trigger: /@/, pattern: EMAIL, marker: "<email>" },
  { trigger: /\//, pattern: POSIX_USERS, marker: "/Users/<user>" },
  { trigger: /\//, pattern: POSIX_HOME, marker: "/home/<user>" },
  { trigger: /\//, pattern: ANDROID_DATA, marker: "/data/user/<n>/<pkg>" },
  { trigger: /\\/, pattern: WINDOWS_HOME, marker: "$1<user>" },
  { trigger: /\./, pattern: IPV4, marker: "<ip>" },
  { trigger: /:/, pattern: IPV6_COMPRESSED, marker: "<ip6>" },
  { trigger: /::/, pattern: IPV6_LEADING, marker: "<ip6>" },
];

type Pass = { text: string; redactions: number };
export type Redaction = Pass & { dropped: number };

function apply(text: string, pattern: RegExp, marker: string): Pass {
  const hits = text.match(pattern);
  if (hits === null) return { text, redactions: 0 };
  return { text: text.replace(pattern, marker), redactions: hits.length };
}

/** A URL runs to whitespace or a bracket that a sentence may wrap it in. */
function endsUrl(c: string): boolean {
  return c <= " " || c === '"' || c === "'" || c === ")" || c === "]" || c === "}" || c === ">";
}

/** The next `http://` or `https://` at or after `from`. Every rejected `http`
 *  advances the search past itself, so a body of them stays linear. */
function nextScheme(text: string, from: number): number {
  let at = text.indexOf("http", from);
  while (at !== -1) {
    const rest = at + 4;
    if (text.startsWith("s://", rest) || text.startsWith("://", rest)) return at;
    at = text.indexOf("http", rest);
  }
  return -1;
}

/**
 * One forward scan per URL run, no backtracking. Mirrors the desktop's two
 * steps — the address stays, its query and fragment go whole, because a
 * signed redirect can carry a credential — and adds the credential span before
 * the path, which the desktop redacts and the phone has no rule for.
 */
function redactUrls(text: string): Pass {
  let out = "";
  let at = 0;
  let redactions = 0;
  let start = nextScheme(text, 0);
  while (start !== -1) {
    let end = start;
    while (end < text.length && !endsUrl(text[end])) end += 1;
    let cut = -1;
    for (let i = start; i < end; i += 1) {
      if (text[i] === "?" || text[i] === "#") {
        cut = i;
        break;
      }
    }
    const addressEnd = cut === -1 ? end : cut;
    const schemeEnd = text[start + 4] === "s" ? start + 8 : start + 7;
    const slash = text.indexOf("/", schemeEnd);
    const credSearch = slash !== -1 && slash < addressEnd ? slash : addressEnd;
    // The LAST '@' before the path: `user:pass@host/x` is one credential, and
    // an '@' after the first '/' belongs to the path, not the authority. Its
    // span runs back to the scheme, so `user:pass` goes whole and not just its
    // tail.
    const cred = text.lastIndexOf("@", credSearch - 1);
    if (cred >= schemeEnd + 1) {
      let credStart = cred;
      while (credStart > schemeEnd && !"?#/".includes(text[credStart - 1])) credStart -= 1;
      out += text.slice(at, credStart) + "<cred>@" + text.slice(cred + 1, addressEnd);
      redactions += 1;
    } else {
      out += text.slice(at, addressEnd);
    }
    if (cut !== -1) {
      out += "<query>";
      redactions += 1;
    }
    at = end;
    start = nextScheme(text, at);
  }
  return { text: out + text.slice(at), redactions };
}

function redactLine(line: string): Pass {
  const urls = redactUrls(line);
  let text = urls.text;
  let redactions = urls.redactions;
  for (const { trigger, pattern, marker } of RULES) {
    if (!trigger.test(text)) continue;
    const hit = apply(text, pattern, marker);
    text = hit.text;
    redactions += hit.redactions;
  }
  return { text, redactions };
}

export function redactText(text: string): Redaction {
  const kept: string[] = [];
  let redactions = 0;
  let dropped = 0;
  for (const line of text.split("\n")) {
    if (line.length > MAX_CLIENT_LINE_CHARS) {
      // No client writes one, and a line nobody clips is exactly the shape that
      // turns any rule into a cost. Counted as dropped, never stored.
      dropped += 1;
      continue;
    }
    const pass = redactLine(line);
    kept.push(pass.text);
    redactions += pass.redactions;
  }
  return { text: kept.join("\n"), redactions, dropped };
}