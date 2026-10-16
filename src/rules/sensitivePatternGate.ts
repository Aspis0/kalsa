/** Pure detection of sensitive patterns that must not reach network tools. */

const CREDENTIAL_LABEL_RE =
  /\b(password|passwd|pwd|passphrase|secret|segreto|token|api[_\s-]?key|apikey|bearer|authorization|auth[_\s-]?code|private[_\s-]?key|chiave\s+privata|otp|pin|cvv|cvc|security\s*code|codice\s*segreto)\b/gi;
// Compact IBAN, or print form in 4-character groups. Free-form "AB12 …" text
// with words after it is not an IBAN ("AB123456789 product details").
const IBAN_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,4})?)(?:$|[^A-Z0-9])/i;
const CF_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{6}\s*\d{2}\s*[A-Z]\s*\d{2}\s*[A-Z]\s*\d{3}\s*[A-Z](?:$|[^A-Z0-9])/i;
const CF_COMPACT_PATTERN = /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i;
const CARD_RUN_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
// A bare digit run is a phone only when labelled: a phone word up to 3 words
// before it, a + prefix (see phonePrefixMatch), or the "(415) 555-2671" form.
// The run may not touch a letter or digit, and ":digit" (a time) ends it.
const PHONE_WORDS =
  "(?:telefono|cellulare|whatsapp|chiamami|chiama|mobile|phone|call|cell|tel|sms)";
const PHONE_LABEL_PATTERN = new RegExp(
  `(?<!\\p{L})${PHONE_WORDS}(?!\\p{L})(?:[^\\p{L}\\p{N}\\n]*(?!isbn\\b)\\p{L}+){0,3}[^\\p{L}\\p{N}\\n]*(?<![\\p{L}\\p{N}])(\\+?\\(?\\d[\\d .()/-]*\\d)(?![\\p{L}\\p{N}]|:\\d)`,
  "giu",
);
const PAREN_PHONE_PATTERN =
  /(?<![\p{L}\p{N}])(\(\d{2,4}\)[ .-]?\d{2,4}(?:[ .-]?\d{2,4}){1,2})(?![\p{L}\p{N}])/gu;
// Code word (verification, OTP, PIN, ...), optionally "code"/"number"/"numero"/
// "codice", then an optional "is/è" and ":#=", then a 4–8 digit or 6–8
// alphanumeric-with-digit value. Bare "code"/"codice" do not trigger.
const CODE_LABEL = "(?:otp|pin|2fa|one-time|verification|confirmation|verifica|conferma)";
const CODE_NOUN = "(?:\\s{1,3}(?:code|number|numero|codice)\\b)?";
const CODE_GLUE = "\\s{0,3}(?:(?:is|è)\\s{0,3})?[:#=]?\\s{0,3}";
// A 4-digit year is not a code, so "verifica 2024 requisiti" passes.
const CODE_VALUE = "(?:(?!(?:19|20)\\d{2}\\b)\\d{4,8}|(?=[a-z0-9]{0,7}\\d)[a-z0-9]{6,8})";
const CODE_PATTERN = new RegExp(
  `\\b${CODE_LABEL}\\b${CODE_NOUN}${CODE_GLUE}${CODE_VALUE}\\b` +
    `|\\b${CODE_VALUE}\\b${CODE_GLUE}(?:(?:your|tuo|tua)\\s{0,3})?${CODE_LABEL}\\b${CODE_NOUN}`,
  "i",
);
const ADDRESS_CONTEXT_PATTERN =
  /\b(my|our|home|address|indirizzo|casa|live|living|reside|residing|vivo|abito|abitazione)\b/i;
const ADDRESS_PATTERN =
  /(?:\b(?:via(?!\s+(?:mail|e-?mail|email|web|sms)\b)|viale|piazza|corso(?!\s+di\b)|strada(?!\s+facendo\b))\s+[\wàèéìòù'. -]{2,30}?\d{1,4}\b|\b\d{1,4}\s+[\wàèéìòù'. -]{2,30}?\b(?:street|avenue|road|st\.|ave\.|rd\.)\b)/i;
const MEDICAL_KEYWORDS =
  "(?:diagnos\\w*|patolog\\w*|patholog\\w*|malattia|disease|terapia|therapy|farmaco\\w*|prescrizion\\w*|hiv|cancer|cancro|tumore|diabete|diabetes|insulina|insulin|depression\\w*|ansia|anxiety|allerg\\w*|disorder|sintom\\w*)";
