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
  EVICT_REASON_FAILED,
  EVICT_REASON_GATE_UNREADABLE,
  EVICT_REASON_INVALID_BUDGET,
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
  sessionDiskDeficitBytes,
  sessionDiskGate,
  sessionsDirectory,
  type SessionDiskGateInput,
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
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return [];
  const budget = budgetBytes;
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
 * — a measured deficit, not a budget. The final whole file may overshoot the
 * need. Never the keep stem, never the static-prefix snapshot.
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
  const budget =
    Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : 0;
  const validBudget = Number.isFinite(budgetBytes) && budgetBytes > 0;
  marker.set({ mode: "budget", keepModel, budgetBytes: budget });
  // The pre-sweep reading labels a failure line only. The post-sweep reading
  // decides policy and foreign-model eligibility.
  const labelFreeBytes = await getFreeDiskBytes();
  const labelRegime: EvictionRegime = evictionGoesGlobal(labelFreeBytes)
    ? "global"
    : "per-model";
  marker.set({
    policy: labelRegime,
    freeBytes: labelFreeBytes,
    // Present even when the run victims nothing: "victims: 0" is itself the
    // diagnostic.
    victims: 0,
    bytes: 0,
    victimModels: [],
  });
  if (!validBudget) {
    marker.set({ ok: false, reason: EVICT_REASON_INVALID_BUDGET });
    marker.emit();
    return;
  }
  let dropped = 0;
  let freedBytes = 0;
  let dropFailed = false;
  let bookkeepingFailed = false;
  const victimModels = new Set<string>();
  try {
    marker.set({ sidecars: await sweepStaleSidecars(keepStem) });
    const decisionFreeBytes = await getFreeDiskBytes();
    const regime: EvictionRegime = evictionGoesGlobal(decisionFreeBytes)
      ? "global"
      : "per-model";
    marker.set({ policy: regime, freeBytes: decisionFreeBytes });
    const files = await listPoolFiles();
    const stems = pickEvictionStems(files, budget, keepStem, regime);
    const bytesByStem = new Map(
      files.map((f) => [f.stem, Math.max(0, f.bytes)]),
    );
    for (const stem of stems) {
      const drop = await dropStem(stem);
      if (!drop.artifactsDeleted) {
        dropFailed = true;
        marker.set({
          ok: false,
          reason: EVICT_REASON_FAILED,
          errorType: "DeleteFailed",
        });
        continue;
      }
      if (drop.bookkeepingFailed) {
        bookkeepingFailed = true;
        marker.set({ bookkeepingFailed: true });
      }
      freedBytes += bytesByStem.get(stem) ?? 0;
      const victimModel = modelIdOfStem(stem);
      if (victimModel != null) victimModels.add(victimModel);
      dropped += 1;
      // Progress counts only completed drops; failed drops leave counters unchanged.
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
      ok: !stillOver && !dropFailed,
      totalBytes,
      poolBytes,
      ...(bookkeepingFailed ? { bookkeepingFailed: true } : {}),
      ...(!dropFailed && stillOver
        ? { reason: EVICT_REASON_UNEVICTABLE }
        : {}),
    });
  } catch (err) {
    marker.thrown(err);
  }
  marker.emit();
}

export type SpaceEvictionStatus =
  | "covered"
  | "not_needed"
  | "uncoverable"
  | "gate_unreadable"
  | "drop_failed"
  | "evict_failed";

export type SpaceEvictionResult = {
  status: SpaceEvictionStatus;
  /** True when the caller must not proceed to the save. */
  insufficient: boolean;
  /** Bytes counted for completed drops; a failed batch may be partial. */
  bytes: number;
  /** The post-sweep deficit, or null when the gate did not measure one. */
  requiredDeficitBytes: number | null;
};

/**
 * Space eviction for the disk-gate refusal path: free the MEASURED deficit,
 * foreign first, using whole session files until the need is covered — never
 * down to a budget.
 *
 * The guard here has an honest limit: the deficit is an estimate (required
 * and free bytes from one gate reading — and the gate itself estimates, at
 * the 64 KiB/token fallback rate for an uncalibrated model, with calibration
 * written only after a successful save), and the disk can move between the
 * measurement and the write. So "evictable < deficit → no whole session cache
 * dropped" means do not pay the user's caches for a write that provably cannot
 * succeed; the stale-sidecar sweep still runs. It does NOT mean "deleting will
 * certainly be enough". The residual case (deleted, still failed) stays, with
 * the bytes on this run's marker and on the save's failure line.
 */
