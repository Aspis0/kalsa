/**
 * The server-side redaction pass: a **second defense** behind the clients' own
 * log writers (`src/logReport/normalize.ts` on the phone,
 * `src-tauri/src/logging.rs` on the desktop), never a replacement for them.
 *
 * It runs on an unauthenticated 4 MiB body, so it is one left-to-right scan per
 * line and no rule backtracks. The first version used one regex per class; on a
 * 4 MiB body of `a::` or `a.a@` those cost 100–210 ms each, and a regex per
 * class is also how a rule ends up quadratic without anyone noticing.
 *
 * "Bounded" is a property of each rule, not of the shape of the code. Most read
 * forward from the character that triggered them; the few that read backwards —
 * a credential, an address, a mail local part — are capped, and stop at the
 * token they are reading. That is the whole difference between this pass and the
 * quadratic one: an unbounded walk back to `://` made every `@` in a line cost
 * the prefix in front of it, which was forty seconds of CPU per request. So
 * `cost.test.ts` grows a body by making its **line** longer as well as by adding
 * lines, because a guard that only multiplies the line count is blind to exactly
 * that.
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

/** A scheme is ALPHA then ALPHA/DIGIT/`+`/`-`/`.` (RFC 3986), and the scheme
 *  itself is case-insensitive: `HTTPS://` is a URL exactly as `https://` is,
 *  and a filter that only knew the lowercase spelling was a bypass. */
const MAX_SCHEME_CHARS = 64;
/** A userinfo is short, and it holds no space: `https://u:p@h/`. The walk to it
 *  is capped so a body of `@` cannot make one walk the whole line for each of
 *  its characters. */
const MAX_CRED_CHARS = 256;
/** How far ahead an account name is read looking for the separator that closes
 *  it (`C:\Users\Marco Gualtieri\Documents`). */
const MAX_ACCOUNT_CHARS = 64;
/** RFC 5321 caps. Bounding both ends keeps a rejected `@` O(1). */
const MAX_LOCAL_CHARS = 64;
const MAX_LABEL_CHARS = 63;
const MAX_EMAIL_LABELS = 10;
/** An IPv6 group is at most four hex digits. */
const MAX_GROUP_CHARS = 4;
/**
 * The longest run either address form can be: eight groups of four hex digits
 * and seven colons is 39 characters, an IPv4 literal with a port is 21, and a
 * zone index sits past the run. A run longer than this cannot be an address, so
 * the parsers never see one and a body of `1:1:1:…` is walked once, not twice.
 */
const MAX_ADDRESS_CHARS = 64;

const MARK_EMAIL = "<email>";
const MARK_QUERY = "<query>";
const MARK_CRED = "<cred>@";
const MARK_IP = "<ip>";
const MARK_IP6 = "<ip6>";

const CH_HASH = 35;
const CH_PERCENT = 37;
const CH_COMMA = 44;
const CH_HYPHEN = 45;
const CH_DOT = 46;
const CH_SLASH = 47;
const CH_0 = 48;
const CH_9 = 57;
const CH_COLON = 58;
const CH_QUESTION = 63;
const CH_AT = 64;
const CH_UPPER_Z = 90;
const CH_BACKSLASH = 92;
const CH_UNDERSCORE = 95;
const CH_A_UPPER = 65;
const CH_F_UPPER = 70;
const CH_a_LOWER = 97;
const CH_f_LOWER = 102;
const CH_z_LOWER = 122;
const CH_TILDE = 126;
const CH_DOUBLE_QUOTE = 34;
const CH_APOSTROPHE = 39;
const CH_CLOSE_PAREN = 41;
const CH_OPEN_ANGLE = 60;
const CH_CLOSE_ANGLE = 62;
const CH_CLOSE_BRACKET = 93;
const CH_CLOSE_BRACE = 125;
const CH_NON_ASCII = 0x80;

