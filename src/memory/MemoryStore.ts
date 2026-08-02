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

/** Serialize all store mutations (promise chain). */
let mutationChain: Promise<void> = Promise.resolve();

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
  if (
    /(?:\+|00)?\d{1,3}[\s./-]?(?:\(?\d{1,4}\)?[\s./-]?)?\d{2,4}[\s./-]?\d{2,4}[\s./-]?\d{2,4}/.test(
      raw,
    ) &&
    (raw.match(/\d/g) ?? []).length >= 8 &&
    /\b(tel|telefono|phone|cell|mobile|whatsapp|numero)\b/i.test(lower)
  ) {
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

  // Explicit health keywords paired with personal claim shape (conservative).
  if (
    /\b(diagnosi|diagnosis|patologia|pathology|malattia|disease|terapia|therapy|farmaco|medication|prescrizione|prescription|hiv|cancer|tumore)\b/i.test(
      lower,
    ) &&
    /\b(ho|sono|i have|i'm|i am|my|mia|mio)\b/i.test(lower)
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
 */
async function writeFacts(facts: MemoryFact[]): Promise<void> {
  const capped = dedupeAndCap(facts);
  try {
    await AsyncStorage.setItem(FACTS_KEY, JSON.stringify(capped));
  } catch (error) {
    throw new MemoryWriteError(error);
  }
  factsCache = capped;
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
    if (!factsEqual(current, migrated)) {
      try {
        await writeFacts(migrated);
      } catch {
        // Migration rewrite failed: still return the best-effort in-memory view
        // without clobbering cache as if write succeeded.
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
    if (isSensitiveFact(normalized)) {
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
      if (isSensitiveFact(normalized)) continue;
      const key = normalizeKey(normalized);
      if (facts.some((fact) => normalizeKey(fact.text) === key)) continue;
      facts = facts.concat({
        id: makeId(),
        text: normalized,
        createdAt: Date.now(),
      });
      changed = true;
    }

    if (!changed) return false;
    // Final race check right before write.
    if (epoch !== expectedEpoch) return false;
    await writeFacts(facts);
    return true;
  });
}
