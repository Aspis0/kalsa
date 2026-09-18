/**
 * UFS KV session pool: per-model LRU eviction (budget mode) + space eviction
 * for the disk-gate refusal path + stale prompt-env discard.
 * Budget is disk, not RAM (§7.25 / §7.20). Every eviction run emits one
 * KALSA_SESSION line; stems (conversation ids) never reach it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { getFreeDiskBytes } from "./deviceProfile";
import {
  beginEvictMarker,
  EVICT_REASON_DEFICIT,
  EVICT_REASON_UNEVICTABLE,
} from "./sessionEvictMarker";
import {
  DEFAULT_SESSION_POOL_CONVERSATIONS,
  evictionGoesGlobal,
  parseSessionPoolConversations,
  SESSION_POOL_STORAGE_KEY,
  sessionPoolBudgetBytes,
} from "./sessionBudget";
import {
  isLegacySessionFileName,
  isStaticPrefixStem,
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

function modelIdOfStem(stem: string): string | null {
  return parseSessionStem(`${stem}.kvs`)?.modelId ?? null;
}

const byLru = (a: PoolFile, b: PoolFile): number =>
  a.lastUsedAt - b.lastUsedAt || a.stem.localeCompare(b.stem);

function chatTotalBytes(files: PoolFile[]): number {
  let total = 0;
  for (const f of files) total += Math.max(0, f.bytes);
  return total;
}

/** Walk a pre-ordered victim list until `remaining` fits in `budget`. */
function drainToBudget(
  ordered: PoolFile[],
  remaining: number,
  budget: number,
): string[] {
  const evict: string[] = [];
  for (const f of ordered) {
    if (remaining <= budget) break;
    evict.push(f.stem);
    remaining -= Math.max(0, f.bytes);
  }
  return evict;
}

/** Which charge eviction enforces: the save's own model only, or everyone. */
export type EvictionRegime = "per-model" | "global";

/** Foreign-model first, then oldest lastUsedAt. The global/space order. */
function orderByForeignFirstLru(
  chatFiles: PoolFile[],
  keepStem: string,
  keepModel: string | null,
): PoolFile[] {
  const isForeign = (stem: string): boolean => {
    if (keepModel == null) return false;
    const model = modelIdOfStem(stem);
    return model != null && model !== keepModel;
  };
  return chatFiles
    .filter((f) => f.stem !== keepStem)
    .slice()
    .sort((a, b) => {
      const aForeign = isForeign(a.stem);
      const bForeign = isForeign(b.stem);
      if (aForeign !== bForeign) return aForeign ? -1 : 1;
      return byLru(a, b);
    });
}

/**
 * Budget-mode eviction victims for a save of `keepStem` under `regime`.
 *
 * Per-model: only conversations of the keep model are charged and offered as
 * victims, so a save for model A never deletes model B's warm KV cache — that
 * eviction is what made every model switch pay a full cold prefill again.
 * Global: foreign-model files first, then oldest lastUsedAt. Never the keep
 * stem. The free-space reading that selects the regime lives with the caller
 * (evictionGoesGlobal) — this picker takes the regime explicitly, never a
 * sentinel reading.
 */
export function pickEvictionStems(
  files: PoolFile[],
  budgetBytes: number,
  keepStem: string,
  regime: EvictionRegime,
): string[] {
  const budget = Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 0;
  // The static-prefix snapshot is infrastructure, not a conversation: it is
  // neither charged to the budget nor offered as a victim. Otherwise, at the
  // picker's minimum of 1 conversation, a long chat plus the snapshot is over
  // budget and each save deletes the other's file — save, evict, recompute a
  // 40 s prefill, save. Its size is bounded by keeping exactly one snapshot
  // file on disk (saveStaticPrefixSnapshot), not by this LRU.
  const chatFiles = files.filter((f) => !isStaticPrefixStem(f.stem));
  const keepModel = modelIdOfStem(keepStem);
  if (regime === "per-model") {
    // Only a file that provably belongs to the saved model may be evicted.
    // An unparseable keep stem (a legacy `${modelId}.kvs`) therefore evicts
    // nothing here; legacy files are handled by deleteLegacyModelSession and
    // deleteSessionsForModelConversation.
    if (keepModel == null) return [];
    const own = chatFiles.filter((f) => modelIdOfStem(f.stem) === keepModel);
    const total = chatTotalBytes(own);
    if (total <= budget) return [];
    return drainToBudget(
      own.filter((f) => f.stem !== keepStem).slice().sort(byLru),
      total,
      budget,
    );
  }
  const total = chatTotalBytes(chatFiles);
  if (total <= budget) return [];
  return drainToBudget(
    orderByForeignFirstLru(chatFiles, keepStem, keepModel),
    total,
    budget,
  );
}

/**
 * Space-mode victims for the disk-gate refusal path: foreign-model files
 * first, then oldest lastUsedAt, taken until their bytes cover `bytesNeeded`
 * — a measured deficit, not a budget, so at most the deficit is paid and no
 * more. Never the keep stem, never the static-prefix snapshot.
 */