function isAlphaCode(code: number): boolean {
  return (code >= CH_a_LOWER && code <= CH_z_LOWER) || (code >= CH_A_UPPER && code <= CH_UPPER_Z);
}
function isDigitCode(code: number): boolean {
  return code >= CH_0 && code <= CH_9;
}
function isHexCode(code: number): boolean {
  return (
    (code >= CH_0 && code <= CH_9) ||
    (code >= CH_a_LOWER && code <= CH_f_LOWER) ||
    (code >= CH_A_UPPER && code <= CH_F_UPPER)
  );
}
/**
 * A word character, and every code unit above ASCII is one.
 *
 * An account name and a mail local part are whatever the person typed, and a
 * rule that stopped the walk at the first non-ASCII character left the rest of
 * the name in the clear (`/Users/josé` stored as `/Users/<user>é`). Erring the
 * other way costs a little over-redaction and no leak. A surrogate pair is two
 * such code units, so it is covered by the same line.
 */
function isWordCode(code: number): boolean {
  return (
    code >= CH_NON_ASCII ||
    (code >= CH_0 && code <= CH_9) ||
    (code >= CH_A_UPPER && code <= CH_UPPER_Z) ||
    (code >= CH_a_LOWER && code <= CH_z_LOWER) ||
    code === CH_UNDERSCORE
  );
}
function isEmailLocalCode(code: number): boolean {
  return (
    isWordCode(code) ||
    code === CH_DOT ||
    code === CH_PERCENT ||
    code === 43 || // +
    code === CH_HYPHEN
  );
}
/** A label character: non-ASCII is allowed here too, for `marco@exämple.com`. */
function isDomainCode(code: number): boolean {
  return (
    code >= CH_NON_ASCII || isAlphaCode(code) || (code >= CH_0 && code <= CH_9) || code === CH_HYPHEN
  );
}
function isAccountCode(code: number): boolean {
  return isWordCode(code) || code === CH_DOT || code === CH_HYPHEN;
}
function isSchemeCode(code: number): boolean {
  return isAlphaCode(code) || (code >= CH_0 && code <= CH_9) || isExtraSchemeCode(code);
}
function isExtraSchemeCode(code: number): boolean {
  return code === 43 || code === CH_HYPHEN || code === CH_DOT;
}

/** A URL runs to whitespace or to a bracket a sentence may wrap it in. This is
 *  also what closes an open authority: everything past it is prose, and a
 *  credential, a query and a fragment all live inside the run. */
function endsUrlCode(code: number): boolean {
  return (
    code <= 32 ||
    code === CH_DOUBLE_QUOTE ||
    code === CH_APOSTROPHE ||
    code === CH_CLOSE_PAREN ||
    code === CH_CLOSE_BRACKET ||
    code === CH_CLOSE_BRACE ||
    code === CH_CLOSE_ANGLE ||
    code === CH_OPEN_ANGLE
  );
}

/** What ends an account name when no path separator closes it first: the same
 *  things that end a word in a sentence, so `C:\Users\marco logged out` keeps
 *  `logged out`. */
function endsNameCode(code: number): boolean {
  return (
    code <= 32 ||
    code === CH_DOUBLE_QUOTE ||
    code === CH_APOSTROPHE ||
    code === CH_COMMA ||
    code === CH_CLOSE_PAREN
  );
}

/**
 * What each character can start, one lookup per character. The scan below runs
 * on every character of the body, so deciding with a table beats a chain of
 * comparisons. The table covers every code unit a string can hold, so the loop
 * tests nothing before the lookup: non-ASCII is a zero row, which is also
 * correct, since no rule here can match one.
 */
const CLASS_URLISH = 1;
const CLASS_PATHISH = 2;
const CLASS_HEXISH = 4;
const CLASSES = new Uint8Array(65536);
for (let code = 0; code < 128; code += 1) {
  let bits = 0;
  if (code === CH_COLON || code === CH_QUESTION || code === CH_HASH || code === CH_AT) {
    bits |= CLASS_URLISH;
  }
  if (code === CH_SLASH || code === CH_BACKSLASH) bits |= CLASS_PATHISH;
  if (isHexCode(code)) bits |= CLASS_HEXISH;
  CLASSES[code] = bits;
}

