/**
 * Local on-device memory store (AsyncStorage).
 * Facts about the user (name, preferences, interests) — never leave the device.
 * Pure module: no React, no logging of contents.
 *
 * Contract:
 * - OPT-IN by default (`kalsa.memory.enabled` defaults to false).
 * - Sensitive facts are rejected (never stored).
 * - In-memory cache updates only AFTER a successful storage write.
 * - Mutations are serialized (mutex); epoch bumps on clear/remove/disable.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type MemoryFact = {
  id: string;
  text: string;
  createdAt: number;
};

/** Thrown when a fact matches the sensitive-data filter. */
export class SensitiveFactError extends Error {
  readonly code = "sensitive" as const;
  constructor() {
    super("sensitive");
    this.name = "SensitiveFactError";
  }
}

/** Thrown when AsyncStorage write fails (cache left unchanged). */
export class MemoryWriteError extends Error {
  readonly code = "write" as const;
  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "write failed");
    this.name = "MemoryWriteError";
  }
}

const FACTS_KEY = "kalsa.memory.facts";
const ENABLED_KEY = "kalsa.memory.enabled";
const MAX_FACTS = 40;
const MAX_TEXT_LEN = 200;

/** Optional in-memory cache so list/getEnabled avoid a storage hop every turn. */
let factsCache: MemoryFact[] | null = null;
let enabledCache: boolean | null = null;

/**
 * Generation counter: bumped on clearFacts / removeFact / setEnabled(false)
 * (and any emptying path). Extract jobs capture it and discard delayed writes
 * if the epoch moved.
 */
let epoch = 0;

/**
 * Set when a listFacts() migration rewrite fails and factsCache was updated to
 * the migrated (filtered) view anyway. Forces the write retry on the next
 * listFacts() call even though `current` (== factsCache) then already equals
 * `migrated`, so the equality short-circuit can't mask the pending disk write.
 */
let migrationDirty = false;

/** Serialize all store mutations (promise chain). */
let mutationChain: Promise<void> = Promise.resolve();

// ── Telemetry accumulator (per-turn counters) ────────────────────────────
// Counts extraction/storage/rejection/injection events for bench telemetry.
// Emitted as KALSA_MEMORY log line at turn boundaries.
let telemetryAccum = {
  memoryEnabled: 0,
  factsExtracted: 0,
  factsStored: 0,
  factsRejectedSensitive: 0,
  factsRejectedFull: 0,
  factsInjected: 0,
  totalFactsInStore: 0,
};

/**
 * Track whether memory is enabled (called from AppShell).
 * @param enabled Whether memory is enabled
 */
export function trackMemoryEnabled(enabled: boolean): void {
  telemetryAccum.memoryEnabled = enabled ? 1 : 0;
}

/**
 * Track when facts are injected into system prompt (called from AppShell).
 * @param count Number of facts injected (0..10)
 */
export function trackMemoryInjection(count: number): void {
  telemetryAccum.factsInjected = count;
}

/**
 * Get current telemetry snapshot and reset accumulator for next turn.
 * Returns the counters accumulated since last call.
 */
export function getAndResetMemoryTelemetry(): typeof telemetryAccum {
  const snapshot = { ...telemetryAccum };
  // Reset for next turn
  telemetryAccum = {
    memoryEnabled: 0,
    factsExtracted: 0,
    factsStored: 0,
    factsRejectedSensitive: 0,
    factsRejectedFull: 0,
    factsInjected: 0,
    totalFactsInStore: 0,
  };
  return snapshot;
}

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function bumpEpoch(): void {
  epoch += 1;
}

export function getEpoch(): number {
  return epoch;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LEN);
}

function normalizeKey(text: string): string {
  return normalizeText(text).toLowerCase();
}

/** Luhn checksum — used to distinguish real card numbers from ISBNs/IDs/counters. */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Reject facts that look like secrets or PII.
 * Patterns are intentionally broad; false positives are preferred over leaks.
 */
