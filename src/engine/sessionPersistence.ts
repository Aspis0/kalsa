/**
 * Native KV session persistence (llama.rn saveSession / loadSession).
 *
 * Per-model `.kvs` file under documents/sessions/ + AsyncStorage meta that
 * validates history/cache/spec before restore. Pure helpers (hash, meta match)
 * have no RN side effects so the harness can exercise them offline.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

// ── Pure section ────────────────────────────────────────────────────────────

export type SessionMeta = {
  formatVersion: 1;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  mtpNMax?: number;
  /** e.g. "draft-mtp" | "draft-dflash" | "none"; undefined on production MTP path */
  specType?: string;
  /** JSON.stringify of bench EngineOverride; omitted when production defaults. */
  engineKnob?: string;
  historyHash: string;
  /** Length of the messages array that produced historyHash. Enables prefix restore. */
  historyMessageCount?: number;
  /**
   * djb2 over JSON.stringify({locale, memoryFactsJoined, hasTools}).
   * Mismatch → cold start (same as historyHash). Optional for back-compat reads.
   * Changing the hashed shape invalidates older saved sessions (one cold prefill).
   */
  promptEnvHash?: string;
  /**
   * Active conversation id when the session was saved. Optional for back-compat.
   * Both absent/empty match. One side non-empty and the other empty → mismatch.
   */
  conversationId?: string;
  /** Date.now() at save; ignored by sessionMetaMatches */
  savedAt?: number;
};

/** Default messages key until migrate / AppShell bind the active conversation. */
export const DEFAULT_BOOT_MESSAGES_KEY = "kalsa.messages.v1";

let bootMessagesKey = DEFAULT_BOOT_MESSAGES_KEY;
let sessionConversationId: string | undefined;

/**
 * Strip path separators / traversal so model ids stay single path segments.
 * Catalog ids are filename-like; keep simple.
 */
export function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

/** AsyncStorage key for session meta of a model (sanitized id, same as file name). */
export function sessionMetaKey(modelId: string): string {
  return `kalsa.session.meta.${sanitizeModelId(modelId)}`;
}

/** Pure path join: `${baseDir}sessions/${modelId}.kvs` (baseDir should end with /). */
export function sessionFilePathForBase(baseDir: string, modelId: string): string {
  const base = baseDir || "";
  const root = base.endsWith("/") || base === "" ? base : `${base}/`;
  return `${root}sessions/${sanitizeModelId(modelId)}.kvs`;
}

/**
 * Session file path under app documents dir.
 * Reuses ModelDownloader base: FileSystem.documentDirectory.
 */
export function sessionFilePath(modelId: string): string {
  return sessionFilePathForBase(FileSystem.documentDirectory ?? "", modelId);
}

/**
 * djb2 hash over UTF-16 code units (JS string indexing).
 * Returns unsigned 32-bit value as decimal string.
 */
export function historyHash(messagesJson: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < messagesJson.length; i++) {
    h = (((h << 5) + h + messagesJson.charCodeAt(i)) >>> 0);
  }
  return String(h >>> 0);
}

/** JSON.stringify(messages array or []) then historyHash. */
export function computeHistoryHashFromMessages(messages: unknown): string {
  const arr = Array.isArray(messages) ? messages : [];
  return historyHash(JSON.stringify(arr));
}

/**
 * Accept restore when saved history is an exact prefix of current messages.
 * New user messages after save (turn N+1 boot) must not force a cold start.
 * Content hash of the prefix is the only history check — never token counts.
 *
 * After a matching prefix, every suffix message must be role "user" (pending
 * input the model has not answered). An assistant/tool/miniapp suffix means a
 * full turn completed after the KV was saved (e.g. shouldSaveSession skipped a
 * non-reproducible tool turn while AsyncStorage still wrote the reply) — reject
 * with stale_kv_completed_turn so we cold-start instead of loading a KV that
 * never saw that turn.
 *
 * AppState-background save + buildPersistableMessages: a still-streaming reply
 * is dropped from the meta count/hash but may already sit in native KV. The
 * suffix rule then rejects (suffix holds that assistant message) — safe direction.
 */