// ── the match, carried in module state ───────────────────────────────────────
// A 4 MiB body of one shape produces millions of matches, and an object per
// match is the difference between meeting the cost budget and missing it. The
// helpers set these and return true; `swap` consumes them.
//
// This is only sound while every call from `redactText` down is synchronous: an
// `await` or a callback inside the pass would let a second body interleave and
// read the first one's writer. Nothing below awaits.

let mFrom = 0;
let mTo = 0;
let mMarker = "";
let wChunks: string[] = [];
let wAt = 0;
let wRun = "";
let wCount = 0;
let wRedactions = 0;

function flushRun(): void {
  if (wCount === 0) return;
  wChunks.push(wCount === 1 ? wRun : wRun.repeat(wCount));
  wCount = 0;
}

/** Copy up to the match, write its marker, count it. One call is one
 *  redaction, so the count cannot drift from what was replaced. */
function swap(line: string): void {
  if (mFrom > wAt) {
    flushRun();
    wChunks.push(line.slice(wAt, mFrom));
  } else if (wCount > 0 && mMarker !== wRun) {
    flushRun();
  }
  wRun = mMarker;
  wCount += 1;
  wAt = mTo;
  wRedactions += 1;
}

function matched(from: number, to: number, marker: string): boolean {
  mFrom = from;
  mTo = to;
  mMarker = marker;
  return true;
}

/** ASCII case-insensitive compare that allocates nothing: `toLowerCase()` per
 *  character is a cost that only shows up on a 4 MiB body. */
function foldEquals(line: string, at: number, text: string): boolean {
  if (at + text.length > line.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    let a = line.charCodeAt(at + i);
    let b = text.charCodeAt(i);
    if (a >= CH_A_UPPER && a <= CH_UPPER_Z) a += 32;
    if (b >= CH_A_UPPER && b <= CH_UPPER_Z) b += 32;
    if (a !== b) return false;
  }
  return true;
}

/** The end of the scheme before the `:` at `colonAt`, or -1. Bounded, so a
 *  body of `scheme` characters cannot make this walk quadratic. */
function schemeStart(line: string, colonAt: number): number {
  const limit = Math.max(0, colonAt - MAX_SCHEME_CHARS);
  let start = colonAt;
  while (start > limit && isSchemeCode(line.charCodeAt(start - 1))) start -= 1;
  if (start === colonAt || !isAlphaCode(line.charCodeAt(start))) return -1;
  return start;
}

/**
 * `user:pass@host` — the span before the `@` of an open authority, which the
 * desktop redacts and the phone has no rule for.
 *
 * Three stops, and each is load-bearing. The authority's end, because an `@`
 * further along the line belongs to prose. The URL run's end, because a
 * credential cannot hold a space. And the previous `@`, because the walk is to
 * one `@` only.
 *
 * A `.` is deliberately **not** one of them: `user:pa.ss@host` is a userinfo
 * whose password holds a dot, and stopping there stored `user:pa` in the clear.
 * The authority closing at the run's end is what bounds the walk, so nothing
 * needs a dot to stop it. `MAX_CRED_CHARS` still caps the walk itself — without
 * it a walk bounded only by the authority re-read the whole prefix for every
 * `@` in the line, and `http://h` followed by 8000 `@` was 40 seconds of CPU on a
 * 4 MiB body.
 */
function credentialAt(line: string, at: number, authorityFrom: number): boolean {
  const limit = Math.max(authorityFrom, at - MAX_CRED_CHARS);
  let from = at;
  while (from > limit) {
    const code = line.charCodeAt(from - 1);
    if (code === CH_QUESTION || code === CH_HASH || code === CH_SLASH) break;
    if (code === CH_AT || endsUrlCode(code)) break;
    from -= 1;
  }
  if (from === at) return false;
  // The cap stopped the walk rather than a token boundary. Redact from the start
  // of the authority in that case, so a userinfo longer than the cap cannot
  // leave its head in the clear — replacing the span costs nothing, only walking
  // it did.
  if (from === limit && limit > authorityFrom) from = authorityFrom;
  return matched(from, at + 1, MARK_CRED);
}

