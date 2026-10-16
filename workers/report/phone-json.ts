/**
 * How a single line is scrubbed, and why not always by its raw text.
 *
 * The gate validates a phone line by **parsing** its payload
 * (`phone-body.ts`: `parsesAsJson`), but the pass used to scan the raw text and
 * the raw text is what gets stored. Those are three views of one line, and any
 * JSON escape the scanner does not decode hides a token from it:
 * `{"m":"marco@example.com"}` stores verbatim and decodes to the address.
 *
 * So for those lines the payload is parsed, every string **value** and every
 * object **key** is scrubbed in its decoded form, and the line is rebuilt from
 * `JSON.stringify`. What is stored is then the text that was scanned: no escape
 * can put a token in front of the pass and then decode itself out of what the
 * pass approved. It also ends a different failure: the raw scan used to start a
 * match *inside* an escape and leave the backslash behind, storing
 * `{"m":"marco\<email>"}`, which no reader can parse.
 *
 * Percent-encoding gets the same treatment on both paths. `marco%40example.com`
 * and `https%3A%2F%2Fx.io%2Fp%3Ftoken%3Dabc` hide the trigger character from
 * every rule; a reader that decodes them sees the address and the query. The
 * decoded form is scanned too, and stored only when it is what redacted
 * something — so text that decodes to itself or to nothing sensitive is left
 * exactly as it arrived.
 */

import { jsonPayloadOf } from "./phone-body";
import { redactLine, type LinePass } from "./redact";

const CH_PERCENT = 37;
const CH_0 = 48;
const CH_9 = 57;
const CH_a_LOWER = 97;
const CH_f_LOWER = 102;
const CH_A_UPPER = 65;
const CH_F_UPPER = 70;
const CH_u_LOWER = 117;

/** The value of one `%XX` hex digit, or -1. */
function hexDigit(code: number): number {
  if (code >= CH_0 && code <= CH_9) return code - CH_0;
  if (code >= CH_a_LOWER && code <= CH_f_LOWER) return code - CH_a_LOWER + 10;
  if (code >= CH_A_UPPER && code <= CH_F_UPPER) return code - CH_A_UPPER + 10;
  return -1;
}

/** The index of the next `%XX` this pass will decode, or -1. */
function escapeAt(text: string, from: number): number {
  for (let i = from; i + 2 < text.length; i += 1) {
    if (text.charCodeAt(i) !== CH_PERCENT) continue;
    const hi = hexDigit(text.charCodeAt(i + 1));
    const lo = hexDigit(text.charCodeAt(i + 2));
    if (hi < 0 || lo < 0) continue;
    const byte = hi * 16 + lo;
    // A control stays encoded: decoding one would write a literal newline or a
    // NUL into the middle of a stored line, which is a fidelity loss and a way
    // to split one report line into two.
    // A space stays encoded too: decoded, `user%3Apass%20word%40host` splits its
    // password at the space and the credential walk stops there; encoded, the
    // whole userinfo is one run and goes as `<cred>`.
    if (byte <= 0x20 || byte === 0x7f) continue;
    // A `%` stays encoded too: decoding `%25` peels one layer of double-encoding,
    // so a second screen of the same stored text would change it again.
    // `<` and `>` stay encoded: decoded, `%3Cip%3E` stores `<ip>`, which looks
    // like one of our own markers.
    if (byte === CH_PERCENT || byte === 0x3c || byte === 0x3e) continue;
    return i;
  }
  return -1;
}

/**
 * `%XX` decoded to the byte it names; everything else, including a `%` that
 * starts nothing valid, is left exactly as it is.
 *
 * Each escape becomes one code unit rather than a UTF-8 sequence, so a
 * multi-byte name decodes to several — all of them above 0x80, which every
 * name and address rule already treats as a word character. That is enough to
 * find the token, which is all this is for.
 */
