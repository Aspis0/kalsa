/**
 * Guard for chat-history persistence: a save may never shrink what the store
 * is known to hold, and an unreadable raw is set aside before anything can
 * overwrite it. Conversations live only on the phone — an accidental
 * overwrite is unrecoverable, so the decision logic lives here as pure
 * functions (no React, no AsyncStorage import) and the caller injects a
 * minimal KV surface. Privacy: never log message text, conversation ids or
 * storage keys from this module's callers — counts and booleans only.
 */

/**
 * What the store is known to hold for one messages key.
 * - known(count): the raw parsed to an array of that many entries at load.
 * - unknown: the raw could not be read at all — assume non-zero.
 */
export type HistoryBaseline =
  | { kind: "known"; count: number }
  | { kind: "unknown" };

/** Minimal KV surface the caller injects (AsyncStorage satisfies it). */
export interface HistoryKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LoadedHistoryAssessment<T> {
  baseline: HistoryBaseline;
  /** Raw exists but cannot be read as history — copy it aside, keep it in place. */
  quarantineRaw: boolean;
  /** Sanitized messages when readable; [] when the raw is absent or unreadable. */
  messages: T[];
}

/**
 * Classify the raw observed at load time.
 *
 * The baseline is the RAW array length, never the sanitized count: in exactly
 * the poisoned case that destroys conversations (sanitize yields 0 from a
 * non-empty raw) the sanitized count would set the baseline to 0 and arm the
 * overwrite that erases the history.
 *
 * - raw absent → known 0 (a fresh conversation has nothing to protect).
 * - parse throws, or the payload is not an array → unknown (non-zero by
 *   assumption): refuse every non-opt-in write and quarantine the raw.
 * - sanitize empties a non-empty array → known raw length + quarantine; the
 *   screen stays empty but the store is NOT considered empty.
 * - genuinely empty array → known 0, no quarantine.
 */
export function assessLoadedHistory<T>(opts: {
  raw: string | null;
  sanitize: (entries: unknown[]) => T[];
}): LoadedHistoryAssessment<T> {
  if (opts.raw == null) {
    return {
      baseline: { kind: "known", count: 0 },
      quarantineRaw: false,
      messages: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.raw);
  } catch {
    return { baseline: { kind: "unknown" }, quarantineRaw: true, messages: [] };
  }
  if (!Array.isArray(parsed)) {
    // Not an array → unreadable as history. Whatever it holds, no write may
    // claim the key is safe to overwrite.
    return { baseline: { kind: "unknown" }, quarantineRaw: true, messages: [] };
  }
  if (parsed.length === 0) {
    return {
      baseline: { kind: "known", count: 0 },
      quarantineRaw: false,
      messages: [],
    };
  }
  const messages = opts.sanitize(parsed);
  if (messages.length === 0) {
    return {
      baseline: { kind: "known", count: parsed.length },
      quarantineRaw: true,
      messages: [],
    };
  }
  return {
    baseline: { kind: "known", count: parsed.length },
    quarantineRaw: false,
    messages,
  };
}

export interface WriteDecision {
  allowed: boolean;
  /** Baseline the caller must adopt once an allowed write lands. */
  nextBaseline: HistoryBaseline;
}

/**
 * Invariant: a write may not shrink history by accident.
 *
 * - unknown baseline → refuse every non-opt-in write, whatever its size.
 * - known baseline → growth and equal length always pass (no false positives
 *   while chatting); a shrink passes only with the opt-in a declared user
 *   action sets (new chat, clear chat, message deletion).
 *
 * An allowed write of C makes the store provably hold C, so the baseline
 * becomes C (never lower than it was): refused writes leave it untouched.
 */
export function evaluateHistoryWrite(opts: {
  baseline: HistoryBaseline;
  incomingCount: number;
  optIn: boolean;
}): WriteDecision {
  if (opts.baseline.kind === "unknown") {
    return opts.optIn
      ? {
          allowed: true,
          nextBaseline: { kind: "known", count: opts.incomingCount },
        }
      : { allowed: false, nextBaseline: opts.baseline };
  }
  if (opts.incomingCount >= opts.baseline.count || opts.optIn) {
    // An allowed write of C — including an opted-in shrink — leaves the store
    // provably holding C, so the baseline becomes exactly C.
    return {
      allowed: true,
      nextBaseline: { kind: "known", count: opts.incomingCount },
    };
  }
  return { allowed: false, nextBaseline: opts.baseline };
}

/**
 * True when the store holds messages even though the screen may show none —
 * the poisoned state must report NOT empty so "New chat" actually creates a
 * conversation instead of keeping the user in the one about to be written
 * over.
 */
export function baselineImpliesStoredMessages(
  baseline: HistoryBaseline,
): boolean {
  if (baseline.kind === "unknown") return true;
  return baseline.count > 0;
}

export function quarantineKeyFor(messagesKey: string): string {
  return `${messagesKey}.quarantine`;
}

/**
 * Copy the raw to `<messagesKey>.quarantine` unless that key already holds
 * something: the oldest surviving copy is the valuable one, so never clobber.
 * Neither key is deleted and the original is never written here — the caller
 * still owns the original value.
 */
export async function copyToQuarantineUnlessPresent(
  kv: HistoryKv,
  messagesKey: string,
  raw: string,
): Promise<boolean> {
  const quarantineKey = quarantineKeyFor(messagesKey);
  const existing = await kv.getItem(quarantineKey);
  if (existing != null) return false;
  await kv.setItem(quarantineKey, raw);
  return true;
}