export function sessionHistoryPrefixAccepts(
  saved: { historyHash?: unknown; historyMessageCount?: unknown } | null | undefined,
  currentMessages: unknown,
): { accept: true } | { accept: false; reason: string } {
  if (saved == null) return { accept: false, reason: "historyHash" };
  const hash = saved.historyHash;
  if (typeof hash !== "string" || hash.length === 0) {
    return { accept: false, reason: "historyHash" };
  }
  if (!Array.isArray(currentMessages)) {
    return { accept: false, reason: "historyHash" };
  }
  const count = saved.historyMessageCount;
  if (count === undefined) {
    // Legacy meta: exact full-history match.
    if (computeHistoryHashFromMessages(currentMessages) === hash) {
      return { accept: true };
    }
    return { accept: false, reason: "historyHash" };
  }
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    !Number.isFinite(count)
  ) {
    return { accept: false, reason: "historyMessageCount" };
  }
  if (currentMessages.length < count) {
    return { accept: false, reason: "historyHash" };
  }
  const prefix = currentMessages.slice(0, count);
  if (computeHistoryHashFromMessages(prefix) !== hash) {
    return { accept: false, reason: "historyHash" };
  }
  // Prefix matches. Accept only if the suffix is pending user input (or empty).
  for (let i = count; i < currentMessages.length; i++) {
    const msg = currentMessages[i];
    const role =
      msg != null && typeof msg === "object" && "role" in msg
        ? (msg as { role?: unknown }).role
        : undefined;
    if (role !== "user") {
      return { accept: false, reason: "stale_kv_completed_turn" };
    }
  }
  return { accept: true };
}

/** Boot messages from AsyncStorage. Best-effort; never throws; [] on failure. */
export async function readBootMessages(): Promise<unknown[]> {
  try {
    const raw = await AsyncStorage.getItem(bootMessagesKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let bootHistoryHashPromise: Promise<string> | null = null;
/**
 * History hash captured ONCE per engine-lifetime, at first call (AppShell
 * mount) — BEFORE any send can append the in-flight turn to the boot messages
 * key (legacy kalsa.messages.v1, or kalsa.messages.<id> after migrate).
 * The KV session gate must compare against the history the conversation
 * STARTS from, not a mid-send snapshot (lazy engine init reads after the user
 * message is already persisted → guaranteed mismatch; CI run 31279879254).
 *
 * After save+dispose (same-process unload), call resetBootHistoryHash so the
 * next initEngine recomputes against the just-saved history instead of stale
 * H0 (which would miss and delete the .kvs).
 *
 * Conversation switch / new chat / migrate must call setBootMessagesKey +
 * resetBootHistoryHash so the next capture reads the active conversation.
 */
export function getBootHistoryHash(): Promise<string> {
  if (!bootHistoryHashPromise) {
    const key = bootMessagesKey;
    bootHistoryHashPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        return historyHash(raw || "[]");
      } catch {
        return historyHash("[]");
      }
    })();
  }
  return bootHistoryHashPromise;
}

/** Drop the cached boot hash so the next getBootHistoryHash rereads storage. */
export function resetBootHistoryHash(): void {
  bootHistoryHashPromise = null;
}

/** AsyncStorage key getBootHistoryHash reads. Default stays kalsa.messages.v1. */
export function getBootMessagesKey(): string {
  return bootMessagesKey;
}

/**
 * Point the boot-history capture at a conversation messages key.
 * Resets the cached hash when the key actually changes.
 */
export function setBootMessagesKey(key: string): void {
  const next =
    typeof key === "string" && key.length > 0 ? key : DEFAULT_BOOT_MESSAGES_KEY;
  if (next === bootMessagesKey) return;
  bootMessagesKey = next;
  resetBootHistoryHash();
}

/** Conversation id written into SessionMeta on save (optional). */
export function getSessionConversationId(): string | undefined {
  return sessionConversationId;
}

export function setSessionConversationId(id: string | undefined): void {
  if (typeof id === "string" && id.length > 0) {
    sessionConversationId = id;
    return;
  }
  sessionConversationId = undefined;
}

/**
 * Hash of system-prompt env inputs that are not covered by historyHash.
 * Covers locale, memory facts (joined), and whether tools are wired into
 * buildSystemPrompt (systemPrompt vs systemPromptWithSearch). Uses the same
 * djb2 as historyHash. Changing the hashed shape invalidates older saved
 * sessions (one cold prefill).
 */