export function percentDecode(text: string): string {
  const first = escapeAt(text, 0);
  if (first === -1) return text;
  const parts: string[] = [text.slice(0, first)];
  let i = first;
  for (;;) {
    const at = escapeAt(text, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    parts.push(text.slice(i, at));
    parts.push(
      String.fromCharCode(
        hexDigit(text.charCodeAt(at + 1)) * 16 + hexDigit(text.charCodeAt(at + 2)),
      ),
    );
    i = at + 3;
  }
  return parts.join("");
}

/**
 * A line that carries no JSON payload, scrubbed in two steps that **compose**:
 * the raw scan first, then the decoded scan over what it produced.
 *
 * Choosing between the two results instead — by which redacted more — was the
 * wrong shape. `https://user:pa%3Fss@host/` redacts once either way, but the raw
 * scan replaces the whole userinfo with `<cred>@` while the decoded scan sees a
 * `?` and stops at it, storing `https://user:pa<query>` with the username and a
 * password prefix still in it. A count cannot tell those apart.
 *
 * Composing cannot lose anything: the decode runs on the text the raw pass
 * already produced, and a marker holds no `%`, so what the first pass removed
 * stays removed. `https://user:pa%3Fss@host/` comes back from the first step
 * with no `%` left at all and is stored whole.
 *
 * Decoding happens once. A double-encoded token (`marco%2540example.com`, or a
 * `%5C` that decodes into `\u0040`) survives, which is a limit and not a claim.
 */
export function scrubPlainLine(line: string): LinePass {
  return refine(redactLine(line), percentDecode);
}

/**
 * One more view of a line that has already been scanned: `transform` runs on
 * the scanned text, never the original, so nothing the earlier pass removed can
 * come back. The transformed text is stored only when its scan found something
 * new; otherwise the earlier result stands as it was. A transform that finds
 * nothing must never change what is stored — decoded `%2540` or a stripped tab
 * would otherwise turn a line the old pass left alone into a different one, and
 * a token welded by the transform would lose a redaction it already had.
 */
function refine(pass: LinePass, transform: (text: string) => string): LinePass {
  const changed = transform(pass.text);
  if (changed === pass.text) return pass;
  const again = redactLine(changed);
  if (again.redactions === 0) return pass;
  return { text: again.text, redactions: pass.redactions + again.redactions };
}

/** One escape sequence resolved, as the text it stands for and its width. */
type Escape = { text: string; width: number };

/**
 * The escape at `at`, or null when there is none a JSON string could hold: an
 * unknown name, or one the line cut in half. A cut `\u00` at the end of a
 * truncated payload is left as it is rather than guessed at.
 */
function jsonEscapeAt(text: string, at: number): Escape | null {
  const next = text.charCodeAt(at + 1);
  if (Number.isNaN(next)) return null;
  if (next === CH_u_LOWER) {
    let value = 0;
    for (let k = 2; k < 6; k += 1) {
      const digit = hexDigit(text.charCodeAt(at + k));
      if (digit < 0) return null;
      value = value * 16 + digit;
    }
    return { text: String.fromCharCode(value), width: 6 };
  }
  const simple = escapeText(next);
  return simple === null ? null : { text: simple, width: 2 };
}

/** What `\` followed by this character means, or null if it means nothing. */
function escapeText(code: number): string | null {
  switch (code) {
    case 34:
      return '"';
    case 47:
      return "/";
    case 92:
      return "\\";
    case 98:
      return "\b";
    case 102:
      return "\f";
    case 110:
      return "\n";
    case 114:
      return "\r";
    case 116:
      return "\t";
    default:
      return null;
  }
}

/**
 * The escape sequences a JSON string carries, resolved wherever they appear.
 *
 * This is deliberately tolerant: it is used on payloads that do **not** parse,
 * where the point is not to produce valid JSON but to make sure a token cannot
 * sit behind a `\u0040` that a reader would decode. An unknown or half-cut
 * escape is left exactly as it is.
 *
 * A surrogate pair needs no special case: `\ud83d\ude00` is two escapes of six
 * characters each, and the two code units they produce are the pair.
 */
function unescapeJson(text: string): string {
  const first = text.indexOf("\\");
  if (first === -1) return text;
  const parts: string[] = [text.slice(0, first)];
  let i = first;
  while (i < text.length) {
    const at = text.indexOf("\\", i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    parts.push(text.slice(i, at));
    const escape = jsonEscapeAt(text, at);
    if (escape === null) {
      parts.push("\\");
      i = at + 1;
    } else {
      parts.push(escape.text);
      i = at + escape.width;
    }
  }
  return parts.join("");
}

/**
 * Code units that carry nothing a reader can see: the C0 controls, and the
 * format characters a browser, a terminal or a font will not draw.
 *
 * A token split across one of them — `10.0.0<NUL>.7`, `ma<ZWSP>rco@example.com`
 * — is two tokens to every rule and one to a human. They are removed from the
 * already-scanned text (`refine`), never before the first scan: removing a tab
 * first welds `<address>\tok` into one run that no longer matches.
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0xfeff
  );
}

/** TAB, LF, VT, FF, CR: invisible, but a separator a human reads as one. */
function isLayoutSpace(code: number): boolean {
  return code >= 9 && code <= 13;
}

/** Every invisible removed; the layout controls become `layout` ("" or " "). */
function replaceInvisible(text: string, layout: string): string {
  let first = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (isInvisible(text.charCodeAt(i))) {
      first = i;
      break;
    }
  }
  if (first === -1) return text;
  const parts: string[] = [];
  let kept = 0;
  for (let at = first; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (!isInvisible(code)) continue;
    if (at > kept) parts.push(text.slice(kept, at));
    if (isLayoutSpace(code)) parts.push(layout);
    kept = at + 1;
  }
  parts.push(text.slice(kept));
  return parts.join("");
}

/** `1.2.3.4\t10.0.0<NUL>.7`: the tab still separates, the NUL no longer splits. */
const spaceInvisible = (text: string): string => replaceInvisible(text, " ");
/** `marco\t@example.com`: the tab inside a token is removed like the rest. */
const stripInvisible = (text: string): string => replaceInvisible(text, "");

/** Spaced first, so a tab between two tokens keeps them apart; stripped second,
 *  for a tab inside one. Each step keeps its result only if it found more. */
function seeThroughInvisible(pass: LinePass): LinePass {
  return refine(refine(pass, spaceInvisible), stripInvisible);
}

type Tally = { redactions: number };

/**
 * One scrubbed string taken out of a phone payload, by whichever of the three
 * forms found something: the text as it is, its percent-decoded form, or both
 * with the invisible characters removed.
 *
 * The strip belongs here and not on a whole line: a desktop log separates its
 * fields with tabs, and joining those would cost more structure than the
 * characters are worth. Inside a JSON value there is no such separator.
 */
function scrubString(value: string, tally: Tally): string {
  const pass = refine(seeThroughInvisible(redactLine(value)), percentDecode);
  tally.redactions += pass.redactions;
  return pass.text;
}

/**
 * Every string in a parsed payload, keys included: `{"http://x": "…"}` is as
 * identifying as `{"u": "http://x"}`. Numbers, booleans and null pass through,
 * since no rule can match inside them.
 *
 * The recursion is bounded by the gate: it kept the line only if the payload
 * parsed, and it caps a phone line at 325 characters, so the depth here is
 * bounded by what fits in that — about 150 levels of `[` at worst.
 */
function scrubValue(value: unknown, tally: Tally): unknown {
  if (typeof value === "string") return scrubString(value, tally);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(scrubValue(item, tally));
    return out;
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    // A null prototype, because `JSON.parse` really can hand back a key named
    // `__proto__` and assigning one on a normal object goes to the prototype
    // setter — the entry vanished from the stored report.
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      out[scrubString(key, tally)] = scrubValue(source[key], tally);
    }
    return out;
  }
  return value;
}