export function isSensitiveFact(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  const raw = text.trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();

  // Credential / secret keywords (EN + IT).
  if (
    /\b(password|passwd|pwd|passphrase|secret|segreto|token|api[_\s-]?key|apikey|bearer|authorization|auth[_\s-]?code|private[_\s-]?key|chiave\s+privata|otp)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // PIN / CVV-style short secrets next to labels.
  if (/\b(pin|cvv|cvc|security\s*code|codice\s*segreto)\b/i.test(lower)) {
    return true;
  }

  // Credit/debit card: 13–19 digits with optional separators, or spaced groups of 4.
  if (/\b(?:\d[ -]*?){13,19}\b/.test(raw.replace(/[^\d -]/g, " "))) {
    // Require either "card"-like keyword or classic 4×4 grouping to limit false positives.
    if (
      /\b(carta|card|credit|debit|visa|mastercard|amex)\b/i.test(lower) ||
      /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/.test(raw)
    ) {
      return true;
    }
  }

  // Card-like: 13–19 consecutive digits (with or without separators), Luhn-
  // validated for the unconditional path. Real card numbers pass Luhn while
  // ISBNs, version strings, timestamps and counters almost never do, so this
  // still catches a bare unlabelled card number ("4111111111111111") without
  // over-blocking innocuous long digit runs.
  const cardMatch = raw.match(/\b\d(?:[ -]?\d){12,18}\b/);
  if (cardMatch) {
    const digitsOnly = cardMatch[0].replace(/[ -]/g, "");
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
      return true;
    }
  }

  // IBAN (generic).
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i.test(raw.replace(/\s+/g, ""))) {
    return true;
  }

  // Italian codice fiscale (CF) — 16 alphanumerics classic shape.
  if (/\b(codice\s*fiscale|c\.?\s*f\.?)\b/i.test(lower)) return true;
  if (/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i.test(raw.replace(/\s+/g, ""))) {
    return true;
  }

  // Email addresses.
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(raw)) {
    return true;
  }

  // Phone numbers (international / IT-ish, 8+ digits with separators).
  // "." is deliberately NOT a separator here — it would otherwise treat
  // version strings and IP addresses ("2024.05.12.001", "192.168.1.100") as
  // phone-shaped. "chiam\w*" catches Italian call verb forms (chiama,
  // chiamalo, chiamami, chiamare) alongside the existing keyword set.
  if (
    /(?:\+|00)?\d{1,3}[\s/-]?(?:\(?\d{1,4}\)?[\s/-]?)?\d{2,4}[\s/-]?\d{2,4}[\s/-]?\d{2,4}/.test(
      raw,
    ) &&
    (raw.match(/\d/g) ?? []).length >= 8 &&
    /\b(tel|telefono|phone|cell|mobile|whatsapp|numero|chiam\w*)\b/i.test(lower)
  ) {
    return true;
  }

  // Phone-like — international prefix (+/00) followed by 9–13 digits, with
  // or without separators (catches "+39 333 1234567" and "+393331234567").
  const phonePrefixMatch = raw.match(/(?:\+|00)[\d\s-]{8,15}\d\b/);
  if (phonePrefixMatch) {
    const prefixDigits = phonePrefixMatch[0].replace(/\D/g, "");
    if (prefixDigits.length >= 9 && prefixDigits.length <= 13) return true;
  }

  // Phone-like — 9–11 digits explicitly grouped with phone-ish separators
  // (space/dash). A bare, unbroken digit run is deliberately NOT flagged
  // here — that used to reject IDs, view counts, ISBNs, product codes, etc.
  // The keyword-gated check above still catches a bare number when phone
  // context (a keyword) is present.
  const phoneGroupedMatch = raw.match(/\b\d{2,4}[ -]\d{2,4}(?:[ -]\d{1,4}){0,2}\b/);
  if (phoneGroupedMatch) {
    const groupedDigits = phoneGroupedMatch[0].replace(/\D/g, "");
    if (groupedDigits.length >= 9 && groupedDigits.length <= 11) return true;
  }

  // Home address: street-type keyword + short name + a 1-4 digit house
  // number. Idiom exclusions (negative lookahead) keep common non-address
  // phrases unflagged: "via mail/email/web/sms" (by email/web/sms), "corso
  // di X" (a course in X), "strada facendo" (along the way), "road to N".
  if (
    /\b(?:via(?!\s+(?:mail|e-?mail|email|web|sms)\b)|viale|piazza|corso(?!\s+di\b)|strada(?!\s+facendo\b)|street|avenue|road(?!\s+to\b)|(?:st|ave|rd)\.(?=\s|$))\s+[\wàèéìòù'. -]{2,30}?\d{1,4}\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // GPS coordinates: two decimal numbers (4+ decimal places) separated by a comma.
  if (/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/.test(raw)) {
    return true;
  }

  // Document / ID numbers next to labels.
  if (
    /\b(documento|document|passport|passaporto|id\s*number|numero\s*documento|driver'?s?\s*license|patente)\b/i.test(
      lower,
    ) &&
    /\d{5,}/.test(raw)
  ) {
    return true;
  }

  // Explicit health/medical keywords (EN + IT) — flagged on the keyword alone.
  // LLM extraction commonly yields third-person facts ("User has cancer",
  // "L'utente prende un farmaco") which never carry a first-person marker,
  // so no pronoun co-occurrence is required here.
  // "cura", "disturbo" and "treatment" are deliberately excluded — too common
  // as non-medical words ("a cura di", "scusa il disturbo", "water treatment").
  if (
    /\b(diagnosi|diagnosis|patologia|pathology|malattia|disease|terapia|therapy|farmaco|medication|prescrizione|prescription|hiv|cancer|cancro|tumore|diabete|diabetes|insulina|insulin|depressione|depression|ansia|anxiety|allerg\w*|disorder|sintomo|symptom)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

function dedupeAndCap(facts: MemoryFact[]): MemoryFact[] {
  const seen = new Set<string>();
  const out: MemoryFact[] = [];
  // Keep chronological order; drop older duplicates when a newer same-key appears later.
  const sorted = facts
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const fact of sorted) {
    const key = normalizeKey(fact.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: fact.id,
      text: normalizeText(fact.text),
      createdAt: fact.createdAt,
    });
  }
  return out.slice(-MAX_FACTS);
}

function factsEqual(a: MemoryFact[], b: MemoryFact[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || a[i].createdAt !== b[i].createdAt) {
      return false;
    }
  }
  return true;
}