export function pickEvictionStemsForBytes(
  files: PoolFile[],
  bytesNeeded: number,
  keepStem: string,
): string[] {
  const chatFiles = files.filter((f) => !isStaticPrefixStem(f.stem));
  let need = Number.isFinite(bytesNeeded) && bytesNeeded > 0 ? bytesNeeded : 0;
  if (need === 0) return [];
  const ordered = orderByForeignFirstLru(
    chatFiles,
    keepStem,
    modelIdOfStem(keepStem),
  );
  const evict: string[] = [];
  for (const f of ordered) {
    if (need <= 0) break;
    evict.push(f.stem);
    need -= Math.max(0, f.bytes);
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

/**
 * Keep exactly one static-prefix snapshot on disk: the one just written.
 *
 * This is the snapshot's whole size bound, since pickEvictionStems no longer
 * charges it to the conversation budget. Any other snapshot is by definition
 * a dead identity — a previous model, prompt, tool set or locale — and cannot
 * be restored, only refused. Returns how many stems were dropped.
 */
export async function keepOnlyStaticPrefixSnapshot(
  keepStem: string,
): Promise<number> {
  let dropped = 0;
  try {
    for (const name of await listSessionDirNames()) {
      const stem = stemFromPooledName(name);
      if (!stem || stem === keepStem || !isStaticPrefixStem(stem)) continue;
      await dropStem(stem);
      dropped += 1;
    }
  } catch {
    // best-effort: a stale snapshot costs disk, never correctness
  }
  return dropped;
}

/** The total the regime charges against budgetBytes (snapshot excluded). */
function chargedTotalBytes(
  files: PoolFile[],
  keepModel: string | null,
  global: boolean,
): number {
  // Per-model with an unparseable keep stem charges nothing: no file can be
  // proven to belong to the save.
  if (!global && keepModel == null) return 0;
  let total = 0;
  for (const f of files) {
    if (isStaticPrefixStem(f.stem)) continue;
    if (!global && modelIdOfStem(f.stem) !== keepModel) continue;
    total += Math.max(0, f.bytes);
  }
  return total;
}

/**
 * Budget-mode LRU eviction for one save + stale-sidecar sweep.
 *
 * Emits exactly one KALSA_SESSION line per run via sessionEvictMarker —
 * victims, bytes, keep/victim modelIds, the budget/total figures that decided
 * it, and poolBytes (every chat file on disk, all models). Never a stem.
 *
 * Regime: the free-space floor selects it (evictionGoesGlobal) and the picker
 * takes it explicitly. Space eviction — freeing a measured deficit on the
 * disk-gate refusal path — is evictSessionPoolForSpace, not this.
 */
export async function evictSessionPool(
  keepStem: string,
  budgetBytes: number,
): Promise<void> {
  const marker = beginEvictMarker();
  const keepModel = modelIdOfStem(keepStem);
  marker.set({ mode: "budget", keepModel, budgetBytes });
  // getFreeDiskBytes never throws (deviceProfile contract); everything after
  // this point can, and the line must still carry policy/freeBytes when it
  // does — so they are set before any throwing read.
  const freeBytes = await getFreeDiskBytes();
  const regime: EvictionRegime = evictionGoesGlobal(freeBytes)
    ? "global"
    : "per-model";
  marker.set({
    policy: regime,
    freeBytes,
    // Present even when the run victims nothing: "victims: 0" is itself the
    // diagnostic.
    victims: 0,
    bytes: 0,
    victimModels: [],
  });
  const budget =
    Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 0;
  let dropped = 0;
  let freedBytes = 0;
  const victimModels = new Set<string>();
  try {
    marker.set({ sidecars: await sweepStaleSidecars(keepStem) });
    const files = await listPoolFiles();
    const stems = pickEvictionStems(files, budgetBytes, keepStem, regime);
    const bytesByStem = new Map(
      files.map((f) => [f.stem, Math.max(0, f.bytes)]),
    );
    for (const stem of stems) {
      freedBytes += bytesByStem.get(stem) ?? 0;
      const victimModel = modelIdOfStem(stem);
      if (victimModel != null) victimModels.add(victimModel);
      await dropStem(stem);
      dropped += 1;
      // Progress lands in the line even if a later drop throws mid-batch.
      marker.set({
        victims: dropped,
        bytes: freedBytes,
        victimModels: [...victimModels].sort(),
      });
    }
    const totalBytes = chargedTotalBytes(
      files,
      keepModel,
      regime === "global",
    );
    const poolBytes = chatTotalBytes(
      files.filter((f) => !isStaticPrefixStem(f.stem)),
    );
    const stillOver = totalBytes - freedBytes > budget;
    marker.set({
      ok: !stillOver,
      totalBytes,
      poolBytes,
      ...(stillOver ? { reason: EVICT_REASON_UNEVICTABLE } : {}),
    });
  } catch (err) {
    marker.thrown(err);
  }
  marker.emit();
}

export type SpaceEvictionResult = {
  /** True when evictable bytes could not cover the need: nothing deleted. */
  insufficient: boolean;
  /** Bytes actually dropped, as measured before dropping; 0 if insufficient. */
  bytes: number;
};

/**
 * Space eviction for the disk-gate refusal path: free the MEASURED deficit,
 * foreign first, at most that much — never down to a budget.
 *
 * The guard here has an honest limit: the deficit is an estimate (required
 * and free bytes from one gate reading — and the gate itself estimates, at
 * the 64 KiB/token fallback rate for an uncalibrated model, with calibration
 * written only after a successful save), and the disk can move between the
 * measurement and the write. So "evictable < deficit → delete nothing" means
 * do not pay the user's caches for a write that provably cannot succeed —
 * it does NOT mean "deleting will certainly be enough". The residual case
 * (deleted, still failed) stays, with the bytes on this run's marker and on
 * the save's failure line.
 */
export async function evictSessionPoolForSpace(
  keepStem: string,
  bytesNeeded: number,
): Promise<SpaceEvictionResult> {
  const marker = beginEvictMarker();
  const keepModel = modelIdOfStem(keepStem);
  marker.set({ mode: "space", policy: "global", keepModel, neededBytes: bytesNeeded });
  // getFreeDiskBytes never throws (deviceProfile contract); policy and
  // freeBytes are on the line before any throwing read.
  const freeBytes = await getFreeDiskBytes();
  marker.set({
    freeBytes,
    victims: 0,
    bytes: 0,
    victimModels: [],
  });
  const result: SpaceEvictionResult = { insufficient: false, bytes: 0 };
  let dropped = 0;
  let freedBytes = 0;
  const victimModels = new Set<string>();
  try {
    marker.set({ sidecars: await sweepStaleSidecars(keepStem) });
    const files = await listPoolFiles();
    // Evictable = what this eviction could actually free: chat files, never
    // the snapshot, never the file being saved.
    const evictable = chatTotalBytes(
      files.filter((f) => !isStaticPrefixStem(f.stem) && f.stem !== keepStem),
    );
    const need =
      Number.isFinite(bytesNeeded) && bytesNeeded > 0 ? bytesNeeded : 0;
    marker.set({ evictableBytes: evictable });
    if (evictable < need) {
      // Provably cannot be enough: delete nothing (docstring's limit).
      result.insufficient = true;
      marker.set({ ok: false, reason: EVICT_REASON_DEFICIT });
    } else {
      const stems = pickEvictionStemsForBytes(files, need, keepStem);
      const bytesByStem = new Map(
        files.map((f) => [f.stem, Math.max(0, f.bytes)]),
      );
      for (const stem of stems) {
        freedBytes += bytesByStem.get(stem) ?? 0;
        const victimModel = modelIdOfStem(stem);
        if (victimModel != null) victimModels.add(victimModel);
        await dropStem(stem);
        dropped += 1;
        // Progress lands in the line even if a later drop throws mid-batch.
        marker.set({
          victims: dropped,
          bytes: freedBytes,
          victimModels: [...victimModels].sort(),
        });
      }
      result.bytes = freedBytes;
      marker.set({ ok: true });
    }
    marker.set({
      poolBytes: chatTotalBytes(
        files.filter((f) => !isStaticPrefixStem(f.stem)),
      ),
    });
  } catch (err) {
    marker.thrown(err);
  }
  marker.emit();
  return result;
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
  const matches = (name: string): boolean => {
    const parsed = parseSessionStem(name);
    if (parsed) {
      return parsed.modelId === model && (!conv || parsed.conversationId === conv);
    }
    return (
      isLegacySessionFileName(name) &&
      name === `${legacySessionStem(modelId)}.kvs`
    );
  };
  for (const name of await listKvsNames()) {
    if (!matches(name)) continue;
    const parsed = parseSessionStem(name);
    await dropStem(
      parsed
        ? `${parsed.modelId}__${parsed.conversationId}__${parsed.promptEnvHash}`
        : legacySessionStem(modelId),
    );
  }
  // deleteAsync failures are swallowed inside deleteSessionArtifacts, so a
  // stale .kvs could survive what looks like a successful clear and be reused
  // on the next boot. Re-list and throw, so callers' diskOk is not a lie.
  const survivors = (await listKvsNames()).filter(matches);
  if (survivors.length > 0) {
    throw new Error(
      `session clear left ${survivors.length} .kvs for ${model}${
        conv ? `/${conv}` : ""
      }`,
    );
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
 * Returns how many sidecars were deleted (counted into the evict marker line).
 */
async function sweepStaleSidecars(keepStem: string): Promise<number> {
  const dir = sessionsDirectory();
  if (!dir) return 0;
  const names = await listSessionDirNames();
  const set = new Set(names);
  let deleted = 0;
  for (const name of names) {
    const stem = stemFromPooledName(name);
    if (!stem) continue;
    if (name.endsWith(".kvs.tmp")) {
      if (stem === keepStem) continue;
      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
        deleted += 1;
      } catch {
        // ignore
      }
      continue;
    }
    if (!name.endsWith(".kvs.bak")) continue;
    if (set.has(`${stem}.kvs`)) {
      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
        deleted += 1;
      } catch {
        // ignore
      }
    } else {
      await promoteSessionBak(stem);
    }
  }
  return deleted;
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