/** A dotless domain counts: `marco@localhost` in a log is still an address. */
function emailAt(line: string, at: number): boolean {
  const limit = Math.max(0, at - MAX_LOCAL_CHARS);
  let from = at;
  while (from > limit && isEmailLocalCode(line.charCodeAt(from - 1))) from -= 1;
  if (from === at) return false;
  let i = at + 1;
  let labels = 0;
  for (;;) {
    // A label starts with a letter, a digit or a non-ASCII character (RFC 1035
    // rules out a leading hyphen): on a body of `-@-` the looser rule matched an
    // email on every third character and paid for a million of them.
    const head = line.charCodeAt(i);
    if (!isDomainCode(head) || head === CH_HYPHEN) {
      if (labels === 0) return false;
      // `write to marco@example.com.` — the full stop ends the sentence, not
      // the domain: the address is what came before it.
      i -= 1;
      break;
    }
    let len = 0;
    while (i < line.length && len <= MAX_LABEL_CHARS && isDomainCode(line.charCodeAt(i))) {
      i += 1;
      len += 1;
    }
    if (len > MAX_LABEL_CHARS) return false;
    labels += 1;
    if (labels < MAX_EMAIL_LABELS && line.charCodeAt(i) === CH_DOT) {
      i += 1;
      continue;
    }
    break;
  }
  return matched(from, i, MARK_EMAIL);
}

function accountEnd(line: string, at: number): number {
  let i = at;
  while (i < line.length && isAccountCode(line.charCodeAt(i))) i += 1;
  return i;
}

/** Does the separator at `at` open another path rather than continue this one?
 *  `\\server\Users\marco and \\server\Users\anna` has no colon to give the rule
 *  its answer the way the drive form has, so the share and the drive letter are
 *  what separate one path from the next. */
function startsNewPath(line: string, at: number): boolean {
  const next = line.charCodeAt(at + 1);
  return next === CH_BACKSLASH || (isAlphaCode(next) && line.charCodeAt(at + 2) === CH_COLON);
}

/**
 * The end of an account name in `C:\Users\…` or `\\server\Users\…`.
 *
 * A Windows profile segment may hold a space, so the name cannot simply stop at
 * the first one — `C:\Users\Marco Gualtieri\Documents` has to read as the name
 * `Marco Gualtieri` followed by a path. It ends at the separator that closes
 * the segment, and the separator only counts when it arrives before any `:` or
 * newline and does not itself open another path: in
 * `C:\Users\marco and C:\Users\anna` that colon comes first, so the name stops
 * at the space and both names are redacted. With neither in reach,
 * `C:\Users\marco logged out`, the name ends at the first character that ends a
 * word in a sentence.
 */
function accountNameEnd(line: string, nameFrom: number): number {
  const limit = Math.min(line.length, nameFrom + MAX_ACCOUNT_CHARS);
  let word = -1;
  for (let i = nameFrom; i < limit; i += 1) {
    const code = line.charCodeAt(i);
    if (code === CH_BACKSLASH || code === CH_SLASH) {
      if (!startsNewPath(line, i)) return i;
      return word === -1 ? i : word;
    }
    if (code === CH_COLON || code === 10 || code === 13) return word === -1 ? i : word;
    if (word === -1 && endsNameCode(code)) word = i;
  }
  return word === -1 ? limit : word;
}

/** The client's own markers, so a phone report reads the same wherever it was
 *  redacted. The Windows form keeps its drive letter and a UNC form keeps its
 *  server; the account name is bounded by `accountNameEnd`. */