export function computePromptEnvHash(
  locale: string,
  memoryFacts: string[] | undefined | null,
  hasTools: boolean,
): string {
  const memoryFactsJoined = Array.isArray(memoryFacts) ? memoryFacts.join("\n") : "";
  return historyHash(
    JSON.stringify({
      locale,
      memoryFactsJoined,
      hasTools,
    }),
  );
}

/**
 * True when stored meta is safe to load for the current engine + history.
 * Does NOT require savedAt equality. Optional mtpNMax/specType/engineKnob:
 * missing and undefined are treated as equal. promptEnvHash must match
 * (missing ≡ undefined). conversationId: both empty match; one-sided is a mismatch.
 */
export function sessionMetaMatches(a: SessionMeta, b: SessionMeta): boolean {
  return sessionMetaMismatchField(a, b) === null;
}

/**
 * First mismatching field name, or null when the metas match.
 * Diagnostic companion to sessionMetaMatches — telemetry logs
 * meta_mismatch:<field> so cold starts are attributable (e2e run 31274549471
 * reported a bare meta_mismatch that could be either a missed turn-2 save or
 * a legitimate memory-facts change).
 */
export function sessionMetaMismatchField(a: SessionMeta, b: SessionMeta): string | null {
  if (a.formatVersion !== b.formatVersion) return "formatVersion";
  if (a.nCtx !== b.nCtx) return "nCtx";
  if (a.cacheTypeK !== b.cacheTypeK) return "cacheTypeK";
  if (a.cacheTypeV !== b.cacheTypeV) return "cacheTypeV";
  if (a.historyHash !== b.historyHash) return "historyHash";
  if (a.promptEnvHash !== b.promptEnvHash) return "promptEnvHash";
  if (a.mtpNMax !== b.mtpNMax) return "mtpNMax";
  if (a.specType !== b.specType) return "specType";
  if (a.engineKnob !== b.engineKnob) return "engineKnob";
  const aConv =
    typeof a.conversationId === "string" && a.conversationId.length > 0
      ? a.conversationId
      : "";
  const bConv =
    typeof b.conversationId === "string" && b.conversationId.length > 0
      ? b.conversationId
      : "";
  if (aConv !== bConv) return "conversationId";
  return null;
}

// ── Impure I/O (expo / AsyncStorage) ────────────────────────────────────────

function sessionsDir(): string {
  const base = FileSystem.documentDirectory ?? "";
  const root = base.endsWith("/") || base === "" ? base : `${base}/`;
  return `${root}sessions/`;
}

/** Ensure documents/sessions/ exists. Best-effort; never throws. */
export async function ensureSessionsDir(): Promise<void> {
  try {
    const dir = sessionsDir();
    if (!dir) return;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // best-effort
  }
}

/**
 * Dense measured ceiling ≈58–60 KB per used token (q8_0 K / q4_0 V, 4B default:
 * ~1.6 KB/cell/layer × 36 layers). We use nCtx * 64 KB as a cheap upper bound
 * without counting tokens in history. Hybrid (kvUnified) recurrent tensors
 * (r_l/s_l) can add more and are NOT included in this estimate.
 *
 * Free space must exceed 1.5 × estimated bytes (headroom for write + FS overhead).
 * On check failure/throw → false (skip save).
 */
export function estimateSessionBytes(nCtx: number): number {
  return Math.max(0, nCtx) * 64 * 1024;
}

/**
 * Synchronous save-gate for native KV sessions (no I/O, no disk check).
 *
 * Ordering matches saveEngineSession's early returns so CI can grep the same
 * reason strings. Disk headroom stays async and is checked after this gate.
 *
 * CI run 31303432531: a web_search turn left native KV at 2084 tokens while
 * re-rendered history only reproduced the prefix through 1184 (tool results
 * never persist). Hybrid/recurrent models cannot roll KV back, so restore is
 * useless — skip save when the turn made KV non-reproducible instead of
 * writing a poisoned session.
 */
export function shouldSaveSession(args: {
  hasContext: boolean;
  disposing: boolean;
  kvHoldsChatSession: boolean;
  kvReproducible: boolean;
}): { save: boolean; reason?: string } {
  if (!args.hasContext) return { save: false, reason: "no_context" };
  if (args.disposing) return { save: false, reason: "disposing" };
  if (!args.kvHoldsChatSession) return { save: false, reason: "kv_not_chat" };
  if (!args.kvReproducible) return { save: false, reason: "kv_not_reproducible" };
  return { save: true };
}

