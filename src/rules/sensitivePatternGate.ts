/** Pure detection of sensitive patterns that must not reach network tools. */

const CREDENTIAL_LABEL_RE =
  /\b(password|passwd|pwd|passphrase|secret|segreto|token|api[_\s-]?key|apikey|bearer|authorization|auth[_\s-]?code|private[_\s-]?key|chiave\s+privata|otp|pin|cvv|cvc|security\s*code|codice\s*segreto)\b/gi;
const IBAN_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{2}\s*\d{2}(?:\s*[A-Z0-9]){10,30}(?:$|[^A-Z0-9])/i;
const CF_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{6}\s*\d{2}\s*[A-Z]\s*\d{2}\s*[A-Z]\s*\d{3}\s*[A-Z](?:$|[^A-Z0-9])/i;
const CF_COMPACT_PATTERN = /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i;
const CARD_RUN_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;
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
  if (containsCardPattern(raw, lower)) return true;
  if (IBAN_PATTERN.test(raw)) return true;

  const compact = raw.replace(/\s+/g, "");
  if (CF_PATTERN.test(raw) || CF_COMPACT_PATTERN.test(compact)) return true;

  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(raw)) return true;

  if (/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/.test(raw)) return true;

  if (
    /(?:\+|00)?\d{1,3}[\s/-]?(?:\(?\d{1,4}\)?[\s/-]?)?\d{2,4}[\s/-]?\d{2,4}[\s/-]?\d{2,4}/.test(
      raw,
    ) &&
    (raw.match(/\d/g) ?? []).length >= 8 &&
    /\b(tel|telefono|phone|cell|mobile|whatsapp|numero|chiam\w*)\b/i.test(lower)
  ) {
    return true;
  }

  const phonePrefixMatch = raw.match(/(?:\+|00)[\d\s-]{8,15}\d\b/);
  if (phonePrefixMatch) {
    const prefixDigits = phonePrefixMatch[0].replace(/\D/g, "");
    if (prefixDigits.length >= 9 && prefixDigits.length <= 13) return true;
  }

  const phoneGroupedMatch = raw.match(/\b\d{2,4}[ -]\d{2,4}(?:[ -]\d{1,4}){0,2}\b/);
  if (phoneGroupedMatch) {
    const groupedDigits = phoneGroupedMatch[0].replace(/\D/g, "");
    if (groupedDigits.length >= 9 && groupedDigits.length <= 11) return true;
  }

  if (ADDRESS_CONTEXT_PATTERN.test(raw) && ADDRESS_PATTERN.test(raw)) return true;

  if (
    /\b(documento|document|passport|passaporto|id\s*number|numero\s*documento|driver'?s?\s*license|patente)\b/i.test(
      lower,
    ) &&
    /\d{5,}/.test(raw)
  ) {
    return true;
  }

  return PERSONAL_MEDICAL_PATTERN.test(raw);
}
