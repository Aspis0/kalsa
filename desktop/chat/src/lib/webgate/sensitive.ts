import { isValidIBAN } from "ibantools";
import { findPhoneNumbersInText } from "libphonenumber-js";
import type { GateFinding } from "./finding";
import { SECRET_RULES } from "./secretRules";

/**
 * Half one of the detector: single strings that are dangerous on their own,
 * found wherever they sit in the outgoing text — an IBAN is worth a louder
 * question whether or not it came out of an attachment.
 *
 * What is deliberately not here: national ID, tax and passport numbers have no
 * worldwide validator worth trusting, and a postal address is not one string
 * but six words in a row — that case belongs to half two (`copied.ts`), which
 * catches an address copied out of a document by construction. Paraphrase gets
 * through both halves; that limit was accepted, not oversold.
 */

interface Span {
  kind: string;
  from: number;
  to: number;
}

/** Specificity, for two findings that claim the same characters: the rarer
    shape wins, so a digit run that is both a card and a phone reads as a card. */
const PRIORITY = ["rule", "card", "iban", "phone", "email", "entropy"];

export function findSensitive(text: string): GateFinding[] {
  const spans: Span[] = [];
  pushIbans(text, spans);
  pushCards(text, spans);
  pushEmails(text, spans);
  pushPhones(text, spans);
  pushEntropy(text, spans);
  for (const rule of SECRET_RULES) {
    // Fresh RegExp per scan: the table's own regexes carry the `g` flag, and a
    // shared lastIndex would leak between two scans of one call.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      spans.push({ kind: rule.kind, from: m.index, to: m.index + m[0].length });
    }
  }
  spans.sort(
    (a, b) =>
      a.from - b.from ||
      b.to - b.from - (a.to - a.from) ||
      PRIORITY.indexOf(rank(a)) - PRIORITY.indexOf(rank(b)),
  );
  const kept: Span[] = [];
  for (const span of spans) {
    if (!kept.some((k) => span.from < k.to && k.from < span.to)) kept.push(span);
  }
  return kept.map((span) => ({ kind: span.kind, matched: text.slice(span.from, span.to) }));
}

function rank(span: Span): string {
  return span.kind === "IBAN"
    ? "iban"
    : span.kind === "payment card number"
      ? "card"
      : span.kind === "phone number"
        ? "phone"
        : span.kind === "email address"
          ? "email"
          : span.kind.startsWith("possible secret")
            ? "entropy"
            : "rule";
}

/** Candidates may carry the display spaces between groups — including the
    non-breaking and narrow non-breaking spaces a PDF or a word processor
    puts there; `\s` covers all of them in JavaScript. The mod-97 check
    decides, so a look-alike that only wears the shape is not reported. */
function pushIbans(text: string, spans: Span[]): void {
  const candidate = /\b[A-Za-z]{2}[0-9]{2}(?:\s?[A-Za-z0-9]){11,30}\b/g;
  for (let m = candidate.exec(text); m !== null; m = candidate.exec(text)) {
    if (isValidIBAN(m[0].replace(/\s/g, ""))) {
      spans.push({ kind: "IBAN", from: m.index, to: m.index + m[0].length });
    }
  }
}

/** Luhn, not a bare pattern: any sixteen digits would otherwise read as a
    card. 12–19 digits is the length range real cards span, and the separator
    between groups is whatever a document uses — space, hyphen, or the dots
    some statements print. */
function pushCards(text: string, spans: Span[]): void {
  const candidate = /\b(?:\d[ .\s-]?){10,24}\d\b/g;
  for (let m = candidate.exec(text); m !== null; m = candidate.exec(text)) {
    const digits = m[0].replace(/[ .\s-]/g, "");
    if (digits.length >= 12 && digits.length <= 19 && luhnOk(digits)) {
      spans.push({ kind: "payment card number", from: m.index, to: m.index + m[0].length });
    }
  }
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function pushEmails(text: string, spans: Span[]): void {
  const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  for (let m = email.exec(text); m !== null; m = email.exec(text)) {
    spans.push({ kind: "email address", from: m.index, to: m.index + m[0].length });
  }
}

/** The library finds numbers inside prose, worldwide, from the country code.
    A number written in one country's national shape, with no `+`, is ambiguous
    without guessing a country — those are not found, and that limit is stated
    here rather than papered over with a guessed default. */
function pushPhones(text: string, spans: Span[]): void {
  for (const found of findPhoneNumbersInText(text)) {
    spans.push({ kind: "phone number", from: found.startsAt, to: found.endsAt });
  }
}

/** The catch-all for a secret no rule names: gitleaks' own thresholds — a long
    hex run carries a secret above 3.0 bits per character, any long base64-ish
    run above 4.5. Ordinary words and identifiers sit well under both. Two
    shapes are quieted before the verdict, because a false "possible secret"
    on a plain order number is corrosive — it teaches the owner to click
    through, which is how this whole feature dies. A run built from six or
    fewer distinct characters is filler, not key material (six symbols top out
    at ~2.585 bits per character, under both thresholds, so skipping them adds
    no miss). And a SHORT all-digit run is an identifier someone typed or
    printed — an order number, a timestamp, an invoice — so it is quieted too,
    but only up to 24 digits: the numbers people write as identifiers all
    stop well below that (a millisecond timestamp is 13, a card 16–19 with
    its own Luhn detector, a 64-bit integer at most 20), while
    `01234567890123456789` (20 digits) is clearly one of theirs and
    `90718462530194728650317294058613` (32) is not something a person writes
    by hand — a numeric bearer token is exactly the machine-made shape the
    verdict exists for. */
function pushEntropy(text: string, spans: Span[]): void {
  const run = /[A-Za-z0-9+/=_-]{20,}/g;
  for (let m = run.exec(text); m !== null; m = run.exec(text)) {
    if (/^[0-9]{1,24}$/.test(m[0]) || new Set(m[0]).size <= 6) continue;
    const bits = bitsPerChar(m[0]);
    if (/^[0-9a-f]+$/i.test(m[0])) {
      if (bits >= 3.0) {
        spans.push({ kind: "possible secret (hex)", from: m.index, to: m.index + m[0].length });
      }
    } else if (bits >= 4.5) {
      spans.push({ kind: "possible secret", from: m.index, to: m.index + m[0].length });
    }
  }
}

function bitsPerChar(run: string): number {
  const counts = new Map<string, number>();
  for (const ch of run) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / run.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
