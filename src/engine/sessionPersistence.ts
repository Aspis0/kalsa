/**
 * Native KV session persistence (llama.rn saveSession / loadSession).
 *
 * Pool files live under documents/sessions/ keyed by sessionStem
 * (model + conversation + prompt-env hash) + AsyncStorage meta that
 * validates history/cache/spec before restore. Pure helpers (hash, meta match)
 * have no RN side effects so the harness can exercise them offline.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { SESSION_DISK_GATE_USED_TOKENS } from "./ttftFlags";

export { SESSION_DISK_GATE_USED_TOKENS };

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
   * djb2 over JSON.stringify({locale, memoryFactsJoined, hasTools, tools, blockFormat}).
   * When MEMORY_FACTS_ON_USER_TAIL, callers must pass [] for facts so a new
   * fact does not cold-start the whole prefix. Mismatch → cold start.
   * Optional for back-compat reads. Changing the hashed shape invalidates
   * older saved sessions (one cold prefill).
   */
  promptEnvHash?: string;
  /**
   * Active conversation id when the session was saved. Optional for back-compat.
   * Both absent/empty match. One side non-empty and the other empty → mismatch.
   */
  conversationId?: string;
  /** Date.now() at save; ignored by sessionMetaMatches */
  savedAt?: number;
  /**
   * Format-B last-user prefixes baked into later engine history.
   * Payload only — ignored by sessionMetaMatches (historyHash is the gate).
   */
  bakedUserTails?: Array<{ bare: string; prefixed: string }>;
};

/**
 * True when loadSession returned a usable KV prefix.
 * llama.rn resolves with tokens_loaded=0 when the file is empty or not
 * resumable (SWA rollback clears embd) — that is not a successful restore.
 */
export function sessionLoadHasTokens(
  result: { tokens_loaded?: unknown } | null | undefined,
): boolean {
  return typeof result?.tokens_loaded === "number" && result.tokens_loaded > 0;
}

export type KvDiagPayload = {
  n_past: number;
  tokens_on_disk: number;
  ok: boolean;
};

/**
 * Honest restore line. §7.30 measured hybrid/kvUnified restores with
 * 1814–1946 resident and reused tokens, so tokens_loaded is restored n_past.
 * Never treat ok:true as reuse.
 */
export function buildKvDiagPayload(input: {
  ok: boolean;
  tokensLoaded: unknown;
}): KvDiagPayload {
  const tokens_on_disk =
    typeof input.tokensLoaded === "number" && Number.isFinite(input.tokensLoaded)
      ? input.tokensLoaded
      : 0;
  return {
    n_past: tokens_on_disk,
    tokens_on_disk,
    ok: input.ok === true,
  };
}

export type SessionSaveFingerprint = {
  stem: string;
  historyHash: string;
  usedTokens: number | null;
};

export function isSameSessionSave(
  previous: SessionSaveFingerprint | null,
  next: SessionSaveFingerprint,
): boolean {
  return (
    previous !== null &&
    previous.stem === next.stem &&
    previous.historyHash === next.historyHash &&
    previous.usedTokens === next.usedTokens
  );
}

export function rememberSuccessfulSessionSave(
  previous: SessionSaveFingerprint | null,
  next: SessionSaveFingerprint,
  succeeded: boolean,
): SessionSaveFingerprint | null {
  return succeeded ? next : previous;
}

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

/** AsyncStorage key for session meta of a stem (sanitized, same as file stem). */
export function sessionMetaKey(stem: string): string {
  return `kalsa.session.meta.${sanitizeModelId(stem)}`;
}

/** Pure path join: `${baseDir}sessions/${stem}.kvs` (baseDir should end with /). */
export function sessionFilePathForBase(baseDir: string, stem: string): string {
  const base = baseDir || "";
  const root = base.endsWith("/") || base === "" ? base : `${base}/`;
  return `${root}sessions/${sanitizeModelId(stem)}.kvs`;
}

/**
 * Session file path under app documents dir.
 * Reuses ModelDownloader base: FileSystem.documentDirectory.
 */