function pathAt(line: string, at: number): boolean {
  if (line.charCodeAt(at) === CH_SLASH) {
    // The second character picks the prefix: on a body full of slashes, every
    // other call ends here.
    const d = line.charCodeAt(at + 1);
    if (d === 85) {
      // The account character is tested before the prefix: on a body of
      // `/Users//Users/…` it rejects every candidate without the compare.
      if (!isAccountCode(line.charCodeAt(at + 7)) || !line.startsWith("/Users/", at)) return false;
      return matched(at, accountEnd(line, at + 7), "/Users/<user>");
    }
    if (d === 104) {
      if (!isAccountCode(line.charCodeAt(at + 6)) || !line.startsWith("/home/", at)) return false;
      return matched(at, accountEnd(line, at + 6), "/home/<user>");
    }
    if (d === 100) {
      let i = at + 11;
      const digits = i;
      while (i < line.length && line.charCodeAt(i) >= CH_0 && line.charCodeAt(i) <= CH_9) i += 1;
      if (!line.startsWith("/data/user/", at) || i === digits || line.charCodeAt(i) !== CH_SLASH) {
        return false;
      }
      i += 1;
      if (!isAccountCode(line.charCodeAt(i))) return false;
      return matched(at, accountEnd(line, i), "/data/user/<n>/<pkg>");
    }
    return false;
  }
  // \\server\Users\ — the same directory reached as a share, and entered at
  // its leading separator.
  if (line.charCodeAt(at + 1) === CH_BACKSLASH) {
    let server = at + 2;
    while (server < line.length && isAccountCode(line.charCodeAt(server))) server += 1;
    if (server === at + 2 || !foldEquals(line, server, "\\Users\\")) return false;
    const nameFrom = server + 7; // past `\Users\`
    if (!isWordCode(line.charCodeAt(nameFrom))) return false;
    return matched(at, accountNameEnd(line, nameFrom), line.slice(at, nameFrom) + "<user>");
  }

  // C:\Users\ — case-insensitive like the filesystem it lives on, and entered
  // from the drive letter, which nothing else starts. The account character is
  // tested before the prefix: a read past the end of the line is NaN and every
  // comparison rejects it, so this is also the bounds check.
  const from = at + 9;
  if (
    !isWordCode(line.charCodeAt(from)) ||
    !foldEquals(line, at + 2, "\\Users\\") ||
    line.charCodeAt(at + 1) !== CH_COLON ||
    !isAlphaCode(line.charCodeAt(at))
  ) {
    return false;
  }
  return matched(at, accountNameEnd(line, from), line.slice(at, from) + "<user>");
}

/** Four octets of one to three digits, or -1. */
function ipv4From(line: string, from: number, end: number): number {
  let i = from;
  for (let group = 0; group < 4; group += 1) {
    const digits = i;
    while (i < end) {
      const code = line.charCodeAt(i);
      if (code < CH_0 || code > CH_9 || i - digits >= 3) break;
      i += 1;
    }
    if (i === digits || i - digits > 3) return -1;
    if (group < 3) {
      if (i >= end || line.charCodeAt(i) !== CH_DOT) return -1;
      i += 1;
    }
  }
  return i;
}

/**
 * The end of the IPv6 literal in `from..end`, zone index included.
 *
 * Every group must be hex digits, empty or a dotted quad, and the run must
 * carry either a `::` or four groups: that is what separates an address from
 * the `12:34:56` of a timestamp, and the word-boundary guard in `addressAt` is
 * what leaves `std::io::Error` alone. A compressed form is matched whole, so
 * `2001:db8::1` leaves no `2001:` behind.
 */
