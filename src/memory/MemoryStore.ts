/**
 * Local on-device memory store (AsyncStorage).
 * Facts about the user (name, preferences, interests) — never leave the device.
 * Pure module: no React, no logging of contents.
 *
 * Contract:
 * - OPT-IN by default (`kalsa.memory.enabled` defaults to false).
 * - Facts may contain sensitive data; privacy filtering belongs at egress.
 * - In-memory cache updates only AFTER a successful storage write.
 * - Mutations are serialized (mutex); epoch bumps on clear/remove/disable and
 *   updateFact, so in-flight extraction cannot re-add superseded wording.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type MemoryFact = {
  id: string;
  text: string;
  createdAt: number;
};

/** Thrown when AsyncStorage write fails (cache left unchanged). */
export class MemoryWriteError extends Error {
  readonly code = "write" as const;
  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : "write failed");
    this.name = "MemoryWriteError";
  }
}

/** Thrown when a manual add would exceed the saved-fact limit. */
export class MemoryCapacityError extends Error {
  readonly code = "full" as const;
  constructor() {
    super("memory full");
    this.name = "MemoryCapacityError";
  }
}

/** Thrown when an edit would duplicate another saved fact. */
export class MemoryDuplicateError extends Error {
  readonly code = "duplicate" as const;
  constructor() {
    super("duplicate memory fact");
    this.name = "MemoryDuplicateError";
  }
}

const FACTS_KEY = "kalsa.memory.facts";
const ENABLED_KEY = "kalsa.memory.enabled";
export const MAX_FACTS = 40;
const MAX_TEXT_LEN = 200;

/** Optional in-memory cache so list/getEnabled avoid a storage hop every turn. */
let factsCache: MemoryFact[] | null = null;
let enabledCache: boolean | null = null;

/**
 * Generation counter: bumped on clearFacts / removeFact / setEnabled(false)
 * / updateFact. Extract jobs capture it and discard delayed writes if the epoch
 * moved; updateFact invalidates jobs holding the old wording.
 */
let epoch = 0;

/**
 * Set when a listFacts() migration rewrite fails and factsCache was updated to
 * the migrated view anyway. Forces the write retry on the next
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
  factsRejectedFull: 0,
  factsInjected: 0,
  totalFactsInStore: 0,
  dnaDeferred: -1,
  dnaInjected: -1,
  dnaBudgetTokens: -1,
  extractParseOutcome: 0,
  extractGateSource: 0,
  extractStopReason: 0,
};

/** Sentinel used on a telemetry line where a field is not knowable yet. */
export const MEMORY_TELEMETRY_NOT_APPLICABLE = -1;

/**
 * Track whether memory is enabled (called from AppShell).
 * @param enabled Whether memory is enabled
 */
export function trackMemoryEnabled(enabled: boolean): void {
  telemetryAccum.memoryEnabled = enabled ? 1 : 0;
}

/**
 * Track when facts are injected into the turn prompt (called from AppShell).
 * @param count Number of facts injected after bounding
 */
export function trackMemoryInjection(count: number): void {
  telemetryAccum.factsInjected = count;
}

/** Track DNA bounding health for this turn's injection (called from AppShell). */
export function trackMemoryDnaBound(
  deferredCount: number,
  injectedCount: number,
  budgetTokens: number,
): void {
  telemetryAccum.dnaDeferred = deferredCount;
  telemetryAccum.dnaInjected = injectedCount;
  telemetryAccum.dnaBudgetTokens = budgetTokens;
}

/** Track the settled number of facts in the store (called before extract telemetry). */
export function trackMemoryStoreSize(count: number): void {
  telemetryAccum.totalFactsInStore = count;
}

/**
 * Memory extraction telemetry codes:
 * - extractParseOutcome: 0=did not run/timeout, 1=parsed OK (including empty arrays),
 *   2=parser rejected, 3=the extraction job threw before completion.
 * - extractGateSource: 0=not released, 1=afterSessionSave, 2=safety timeout, 3=abort.
 * - extractStopReason: 0=extraction attempted, 1=signal aborted or turn failed,
 *   2=memory disabled, 3=store epoch changed, 4=never armed (empty reply or
 *   aborted/failed before arming).
 *
 * KALSA_MEMORY (turn-end) emits MEMORY_TELEMETRY_NOT_APPLICABLE (-1) for all
 * extraction fields because the extract job has not settled. KALSA_MEMORY_EXTRACT
 * emits the actual codes. A zero on the turn-end line is never "not run" data.
 */
export function trackMemoryParseOutcome(outcome: number): void {
  telemetryAccum.extractParseOutcome = outcome;
}

/** Track which path released the memory extraction save gate (called from AppShell). */
export function trackMemoryExtractGateSource(source: number): void {
  telemetryAccum.extractGateSource = source;
}

/** Track why extraction stopped before or after arming (called from AppShell). */
export function trackMemoryExtractStopReason(reason: number): void {
  telemetryAccum.extractStopReason = reason;
}

/**
 * Get current telemetry snapshot WITHOUT resetting.
 * Used by extract-complete telemetry to observe late-arriving counters.
 */
export function snapshotMemoryTelemetry(): typeof telemetryAccum {
  return { ...telemetryAccum };
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
    factsRejectedFull: 0,
    factsInjected: 0,
    totalFactsInStore: 0,
    dnaDeferred: -1,
    dnaInjected: -1,
    dnaBudgetTokens: -1,
    extractParseOutcome: 0,
    extractGateSource: 0,
    extractStopReason: 0,
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
 * normalized view, so no further forced retry is needed.
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
    const migrated = dedupeAndCap(current);
    if (migrationDirty || !factsEqual(current, migrated)) {
      try {
        // writeFacts() clears migrationDirty on success.
        await writeFacts(migrated);
      } catch {
        // Migration rewrite failed: keep the normalized in-memory view and
        // retry the disk write on the next listFacts() call.
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
    const facts = await readFactsRaw();
    const key = normalizeKey(normalized);
    const existing = facts.find((fact) => normalizeKey(fact.text) === key);
    if (existing) return;
    if (facts.length >= MAX_FACTS) throw new MemoryCapacityError();
    const next = facts.concat({
      id: makeId(),
      text: normalized,
      createdAt: Date.now(),
    });
    await writeFacts(next);
  });
}

export async function updateFact(id: string, newText: string): Promise<void> {
  return withMutex(async () => {
    const normalized = normalizeText(newText);
    if (!normalized || !id) return;

    const facts = await readFactsRaw();
    const index = facts.findIndex((fact) => fact.id === id);
    if (index === -1) return;

    const key = normalized.toLowerCase();
    if (facts.some((fact, factIndex) => factIndex !== index && normalizeKey(fact.text) === key)) {
      throw new MemoryDuplicateError();
    }
    if (facts[index].text === normalized) return;

    const next = facts.map((fact, factIndex) =>
      factIndex === index ? { ...fact, text: normalized } : fact,
    );
    await writeFacts(next);
    bumpEpoch();
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