async function readFactsRaw(): Promise<MemoryFact[]> {
  if (factsCache) return factsCache;
  try {
    const raw = await AsyncStorage.getItem(FACTS_KEY);
    if (!raw) {
      factsCache = [];
      return factsCache;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      factsCache = [];
      return factsCache;
    }
    const cleaned = parsed
      .filter(
        (entry): entry is MemoryFact =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as MemoryFact).id === "string" &&
          typeof (entry as MemoryFact).text === "string" &&
          typeof (entry as MemoryFact).createdAt === "number",
      )
      .map((entry) => ({
        id: entry.id,
        text: String(entry.text),
        createdAt: entry.createdAt,
      }));
    factsCache = cleaned;
    return factsCache;
  } catch {
    factsCache = [];
    return factsCache;
  }
}

/**
 * Persist facts. Cache is updated ONLY after setItem succeeds.
 * On write failure the previous cache remains and the error propagates.
 * Clears migrationDirty on success — any successful write (not just the
 * migration one in listFacts) means disk is no longer behind the in-memory
 * filtered view, so no further forced retry is needed.
 */
async function writeFacts(facts: MemoryFact[]): Promise<void> {
  const capped = dedupeAndCap(facts);
  try {
    await AsyncStorage.setItem(FACTS_KEY, JSON.stringify(capped));
  } catch (error) {
    throw new MemoryWriteError(error);
  }
  factsCache = capped;
  migrationDirty = false;
}

/**
 * List facts; on first load migrates dataset (trim, dedup, sort, cap 40)
 * and rewrites storage when the normalized form differs.
 */
export async function listFacts(): Promise<MemoryFact[]> {
  return withMutex(async () => {
    const current = await readFactsRaw();
    // Drop sensitive entries that may pre-exist from older builds.
    const withoutSensitive = current.filter((fact) => !isSensitiveFact(fact.text));
    const migrated = dedupeAndCap(withoutSensitive);
    if (migrationDirty || !factsEqual(current, migrated)) {
      try {
        // writeFacts() clears migrationDirty on success.
        await writeFacts(migrated);
      } catch {
        // Migration rewrite failed: disk still holds pre-migration (possibly
        // sensitive) data. Update the in-memory view to the filtered facts so
        // callers never see rejected data, and set migrationDirty so disk is
        // retried on the next listFacts() call regardless of the equality check.
        migrationDirty = true;
        factsCache = migrated;
        return migrated.slice();
      }
    } else {
      factsCache = migrated;
    }
    return (factsCache ?? migrated).slice();
  });
}

export async function addFact(text: string): Promise<void> {
  return withMutex(async () => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    // Check the FULL untruncated input — normalizeText() truncates to
    // MAX_TEXT_LEN, which could otherwise hide a sensitive keyword past the cutoff.
    if (isSensitiveFact(text)) {
      throw new SensitiveFactError();
    }
    const facts = await readFactsRaw();
    const key = normalizeKey(normalized);
    const existing = facts.find((fact) => normalizeKey(fact.text) === key);
    if (existing) return;
    const next = facts.concat({
      id: makeId(),
      text: normalized,
      createdAt: Date.now(),
    });
    await writeFacts(next);
  });
}