function ipv6End(line: string, from: number, end: number): number {
  let i = from;
  let colons = 0;
  let groups = 0;
  let compressed = false;
  let groupStart = -1; // where the group before a dot began
  while (i < end) {
    const code = line.charCodeAt(i);
    if (code === CH_COLON) {
      colons += 1;
      if (line.charCodeAt(i + 1) === CH_COLON) compressed = true;
      i += 1;
      continue;
    }
    if (code === CH_DOT) {
      // A dotted quad closes the address, and it starts at the digits before the
      // dot rather than at the dot: `::ffff:10.0.0.1`. A `:port` after it is
      // part of the address too, so an unbracketed `::ffff:10.0.0.1:8080` goes
      // whole rather than leaving the tail behind.
      if (groupStart < 0) return -1;
      const to = ipv4From(line, groupStart, end);
      if (to === -1) return -1;
      if (to !== end) {
        if (line.charCodeAt(to) !== CH_COLON) return -1;
        const port = to + 1;
        let p = port;
        while (p < end && line.charCodeAt(p) >= CH_0 && line.charCodeAt(p) <= CH_9) p += 1;
        if (p === port) return -1;
        i = p;
        groups += 2;
        continue;
      }
      groups += 2;
      i = to;
      continue;
    }
    const groupAt = i;
    while (i < end && i - groupAt < MAX_GROUP_CHARS && isHexCode(line.charCodeAt(i))) i += 1;
    if (i === groupAt) return -1;
    groups += 1;
    groupStart = groupAt;
  }
  if (colons < 2) return -1;
  if (!compressed && groups < 4) return -1;
  // An address ends in a group or in `::`, never in a lone `:` after a group.
  // Without this `1:a::C:` reads as an address and swallows the drive letter of
  // the `C:\Users\…` that follows it.
  if (line.charCodeAt(end - 1) === CH_COLON && line.charCodeAt(end - 2) !== CH_COLON) return -1;
  // A zone index names an interface, so it belongs to the address.
  if (line.charCodeAt(end) === CH_PERCENT) {
    let z = end + 1;
    while (z < line.length) {
      const code = line.charCodeAt(z);
      if (!isAlphaCode(code) && !(code >= CH_0 && code <= CH_9) && code !== CH_DOT && code !== CH_UNDERSCORE && code !== CH_TILDE && code !== CH_HYPHEN) {
        break;
      }
      z += 1;
    }
    if (z > end + 1) return z;
  }
  return end;
}

/**
 * The address in the run `from..end`, or null. Both forms are read as whole
 * runs: an IPv4 literal closed by the end of the run or by a `:port`, and an
 * IPv6 address including a compressed form or an embedded `::ffff:10.0.0.1`.
 *
 * The caller has already walked the run — this branch sees every hex character
 * in the body, and walking one twice is what a word like `deadbeef` must not pay.
 *
 * An address may not start straight after a `>`, because a marker ends in one:
 * that is what makes a second pass over our own output find nothing, since
 * `<email>::` would otherwise read as a bare `::` and become `<ip6>`. It may
 * *end* before one — `<10.0.0.1>` and `peer>10.0.0.1` are ordinary addresses, and
 * both clients redact them inside angle brackets.
 */
function addressAt(line: string, from: number, end: number): boolean {
  if (end - from > MAX_ADDRESS_CHARS) return false;
  const before = line.charCodeAt(from - 1);
  if (from > 0 && (isWordCode(before) || before === CH_DOT || before === CH_CLOSE_ANGLE)) {
    return false;
  }
  // An IPv4 literal that ends on a dot not followed by a digit stops there,
  // whatever the rest of the run holds (`10.0.0.7..2001:db8::1word`): the dot
  // is its boundary, so the far end of the run has no say.
  const four = ipv4From(line, from, end);
  if (four !== -1 && four < end && line.charCodeAt(four) === CH_DOT && !isDigitCode(line.charCodeAt(four + 1))) {
    return matched(from, four, MARK_IP);
  }
  const after = line.charCodeAt(end);
  // An angle bracket closes this guard too, on the far side of the run. The
  // marker case is `<email>::`, where the `<` is what precedes the address, but
  // the same reasoning runs the other way: an address that ends where a marker
  // begins (`[::<email>`) was refused on the first pass because a word character
  // followed it, and would be matched on the second.
  // A dot refuses only when a digit follows it: `1.2.3.4.5` is a version, while
  // `host 10.0.0.7.` and `10.0.0.7.nip.io` still carry the address.
  const dotContinues = after === CH_DOT && isDigitCode(line.charCodeAt(end + 1));
  if (after < 128 && (isWordCode(after) || dotContinues || after === CH_OPEN_ANGLE)) {
    return false;
  }

  if (four !== -1 && (four === end || line.charCodeAt(four) === CH_COLON)) {
    return matched(from, four, MARK_IP);
  }
  const six = ipv6End(line, from, end);
  return six !== -1 && matched(from, six, MARK_IP6);
}