const PERSONAL_MARKERS =
  "(?:i(?:['’]m)?|i\\s+am|my|me|mine|io|mio|mia|ho|user|utente|l['’]utente)";
const PERSONAL_MEDICAL_PATTERN = new RegExp(
  `(?:\\b${PERSONAL_MARKERS}\\b[^.!?\\n]{0,40}\\b${MEDICAL_KEYWORDS}\\b|\\b${MEDICAL_KEYWORDS}\\b[^.!?\\n]{0,40}\\b${PERSONAL_MARKERS}\\b)`,
  "i",
);

function luhnCheck(digits: string): boolean {
  if (!digits) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function isSecretLike(value: string): boolean {
  return value.length >= 8 || /[\d._/@$%!#+=-]/.test(value);
}

function containsCredentialWithValue(text: string): boolean {
  for (const match of text.matchAll(CREDENTIAL_LABEL_RE)) {
    const start = (match.index ?? 0) + match[0].length;
    const suffix = text.slice(start, start + 40);
    if (
      /^\s*(?:[^,;:\n]{0,16}\b(?:is|are|equals)\b|[:=])\s*[^\s,;]+/i.test(
        suffix,
      )
    ) {
      return true;
    }
    const value = suffix.match(/^\s+([^\s,;]+)/)?.[1];
    if (value && isSecretLike(value)) return true;
    const nextValue = suffix.match(/^\s+(?:bearer|token|key|code)\s+([^\s,;]+)/i)?.[1];
    if (nextValue && isSecretLike(nextValue)) return true;
  }
  return false;
}

function containsCardPattern(raw: string, lower: string): boolean {
  const normalized = raw.replace(/\s+/g, " ");
  if (/\b(?:\d[ -]*?){13,19}\b/.test(normalized.replace(/[^\d -]/g, " "))) {
    if (
      /\b(carta|card|credit|debit|visa|mastercard|amex)\b/i.test(lower) ||
      /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/.test(normalized)
    ) {
      return true;
    }
  }

  for (const match of normalized.matchAll(CARD_RUN_PATTERN)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      return true;
    }
  }
  return false;
}

/** A matched run is a phone when it has 9–15 digits and is not an ISBN-13. */
function containsPhoneRun(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    if (digits.length === 13 && /^97[89]/.test(digits)) continue;
    return true;
  }
  return false;
}

/**
 * Returns true for high-confidence secret, PII, or personal-medical patterns
 * in text that is about to leave the device through a network tool.
 */
export function containsSensitivePattern(text: string): boolean {
  if (typeof text !== "string") return false;
  const raw = text.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  if (containsCredentialWithValue(raw)) return true;
  if (CODE_PATTERN.test(raw)) return true;
  if (containsCardPattern(raw, lower)) return true;
  if (IBAN_PATTERN.test(raw)) return true;

  const compact = raw.replace(/\s+/g, "");
  if (CF_PATTERN.test(raw) || CF_COMPACT_PATTERN.test(compact)) return true;

  if (/\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,}\b/i.test(raw)) return true;

  if (/-?\d{1,3}\.\d{4,30}\s*,\s*-?\d{1,3}\.\d{4,30}/.test(raw)) return true;

  const phonePrefixMatch = raw.match(/\+[\d\s-]{8,15}\d\b/);
  if (phonePrefixMatch) {
    const prefixDigits = phonePrefixMatch[0].replace(/\D/g, "");
    if (prefixDigits.length >= 9 && prefixDigits.length <= 13) return true;
  }

  if (
    containsPhoneRun(raw, PHONE_LABEL_PATTERN) ||
    containsPhoneRun(raw, PAREN_PHONE_PATTERN)
  ) {
    return true;
  }

  if (ADDRESS_CONTEXT_PATTERN.test(raw) && ADDRESS_PATTERN.test(raw)) return true;

  if (
    /\b(documento|document|passport|passaporto|id\s*number|numero\s*documento|driver'?s?\s*license|patente)\b/i.test(
      lower,
    ) &&
    /\d{5,30}/.test(raw)
  ) {
    return true;
  }

  return PERSONAL_MEDICAL_PATTERN.test(raw);
}