export function sessionFilePath(stem: string): string {
  return sessionFilePathForBase(FileSystem.documentDirectory ?? "", stem);
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

/** Full fact-text list for prompt-env hash — store order, never a tail slice. */
export function memoryFactTextsForEnvHash(
  facts: readonly { readonly text: string }[] | null | undefined,
): string[] {
  return (facts ?? []).map((f) => f.text);
}

/**
 * Hash of system-prompt env inputs that are not covered by historyHash.
 * Covers locale, memory facts (joined), whether tools are wired into
 * buildSystemPrompt, the sorted tool-name set, and blockFormat.
 * When MEMORY_FACTS_ON_USER_TAIL the caller must pass [] / omit facts — they
 * are no longer part of the system prompt. Changing the hashed shape
 * invalidates older saved sessions (one cold prefill).
 */
export function computePromptEnvHash(
  locale: string,
  memoryFacts: string[] | undefined | null,
  hasTools: boolean,
  toolNames?: readonly string[] | null,
  blockFormat?: string | null,
): string {
  const memoryFactsJoined = Array.isArray(memoryFacts) ? memoryFacts.join("\n") : "";
  const tools = Array.isArray(toolNames)
    ? [...new Set(toolNames.filter((n) => typeof n === "string" && n.length > 0))].sort()
    : [];
  return historyHash(
    JSON.stringify({
      locale,
      memoryFactsJoined,
      hasTools,
      tools,
      blockFormat: typeof blockFormat === "string" ? blockFormat : "",
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

export function sessionsDirectory(): string {
  const base = FileSystem.documentDirectory ?? "";
  const root = base.endsWith("/") || base === "" ? base : `${base}/`;
  return `${root}sessions/`;
}

/** Ensure documents/sessions/ exists. Best-effort; never throws. */
export async function ensureSessionsDir(): Promise<void> {
  try {
    const dir = sessionsDirectory();
    if (!dir) return;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // best-effort
  }
}

/**
 * Unmeasured default: dense measured ceiling ≈58–60 KB per used token
 * (q8_0 K / q4_0 V, 4B).
 */
export const SESSION_BYTES_PER_TOKEN = 64 * 1024;

function positiveSessionBytesPerToken(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : SESSION_BYTES_PER_TOKEN;
}

/** Free space must exceed this × estimated bytes (write + FS overhead). */
export const SESSION_DISK_MARGIN = 1.5;

/** Minimum free bytes even for a tiny session. */
export const SESSION_DISK_FLOOR_BYTES = 4 * 1024 * 1024;

/** Minimum token count when estimating from history (not from n_past). */
export const SESSION_DISK_TOKEN_FLOOR = 64;

/**
 * Conservative tokens-per-message when n_past is unknown.
 * Over-estimates (templates / system prompt) so we skip save rather than
 * fill the disk. Not nCtx — that blocked every save on small volumes.
 */
export const SESSION_DISK_TOKENS_PER_HISTORY_MSG = 512;

export type SessionDiskGateInput = {
  /** Native KV used tokens (completion tokens_cached / load tokens_loaded). */
  nPast?: number | null;
  /** Persisted chat message count; used only when nPast is unknown. */
  historyLength?: number | null;
  /** Context window; cap when the used-token flag is on, size when off. */
  nCtx?: number | null;
  /** Measured session file bytes per used token for the active model. */
  bytesPerToken?: number | null;
};

function finiteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

/**
 * Token count the disk gate should budget for.
 * Prefers n_past; if unknown, conservative historyLength * tokens/msg
 * (floor applied). Never falls back to full nCtx when the flag is on.
 * Returns null when neither n_past nor history is known (fail closed).
 */
export function resolveSessionDiskTokens(input: SessionDiskGateInput): number | null {
  const nCtx = finiteInt(input.nCtx);
  const cap = nCtx != null && nCtx > 0 ? nCtx : null;

  if (!SESSION_DISK_GATE_USED_TOKENS) {
    return cap ?? 0;
  }

  const nPast = finiteInt(input.nPast);
  if (nPast != null && nPast > 0) {
    return cap != null ? Math.min(nPast, cap) : nPast;
  }

  const historyLength = finiteInt(input.historyLength);
  if (historyLength != null && historyLength >= 0) {
    const estimated = Math.max(
      SESSION_DISK_TOKEN_FLOOR,
      historyLength * SESSION_DISK_TOKENS_PER_HISTORY_MSG,
    );
    return cap != null ? Math.min(estimated, cap) : estimated;
  }

  return null;
}

/** Estimate with a measured rate when available; otherwise use the unmeasured dense default. */
export function estimateSessionBytes(
  usedTokens: number,
  bytesPerToken = SESSION_BYTES_PER_TOKEN,
): number {
  const n = finiteInt(usedTokens);
  const rate = positiveSessionBytesPerToken(bytesPerToken);
  return (n != null && n > 0 ? n : 0) * rate;
}

/** Bytes of free space required to attempt a session write. */
export function sessionDiskBytesRequired(
  usedTokens: number,
  bytesPerToken = SESSION_BYTES_PER_TOKEN,
): number {
  const estimated = estimateSessionBytes(usedTokens, bytesPerToken);
  if (!SESSION_DISK_GATE_USED_TOKENS) {
    return SESSION_DISK_MARGIN * estimated;
  }
  return Math.max(SESSION_DISK_FLOOR_BYTES, estimated * SESSION_DISK_MARGIN);
}

/** Message count of persisted chat history, or null if missing/invalid. */
export async function readPersistedHistoryLength(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(bootMessagesKey);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
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

export async function hasEnoughDiskForSession(
  input: SessionDiskGateInput,
): Promise<boolean> {
  try {
    const usedTokens = resolveSessionDiskTokens(input);
    if (usedTokens == null) return false;
    const free = await FileSystem.getFreeDiskStorageAsync();
    return free > sessionDiskBytesRequired(usedTokens, input.bytesPerToken ?? undefined);
  } catch {
    return false;
  }
}

/** Read + parse session meta; null if missing/invalid. Never throws. */
export async function readSessionMeta(stem: string): Promise<SessionMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionMetaKey(stem));
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
    if (Array.isArray(parsed.bakedUserTails)) meta.bakedUserTails = parsed.bakedUserTails;
    return meta;
  } catch {
    return null;
  }
}

/** Write session meta. Returns false when setItem throws (never throws). */
export async function writeSessionMeta(stem: string, meta: SessionMeta): Promise<boolean> {
  try {
    await AsyncStorage.setItem(sessionMetaKey(stem), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete .kvs file + llama.rn `.kvs.meta` sidecar + any `.kvs.tmp` partial
 * + AsyncStorage meta. Idempotent, never throws.
 */
export async function deleteSessionArtifacts(stem: string): Promise<void> {
  if (!stem) return;
  const path = sessionFilePath(stem);
  for (const p of [path, `${path}.meta`, `${path}.tmp`, `${path}.bak`]) {
    try {
      await FileSystem.deleteAsync(p, { idempotent: true });
    } catch {
      // ignore
    }
  }
  try {
    await AsyncStorage.removeItem(sessionMetaKey(stem));
  } catch {
    // ignore
  }
}

/** True if the .kvs file exists on disk. Never throws. */
export async function sessionFileExists(stem: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(sessionFilePath(stem));
    return Boolean(info.exists && !info.isDirectory);
  } catch {
    return false;
  }
}

/**
 * If `.kvs` is missing and `.bak` exists, rename bak → kvs.
 * Kill between the two save-renames leaves only bak; load must recover it.
 * Returns true when a live `.kvs` exists afterwards. Never throws.
 */
export async function promoteSessionBak(stem: string): Promise<boolean> {
  if (!stem) return false;
  const path = sessionFilePath(stem);
  try {
    const live = await FileSystem.getInfoAsync(path);
    if (live.exists && !live.isDirectory) return true;
    const bak = `${path}.bak`;
    const bakInfo = await FileSystem.getInfoAsync(bak);
    if (!bakInfo.exists || bakInfo.isDirectory) return false;
    await FileSystem.moveAsync({ from: bak, to: path });
    return true;
  } catch {
    return false;
  }
}