export type Redaction = { text: string; redactions: number; dropped: number; truncated: boolean };

/** What scrubbing one line produced. Exported so a caller can scrub a line by
 *  another route than the raw text — see `phone-json.ts`. */
export type LinePass = { text: string; redactions: number };

export function redactLine(line: string): LinePass {
  // Collected and joined once: appending to a string per match costs a cons cell
  // each, and a body that is nothing but one shape has millions of matches.
  // The writer lives in module state with the match: a body of one shape has
  // millions of both, and neither may cost an object.
  wChunks = [];
  wAt = 0;
  wRun = "";
  wCount = 0;
  wRedactions = 0;
  // Open URL: the index just past `://`, and the first '/' of its path.
  let authorityFrom = -1;
  let urlPath = -1;

  let i = 0;
  const n = line.length;
  while (i < n) {
    // One table lookup decides whether this character can start anything at
    // all, which for most of a log it cannot.
    const code = line.charCodeAt(i);
    // An authority ends where its URL ends. Leaving it open for the rest of the
    // line is how `GET https://api.example.com failed, contact marco@example.com`
    // lost everything from the scheme to the `@`, and how a pathless URL left a
    // walk running over the whole line for each later `@`.
    if (authorityFrom !== -1 && endsUrlCode(code)) {
      authorityFrom = -1;
      urlPath = -1;
    }
    const cls = CLASSES[code];
    if (cls === 0) {
      i += 1;
      continue;
    }

    if (cls === CLASS_URLISH) {
      if (code === CH_COLON) {
        if (line.charCodeAt(i + 1) === CH_SLASH && line.charCodeAt(i + 2) === CH_SLASH) {
          if (schemeStart(line, i) !== -1) {
            authorityFrom = i + 3;
            urlPath = -1;
            i += 3;
            continue;
          }
        }
        // Not a scheme: a bare `:` still starts an address (`::1`), so it falls
        // through to the address walk below rather than being stepped over.
      } else if (code === CH_QUESTION || code === CH_HASH) {
        if (authorityFrom !== -1) {
          // The query and fragment go whole: a signed redirect can carry a
          // credential, and the address before them has been scanned already.
          // A `?` with nothing behind it in the URL's own run is prose — "see
          // https://example.com? yes" — and claiming a query there would be a
          // false marker over a sentence that is still there.
          let end = i + 1;
          while (end < n && !endsUrlCode(line.charCodeAt(end))) end += 1;
          authorityFrom = -1;
          urlPath = -1;
          if (end === i + 1) {
            i += 1;
            continue;
          }
          matched(i, end, MARK_QUERY);
          swap(line);
          i = end;
          continue;
        }
      } else if (code === CH_AT) {
        if (authorityFrom !== -1 && urlPath === -1) {
          if (credentialAt(line, i, authorityFrom)) {
            swap(line);
            i = mTo;
            continue;
          }
        }
        if (emailAt(line, i)) {
          swap(line);
          i = mTo;
          continue;
        }
        i += 1;
        continue;
      }
    } else if (cls & CLASS_PATHISH) {
      if (pathAt(line, i)) {
        swap(line);
        i = mTo;
        continue;
      }
      // The first '/' of an open URL's path closes its credential span.
      if (code === CH_SLASH && authorityFrom !== -1 && urlPath === -1) urlPath = i;
      i += 1;
      continue;
    }

    if ((cls & CLASS_HEXISH) !== 0 || code === CH_COLON) {
      // A drive letter is a hex character, so `C:\Users\…` is decided here and
      // not by the run below: nothing else starts with a letter and a colon.
      if (line.charCodeAt(i + 1) === CH_COLON && pathAt(line, i)) {
        swap(line);
        i = mTo;
        continue;
      }
      // The run is walked here on char codes: this branch runs on every hex
      // character in the body. `dotted` records the one thing both address
      // forms need, so an ordinary word skips the parsers entirely, and its
      // length keeps a 4 MiB line of `1:` out of the parsers as well.
      let end = i;
      let dotted = false;
      while (end < n) {
        const d = line.charCodeAt(end);
        if (d === CH_DOT) {
          dotted = true;
        } else if (d === CH_COLON) {
          // A `://` is the URL's, not the address's.
          if (line.charCodeAt(end + 1) === CH_SLASH && line.charCodeAt(end + 2) === CH_SLASH) break;
          dotted = true;
        } else if (!isHexCode(d)) {
          break;
        }
        end += 1;
      }
      // A full stop after the run is punctuation (`host 10.0.0.7.`), not a fifth
      // group: the address is tried without it.
      let addrEnd = end;
      while (addrEnd > i && line.charCodeAt(addrEnd - 1) === CH_DOT) addrEnd -= 1;
      if (dotted && addressAt(line, i, addrEnd)) {
        swap(line);
        i = mTo;
        continue;
      }
      // The run swallowed a drive letter (`1:a::C:\Users\…`), and stepping past
      // it would drop the profile name on the floor. The path rule is tried
      // here rather than by re-entering the loop on the letter, which would
      // walk this same run and parse it a second time. The `end - 2 > i` guard
      // is what keeps a run that starts on the letter from retrying for ever.
      if (
        end - 2 > i &&
        line.charCodeAt(end - 1) === CH_COLON &&
        isAlphaCode(line.charCodeAt(end - 2)) &&
        pathAt(line, end - 2)
      ) {
        swap(line);
        i = mTo;
        continue;
      }
      i = end > i ? end : i + 1;
      continue;
    }
    i += 1;
  }
  flushRun();
  const tail = line.slice(wAt);
  if (tail !== "") wChunks.push(tail);
  const text = wChunks.length === 1 ? wChunks[0] : wChunks.join("");
  return { text, redactions: wRedactions };
}

