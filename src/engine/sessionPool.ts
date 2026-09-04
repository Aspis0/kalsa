/**
 * UFS KV session pool: LRU eviction + stale prompt-env discard.
 * Budget is disk, not RAM (§7.25 / §7.20).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import {
  DEFAULT_SESSION_POOL_CONVERSATIONS,
  parseSessionPoolConversations,
  SESSION_POOL_STORAGE_KEY,
  sessionPoolBudgetBytes,
} from "./sessionBudget";
import {
  isLegacySessionFileName,
  legacySessionStem,
  parseSessionStem,
  sanitizeSessionSegment,
} from "./sessionKey";
import {
  deleteSessionArtifacts,
  promoteSessionBak,
  sessionsDirectory,
} from "./sessionPersistence";

const USED_KEY = "kalsa.session.pool.used.v1";

export async function readSessionPoolBudgetBytes(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_POOL_STORAGE_KEY);
    return sessionPoolBudgetBytes(parseSessionPoolConversations(raw));
  } catch {
    return sessionPoolBudgetBytes(DEFAULT_SESSION_POOL_CONVERSATIONS);
  }
}

export type PoolFile = {
  stem: string;
  bytes: number;
  lastUsedAt: number;
};

/** Oldest first, never the keep stem. Empty when already within budget. */
export function pickEvictionStems(
  files: PoolFile[],
  budgetBytes: number,
  keepStem: string,
): string[] {
  const budget = Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 0;
  let remaining = 0;
  for (const f of files) remaining += Math.max(0, f.bytes);
  if (remaining <= budget) return [];
  const ordered = files
    .filter((f) => f.stem !== keepStem)
    .slice()
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.stem.localeCompare(b.stem));
  const evict: string[] = [];
  for (const f of ordered) {
    if (remaining <= budget) break;
    evict.push(f.stem);
    remaining -= Math.max(0, f.bytes);
  }
  return evict;
}

/** Same model+conversation, different prompt-env hash — must not be reused. */
export function staleStemsForConversation(
  fileNames: string[],
  modelId: string,
  conversationId: string,
  keepEnvHash: string,
): string[] {
  const model = sanitizeSessionSegment(modelId);
  const conv = sanitizeSessionSegment(conversationId);
  const keep = sanitizeSessionSegment(keepEnvHash);
  if (!model || !conv) return [];
  const out: string[] = [];
  for (const name of fileNames) {
    const parsed = parseSessionStem(name);
    if (!parsed) continue;
    if (parsed.modelId !== model || parsed.conversationId !== conv) continue;
    if (keep && parsed.promptEnvHash === keep) continue;
    out.push(`${parsed.modelId}__${parsed.conversationId}__${parsed.promptEnvHash}`);
  }
  return out;
}