export async function evictSessionPoolForSpace(
  keepStem: string,
  diskInput: SessionDiskGateInput,
): Promise<SpaceEvictionResult> {
  const marker = beginEvictMarker();
  const keepModel = modelIdOfStem(keepStem);
  // This pre-sweep reading labels a sweep failure only; it never decides the
  // deficit or whether a cache may be deleted.
  const labelFreeBytes = await getFreeDiskBytes();
  marker.set({
    mode: "space",
    policy: "global",
    keepModel,
    neededBytes: 0,
    evictableBytes: 0,
    freeBytes: labelFreeBytes,
    sidecars: 0,
    victims: 0,
    bytes: 0,
    victimModels: [],
  });
  const result: SpaceEvictionResult = {
    status: "evict_failed",
    insufficient: true,
    requiredDeficitBytes: null,
    bytes: 0,
  };
  let dropped = 0;
  let freedBytes = 0;
  let bookkeepingFailed = false;
  const victimModels = new Set<string>();
  try {
    // The caller's first gate read authorized this run; the sweep can itself
    // close the deficit, so deliberately re-read before measuring or logging.
    marker.set({ sidecars: await sweepStaleSidecars(keepStem) });
    const gate = await sessionDiskGate(diskInput);
    // The gate's post-sweep reading decides deletion and labels this marker;
    // do not take a second reading that could disagree with it.
    marker.set({ freeBytes: gate.freeBytes });
    let need: number | null;
    if (gate.ok) {
      result.status = "not_needed";
      result.insufficient = false;
      result.requiredDeficitBytes = 0;
      need = 0;
      marker.set({ neededBytes: 0 });
    } else if (gate.reason !== "short") {
      // An unreadable or unsized post-sweep gate cannot authorize deletion;
      // fail loudly instead of turning null arithmetic into a success.
      result.status = "gate_unreadable";
      marker.set({
        ok: false,
        reason: EVICT_REASON_GATE_UNREADABLE,
        gateReason: gate.reason ?? "unknown",
        neededBytes: null,
      });
      need = null;
    } else {
      // Only "short" authorizes deletion; zero is a consequence of a
      // malformed short measurement, not the guard that authorizes it.
      const measuredNeed = sessionDiskDeficitBytes(
        gate.requiredBytes,
        gate.freeBytes,
      );
      if (measuredNeed <= 0) {
        result.status = "gate_unreadable";
        marker.set({
          ok: false,
          reason: EVICT_REASON_GATE_UNREADABLE,
          gateReason: "short_without_measurement",
          neededBytes: null,
        });
        need = null;
      } else {
        result.status = "covered";
        result.insufficient = false;
        result.requiredDeficitBytes = measuredNeed;
        marker.set({ neededBytes: measuredNeed });
        need = measuredNeed;
      }
    }
    const files = await listPoolFiles();
    // Evictable = what this eviction could actually free: chat files, never
    // the snapshot, never the file being saved.
    const evictable = chatTotalBytes(
      files.filter((f) => !isStaticPrefixStem(f.stem) && f.stem !== keepStem),
    );
    marker.set({ evictableBytes: evictable });
    if (need == null) {
      // The gate branch already recorded the explicit refusal.
    } else if (need === 0) {
      marker.set({ ok: true, outcome: "not_needed" });
    } else if (evictable < need) {
      // Post-sweep inventory cannot cover the post-sweep deficit: drop no
      // whole session cache and let the caller report this refusal.
      result.status = "uncoverable";
      result.insufficient = true;
      marker.set({ ok: false, reason: EVICT_REASON_DEFICIT });
    } else {
      const stems = pickEvictionStemsForBytes(files, need, keepStem);
      const bytesByStem = new Map(
        files.map((f) => [f.stem, Math.max(0, f.bytes)]),
      );
      for (const stem of stems) {
        const drop = await dropStem(stem);
        if (!drop.artifactsDeleted) {
          result.status = "drop_failed";
          result.insufficient = true;
          marker.set({
            ok: false,
            reason: EVICT_REASON_FAILED,
            errorType: "DeleteFailed",
          });
          break;
        }
        if (drop.bookkeepingFailed) {
          bookkeepingFailed = true;
          marker.set({ bookkeepingFailed: true });
        }
        freedBytes += bytesByStem.get(stem) ?? 0;
        result.bytes = freedBytes;
        const victimModel = modelIdOfStem(stem);
        if (victimModel != null) victimModels.add(victimModel);
        dropped += 1;
        // Progress counts only completed drops; failed drops leave counters unchanged.
        marker.set({
          victims: dropped,
          bytes: freedBytes,
          victimModels: [...victimModels].sort(),
        });
      }
      if (result.status === "covered") {
        marker.set({ ok: true, outcome: "covered" });
      }
    }
    marker.set({
      poolBytes: chatTotalBytes(
        files.filter((f) => !isStaticPrefixStem(f.stem)),
      ),
      ...(bookkeepingFailed ? { bookkeepingFailed: true } : {}),
    });
  } catch (err) {
    // Unexpected errors outside dropStem leave the run failed; ordinary drop
    // failures are returned and counted explicitly above.
    result.status = "evict_failed";
    result.insufficient = true;
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
  // deleteAsync failures are contained inside deleteSessionArtifacts, so a
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

type DropResult = {
  artifactsDeleted: boolean;
  usageForgotten: boolean;
  bookkeepingFailed: boolean;
};

async function dropStem(stem: string): Promise<DropResult> {
  if (!stem) {
    return {
      artifactsDeleted: false,
      usageForgotten: false,
      bookkeepingFailed: false,
    };
  }
  // Eviction uses disk deletion separately from bookkeeping. The
  // path-divergent-name case remains out of scope, as do the boolean results
  // from keepOnlyStaticPrefixSnapshot and discardStaleConversationSessions.
  const deletion = await deleteSessionArtifacts(stem);
  const usageForgotten = await forgetSessionUse(stem);
  return {
    artifactsDeleted: deletion.cacheDeleted,
    usageForgotten,
    bookkeepingFailed: deletion.bookkeepingFailed || !usageForgotten,
  };
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

async function forgetSessionUse(stem: string): Promise<boolean> {
  if (!stem) return false;
  try {
    const map = await readUsedMap();
    if (map[stem] === undefined) return true;
    delete map[stem];
    await AsyncStorage.setItem(USED_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}
