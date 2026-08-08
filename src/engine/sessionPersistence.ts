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
  historyHash: string;
  /**
   * djb2 over JSON.stringify({locale, memoryFactsJoined, hasTools:true}).
   * Mismatch → cold start (same as historyHash). Optional for back-compat reads.
   */
  promptEnvHash?: string;
  /** Date.now() at save; ignored by sessionMetaMatches */
  savedAt?: number;
};

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
 * Hash of system-prompt env inputs that are not covered by historyHash.
 * `hasTools` is always the literal `true` today (tools wired on every chat turn).
 * Uses the same djb2 as historyHash.
 */
export function computePromptEnvHash(
  locale: string,
  memoryFacts: string[] | undefined | null,
): string {
  const memoryFactsJoined = Array.isArray(memoryFacts) ? memoryFacts.join("\n") : "";
  return historyHash(
    JSON.stringify({
      locale,
      memoryFactsJoined,
      hasTools: true,
    }),
  );
}

/**
 * True when stored meta is safe to load for the current engine + history.
 * Does NOT require savedAt equality. Optional mtpNMax/specType: missing and
 * undefined are treated as equal. promptEnvHash must match (missing ≡ undefined).
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
    if (typeof parsed.promptEnvHash === "string") meta.promptEnvHash = parsed.promptEnvHash;
    if (typeof parsed.savedAt === "number") meta.savedAt = parsed.savedAt;
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