export async function hasEnoughDiskForSession(nCtx: number): Promise<boolean> {
  try {
    const free = await FileSystem.getFreeDiskStorageAsync();
    const estimated = estimateSessionBytes(nCtx);
    return free > 1.5 * estimated;
  } catch {
    return false;
  }
}

/** Read + parse session meta; null if missing/invalid. Never throws. */
export async function readSessionMeta(modelId: string): Promise<SessionMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionMetaKey(modelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionMeta>;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      parsed.formatVersion !== 1 ||
      typeof parsed.nCtx !== "number" ||
      typeof parsed.cacheTypeK !== "string" ||
      typeof parsed.cacheTypeV !== "string" ||
      typeof parsed.historyHash !== "string"
    ) {
      return null;
    }
    const meta: SessionMeta = {
      formatVersion: 1,
      nCtx: parsed.nCtx,
      cacheTypeK: parsed.cacheTypeK,
      cacheTypeV: parsed.cacheTypeV,
      historyHash: parsed.historyHash,
    };
    if (typeof parsed.mtpNMax === "number") meta.mtpNMax = parsed.mtpNMax;
    if (typeof parsed.specType === "string") meta.specType = parsed.specType;
    if (typeof parsed.engineKnob === "string") meta.engineKnob = parsed.engineKnob;
    if (typeof parsed.promptEnvHash === "string") meta.promptEnvHash = parsed.promptEnvHash;
    if (typeof parsed.conversationId === "string" && parsed.conversationId.length > 0) {
      meta.conversationId = parsed.conversationId;
    }
    if (typeof parsed.savedAt === "number") meta.savedAt = parsed.savedAt;
    if (
      typeof parsed.historyMessageCount === "number" &&
      Number.isInteger(parsed.historyMessageCount) &&
      parsed.historyMessageCount >= 0 &&
      Number.isFinite(parsed.historyMessageCount)
    ) {
      meta.historyMessageCount = parsed.historyMessageCount;
    }
    return meta;
  } catch {
    return null;
  }
}

/** Write session meta. Never throws (swallows). */
export async function writeSessionMeta(modelId: string, meta: SessionMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(sessionMetaKey(modelId), JSON.stringify(meta));
  } catch {
    // best-effort
  }
}

/**
 * Delete .kvs file + llama.rn `.kvs.meta` sidecar + any `.kvs.tmp` partial
 * + AsyncStorage meta. Idempotent, never throws.
 */
export async function deleteSessionArtifacts(modelId: string): Promise<void> {
  if (!modelId) return;
  const path = sessionFilePath(modelId);
  for (const p of [path, `${path}.meta`, `${path}.tmp`, `${path}.bak`]) {
    try {
      await FileSystem.deleteAsync(p, { idempotent: true });
    } catch {
      // ignore
    }
  }
  try {
    await AsyncStorage.removeItem(sessionMetaKey(modelId));
  } catch {
    // ignore
  }
}

/**
 * List sessions/ and delete files not matching keepModelId.
 * Also remove their meta keys and sidecars (best-effort).
 */
export async function deleteOtherModelSessions(keepModelId: string): Promise<void> {
  try {
    const dir = sessionsDir();
    if (!dir) return;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(dir);
    const keepStem = sanitizeModelId(keepModelId);
    const keepName = `${keepStem}.kvs`;
    for (const name of names) {
      // Keep current model's .kvs / .kvs.meta / .kvs.tmp / .kvs.bak
      if (
        name === keepName ||
        name === `${keepName}.meta` ||
        name === `${keepName}.tmp` ||
        name === `${keepName}.bak`
      ) {
        continue;
      }
      if (
        !name.endsWith(".kvs") &&
        !name.endsWith(".kvs.meta") &&
        !name.endsWith(".kvs.tmp") &&
        !name.endsWith(".kvs.bak")
      ) {
        continue;
      }
      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      } catch {
        // ignore
      }
      // Strip AsyncStorage meta for foreign .kvs stems only
      if (name.endsWith(".kvs")) {
        const modelIdFromFile = name.slice(0, -".kvs".length);
        try {
          await AsyncStorage.removeItem(sessionMetaKey(modelIdFromFile));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // best-effort
  }
}

/** True if the .kvs file exists on disk. Never throws. */
export async function sessionFileExists(modelId: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(sessionFilePath(modelId));
    return Boolean(info.exists && !info.isDirectory);
  } catch {
    return false;
  }
}