/**
 * Screen one body. `maxOutput` is the caller's own bound on what it can store.
 *
 * A marker is longer than what it replaces — `<cred>@` is seven characters for a
 * one-character match — so a body can grow while it is screened. Stopping at the
 * bound as we go is what keeps a 4 MiB body of `@a` from becoming 14 MB of
 * string first and a refusal second; the caller sees `truncated` and decides.
 *
 * `scrub` is how a single line is scrubbed, and it defaults to the raw text scan.
 * A phone line carrying JSON is scrubbed by its decoded values instead, through
 * `phone-json.ts`, because the bytes this pass stores have to be the bytes it
 * scanned.
 */
export function redactText(
  text: string,
  maxOutput: number,
  scrub: (line: string) => LinePass = redactLine,
): Redaction {
  const kept: string[] = [];
  let chars = 0;
  let redactions = 0;
  let dropped = 0;
  let truncated = false;
  for (const line of text.split("\n")) {
    if (line.length > MAX_CLIENT_LINE_CHARS) {
      // No client writes one, and a line nobody clips is exactly the shape that
      // turns any rule into a cost. Counted as dropped, never stored.
      dropped += 1;
      continue;
    }
    const pass = scrub(line);
    // The join adds one separator per line. It is charged to `chars` with the
    // line it separates, so the string handed back is never longer than
    // `maxOutput` — counting only the line text let the separators accumulate.
    if (chars + pass.text.length + 1 > maxOutput) {
      truncated = true;
      break;
    }
    kept.push(pass.text);
    chars += pass.text.length + 1;
    redactions += pass.redactions;
  }
  return { text: kept.join("\n"), redactions, dropped, truncated };
}