export async function removeFact(id: string): Promise<void> {
  return withMutex(async () => {
    if (!id) return;
    const facts = await readFactsRaw();
    const next = facts.filter((fact) => fact.id !== id);
    if (next.length === facts.length) return;
    await writeFacts(next);
    bumpEpoch();
  });
}

/** Remove by normalized text match (used by extractMemory forget list). */
export async function removeFactByText(text: string): Promise<void> {
  return withMutex(async () => {
    const key = normalizeKey(text);
    if (!key) return;
    const facts = await readFactsRaw();
    const next = facts.filter((fact) => normalizeKey(fact.text) !== key);
    if (next.length === facts.length) return;
    await writeFacts(next);
    bumpEpoch();
  });
}

export async function clearFacts(): Promise<void> {
  return withMutex(async () => {
    try {
      await AsyncStorage.setItem(FACTS_KEY, JSON.stringify([]));
    } catch (error) {
      throw new MemoryWriteError(error);
    }
    factsCache = [];
    bumpEpoch();
  });
}

export async function getEnabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    const raw = await AsyncStorage.getItem(ENABLED_KEY);
    // OPT-IN: default OFF when unset.
    enabledCache = raw === null ? false : raw === "1" || raw === "true";
    return enabledCache;
  } catch {
    enabledCache = false;
    return false;
  }
}

export async function setEnabled(enabled: boolean): Promise<void> {
  return withMutex(async () => {
    try {
      await AsyncStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
    } catch (error) {
      throw new MemoryWriteError(error);
    }
    enabledCache = enabled;
    if (!enabled) {
      // Invalidate any in-flight extract that might re-write facts after toggle-off.
      bumpEpoch();
    }
  });
}

/**
 * Apply extractMemory results as a single mutex-held batch.
 * Aborts (no writes) if epoch moved or memory was disabled since capture.
 * Individual removes inside the batch do not self-invalidate via epoch —
 * Settings clear/delete/toggle-off still bump epoch and win the race.
 * Sensitive add items are skipped (not thrown).
 * Returns whether any write was applied.
 */
export async function applyExtractResults(
  add: string[],
  remove: string[],
  expectedEpoch: number,
): Promise<boolean> {
  // Track extraction candidates (before filtering)
  telemetryAccum.factsExtracted += add.length;
  
  return withMutex(async () => {
    if (epoch !== expectedEpoch) return false;
    // Read enabled without nested mutex (we already hold it).
    let enabled = enabledCache;
    if (enabled === null) {
      try {
        const raw = await AsyncStorage.getItem(ENABLED_KEY);
        enabled = raw === null ? false : raw === "1" || raw === "true";
        enabledCache = enabled;
      } catch {
        enabled = false;
        enabledCache = false;
      }
    }
    if (!enabled) return false;
    if (epoch !== expectedEpoch) return false;

    let facts = await readFactsRaw();
    let changed = false;

    for (const rawRemove of remove) {
      const key = normalizeKey(rawRemove);
      if (!key) continue;
      const next = facts.filter((fact) => normalizeKey(fact.text) !== key);
      if (next.length !== facts.length) {
        facts = next;
        changed = true;
      }
    }

    for (const rawAdd of add) {
      const normalized = normalizeText(rawAdd);
      if (!normalized) continue;
      // Check the FULL untruncated input — normalizeText() truncates to
      // MAX_TEXT_LEN, which could otherwise hide a sensitive keyword past the cutoff.
      if (isSensitiveFact(rawAdd)) {
        telemetryAccum.factsRejectedSensitive++;
        continue;
      }
      const key = normalizeKey(normalized);
      if (facts.some((fact) => normalizeKey(fact.text) === key)) continue;
      if (facts.length >= MAX_FACTS) {
        telemetryAccum.factsRejectedFull++;
        continue;
      }
      facts = facts.concat({
        id: makeId(),
        text: normalized,
        createdAt: Date.now(),
      });
      telemetryAccum.factsStored++;
      changed = true;
    }

    // Always report the true size, even if nothing changed
    telemetryAccum.totalFactsInStore = facts.length;

    if (!changed) return false;
    // Final race check right before write.
    if (epoch !== expectedEpoch) return false;
    await writeFacts(facts);
    return true;
  });
}