/**
 * A phone line: its JSON payload is scrubbed through its decoded values and the
 * line rebuilt, so the bytes stored are the bytes that were scanned.
 *
 * A payload that does **not** parse is the other case, and it is the one the
 * attacker controls: the gate keeps a payload whose length is exactly the clip
 * ceiling whether or not it is valid, so the length alone can move a line onto
 * the raw-text path — and `\u0040` means nothing to a scanner reading raw text.
 * Those escapes are resolved tolerantly and the result is scrubbed and stored, so
 * a token cannot choose which path it is read on.
 *
 * Anything with no JSON payload at all — a `js_error` record, a desktop line —
 * goes through the raw text scan untouched.
 */
export function scrubPhoneLine(line: string): LinePass {
  const payload = jsonPayloadOf(line);
  if (payload === null) return scrubPlainLine(line);
  // The prefix — an ISO stamp and a `KALSA_TAG` — is left alone: both are fixed
  // shapes with nothing in them a rule could match.
  const head = line.slice(0, line.length - payload.length);
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    // The head holds no backslash, so unescaping the whole scanned line touches
    // only the payload.
    // Unescaped and cleaned in one step: `10.0.0\u200b.7` only becomes an
    // address once the escape is resolved AND the zero-width space is gone.
    const raw = redactLine(line);
    const opened = refine(
      refine(raw, (text) => spaceInvisible(unescapeJson(text))),
      (text) => stripInvisible(unescapeJson(text)),
    );
    return refine(opened, percentDecode);
  }
  const tally: Tally = { redactions: 0 };
  const scrubbed = scrubValue(value, tally);
  return { text: `${head}${JSON.stringify(scrubbed)}`, redactions: tally.redactions };
}