export async function touchSessionUse(stem: string, at = Date.now()): Promise<void> {
  if (!stem) return;
  try {
    const map = await readUsedMap();
    map[stem] = at;
    await AsyncStorage.setItem(USED_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

export async function evictSessionPool(
  keepStem: string,
  budgetBytes: number,
): Promise<void> {
  try {
    await sweepStaleSidecars(keepStem);
    const files = await listPoolFiles();
    const stems = pickEvictionStems(files, budgetBytes, keepStem);
    for (const stem of stems) await dropStem(stem);
  } catch {
    // best-effort
  }
}

/**
 * Drop pooled files for this model+conversation whose env hash is not `keepEnvHash`.
 * Returns how many were deleted (declared miss reason: promptEnvHash).
 */
export async function discardStaleConversationSessions(
  modelId: string,
  conversationId: string,
  keepEnvHash: string,
): Promise<number> {
  try {
    const names = await listKvsNames();
    const stems = staleStemsForConversation(
      names,
      modelId,
      conversationId,
      keepEnvHash,
    );
    for (const stem of stems) await dropStem(stem);
    return stems.length;
  } catch {
    return 0;
  }
}

/** All pooled files (any model / env hash) for one conversation. */
export async function deleteSessionsForConversation(
  conversationId: string,
): Promise<void> {
  const conv = sanitizeSessionSegment(conversationId);
  if (!conv) return;
  try {
    const names = await listKvsNames();
    for (const name of names) {
      const parsed = parseSessionStem(name);
      if (!parsed || parsed.conversationId !== conv) continue;
      await dropStem(
        `${parsed.modelId}__${parsed.conversationId}__${parsed.promptEnvHash}`,
      );
    }
  } catch {
    // best-effort
  }
}

/** All env-hash variants for one model+conversation, plus the legacy per-model file. */
export async function deleteSessionsForModelConversation(
  modelId: string,
  conversationId: string,
): Promise<void> {
  const model = sanitizeSessionSegment(modelId);
  const conv = sanitizeSessionSegment(conversationId);
  if (!model) return;
  try {
    const names = await listKvsNames();
    for (const name of names) {
      const parsed = parseSessionStem(name);
      if (parsed) {
        if (parsed.modelId !== model) continue;
        if (conv && parsed.conversationId !== conv) continue;
        await dropStem(
          `${parsed.modelId}__${parsed.conversationId}__${parsed.promptEnvHash}`,
        );
        continue;
      }
      if (isLegacySessionFileName(name) && name === `${legacySessionStem(modelId)}.kvs`) {
        await dropStem(legacySessionStem(modelId));
      }
    }
  } catch {
    // best-effort
  }
}

export async function deleteLegacyModelSession(modelId: string): Promise<void> {
  const stem = legacySessionStem(modelId);
  if (stem) await dropStem(stem);
}

async function dropStem(stem: string): Promise<void> {
  if (!stem) return;
  await deleteSessionArtifacts(stem);
  await forgetSessionUse(stem);
}

async function listSessionDirNames(): Promise<string[]> {
  const dir = sessionsDirectory();
  if (!dir) return [];
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return [];
  return FileSystem.readDirectoryAsync(dir);
}

async function listKvsNames(): Promise<string[]> {
  const names = await listSessionDirNames();
  return names.filter((name) => name.endsWith(".kvs"));
}

/** Filename stem for `.kvs` / `.kvs.tmp` / `.kvs.bak` / `.kvs.meta`. */
function stemFromPooledName(name: string): string | null {
  if (name.endsWith(".kvs.tmp")) return name.slice(0, -".kvs.tmp".length);
  if (name.endsWith(".kvs.bak")) return name.slice(0, -".kvs.bak".length);
  if (name.endsWith(".kvs.meta")) return name.slice(0, -".kvs.meta".length);
  if (name.endsWith(".kvs")) return name.slice(0, -".kvs".length);
  return null;
}

/**
 * Crash leftovers: delete foreign `.tmp` (never keepStem — may be an in-flight
 * write). Promote `.bak` with no `.kvs` (F3); drop `.bak` when `.kvs` exists.
 */
async function sweepStaleSidecars(keepStem: string): Promise<void> {
  const dir = sessionsDirectory();
  if (!dir) return;
  const names = await listSessionDirNames();
  const set = new Set(names);
  for (const name of names) {
    const stem = stemFromPooledName(name);
    if (!stem) continue;
    if (name.endsWith(".kvs.tmp")) {
      if (stem === keepStem) continue;
      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      } catch {
        // ignore
      }
      continue;
    }
    if (!name.endsWith(".kvs.bak")) continue;
    if (set.has(`${stem}.kvs`)) {
      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      } catch {
        // ignore
      }
    } else {
      await promoteSessionBak(stem);
    }
  }
}

async function listPoolFiles(): Promise<PoolFile[]> {
  const names = await listSessionDirNames();
  const used = await readUsedMap();
  const dir = sessionsDirectory();
  const byStem = new Map<string, PoolFile>();
  for (const name of names) {
    const stem = stemFromPooledName(name);
    if (!stem) continue;
    try {
      const info = await FileSystem.getInfoAsync(`${dir}${name}`);
      if (!info.exists || info.isDirectory) continue;
      const size = (info as { size?: number }).size;
      const mod = (info as { modificationTime?: number }).modificationTime;
      const bytes =
        typeof size === "number" && Number.isFinite(size) && size >= 0
          ? Math.floor(size)
          : 0;
      const lastUsedAt =
        used[stem] ??
        (typeof mod === "number" && Number.isFinite(mod) ? mod : 0);
      const prev = byStem.get(stem);
      if (prev) {
        prev.bytes += bytes;
        if (lastUsedAt > prev.lastUsedAt) prev.lastUsedAt = lastUsedAt;
      } else {
        byStem.set(stem, { stem, bytes, lastUsedAt });
      }
    } catch {
      continue;
    }
  }
  return [...byStem.values()];
}

async function readUsedMap(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(USED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function forgetSessionUse(stem: string): Promise<void> {
  if (!stem) return;
  try {
    const map = await readUsedMap();
    if (map[stem] === undefined) return;
    delete map[stem];
    await AsyncStorage.setItem(USED_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}
