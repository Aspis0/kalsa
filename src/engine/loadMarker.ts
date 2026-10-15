/**
 * Boot-loop defence bookkeeping, two pieces of small persisted state:
 * - a per-model death marker, written before a load starts and cleared when
 *   the load settles. A surviving marker only says the load did not settle:
 *   an app update or a swipe-kill also leaves it behind. It blocks the model
 *   only when Android reports that the process which wrote it died unclean
 *   after the stamp (see readLoadMarker). Best-effort, fail-open: a swallowed
 *   storage failure in the clear can leave a marker behind with the process
 *   alive; the user can still recover by re-selection.
 * - the id of the last model that loaded successfully, the fallback target.
 * Storage and the exit record are injected so the module is testable without
 * AsyncStorage or the native module.
 */
import type { ExitInfo } from "../../modules/kalsa-lifecycle/src";
import { isUncleanExit } from "../logReport/exitReasons";
import { loadMarkerKey } from "./loadMarkerKey";

export interface LoadMarkerStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The newest Android process-exit record, or null when none can be read. */
export type ExitReader = () => ExitInfo | null;

const LAST_GOOD_KEY = "kalsa.model.lastGoodId";
/** Loads in flight in this runtime, per model id: their markers are live. */
const loadsInFlight = new Map<string, number>();

export async function writeLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
): Promise<void> {
  await store.setItem(loadMarkerKey(modelId), JSON.stringify({ at: Date.now() }));
}

export async function clearLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
): Promise<void> {
  await store.removeItem(loadMarkerKey(modelId));
}

/**
 * The one reader of the marker: true only when the process that wrote it died
 * during the load. A marker the OS does not blame on the load is cleared here,
 * so the model loads. An exit record older than the stamp is not this load's
 * death. A legacy "1" carries no stamp and is judged by its exit record alone.
 * A confirmed death is stored in the marker, so a later clean exit (the user
 * swiping the crashed app away) cannot clear it; only the explicit clears and
 * a successful load remove it.
 */
export async function readLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
  readExit: ExitReader,
): Promise<boolean> {
  const raw = await store.getItem(loadMarkerKey(modelId));
  if (raw === null) return false;
  if (loadsInFlight.has(modelId)) return true;
  const marker = parseMarker(raw);
  if (marker.confirmed) return true;
  if (isDeathDuringLoad(marker.at, readExit())) {
    const confirmed = JSON.stringify({ at: marker.at, confirmed: true });
    await store.setItem(loadMarkerKey(modelId), confirmed).catch(() => undefined);
    return true;
  }
  await clearLoadMarker(store, modelId).catch(() => undefined);
  return false;
}

/** What a marker carries; a legacy "1" carries neither field. */
function parseMarker(raw: string): { at: number | null; confirmed: boolean } {
  try {
    const value = JSON.parse(raw) as { at?: unknown; confirmed?: unknown } | null;
    return {
      at: typeof value?.at === "number" ? value.at : null,
      confirmed: value?.confirmed === true,
    };
  } catch {
    return { at: null, confirmed: false };
  }
}

/**
 * An exit record that cannot be read is treated as a death, as before this
 * check existed: a real crash loop must stay blocked. A low-memory kill counts
 * even when the process was in the background, because a marker only exists
 * while a load is in flight.
 */
function isDeathDuringLoad(stamp: number | null, record: ExitInfo | null): boolean {
  if (record === null) return true;
  if (stamp !== null && record.timestampMs < stamp) return false;
  return record.reason === "low_memory" || isUncleanExit(record);
}

export async function writeLastGoodModelId(
  store: LoadMarkerStore,
  modelId: string,
): Promise<void> {
  await store.setItem(LAST_GOOD_KEY, modelId);
}

export async function readLastGoodModelId(
  store: LoadMarkerStore,
): Promise<string | null> {
  return store.getItem(LAST_GOOD_KEY);
}

/**
 * Marker lifecycle for ONE load attempt: written before `load` runs, cleared
 * the moment `load` settles — success or handled failure alike. If code is
 * running after the load failed, the process survived and the marker must not
 * outlive it; a storage failure never blocks the load (fail open). While it
 * runs, readLoadMarker treats this runtime's marker as live, never as a stale
 * one from an earlier process.
 */
export async function guardedLoad<T>(
  store: LoadMarkerStore,
  modelId: string,
  load: () => Promise<T>,
): Promise<T> {
  loadsInFlight.set(modelId, (loadsInFlight.get(modelId) ?? 0) + 1);
  try {
    await writeLoadMarker(store, modelId).catch(() => undefined);
    return await load();
  } finally {
    await clearLoadMarker(store, modelId).catch(() => undefined);
    const remaining = (loadsInFlight.get(modelId) ?? 1) - 1;
    if (remaining > 0) loadsInFlight.set(modelId, remaining);
    else loadsInFlight.delete(modelId);
  }
}

/**
 * Boot start model. Candidates in order: the persisted selection, the last
 * good model, the registry default. A candidate carrying a death marker is
 * never picked — the fallback passes the same marker check as the primary —
 * and null means every candidate is marked: load nothing at all.
 */
export async function pickStartModel(input: {
  savedId: string;
  lastGoodId: string | null;
  defaultId: string;
  isMarked: (modelId: string) => Promise<boolean>;
}): Promise<string | null> {
  if (!(await input.isMarked(input.savedId))) return input.savedId;
  for (const candidate of [input.lastGoodId, input.defaultId]) {
    if (!candidate || candidate === input.savedId) continue;
    if (!(await input.isMarked(candidate))) return candidate;
  }
  return null;
}

/**
 * Fallback after a refused load: the last good model, else the default —
 * never the model that just failed, never one we know died (marked), and
 * null when no candidate survives the marker check: no load at all.
 */
export async function pickFallbackModel(input: {
  refusedId: string;
  lastGoodId: string | null;
  defaultId: string;
  isMarked: (modelId: string) => Promise<boolean>;
}): Promise<string | null> {
  for (const candidate of [input.lastGoodId, input.defaultId]) {
    if (!candidate || candidate === input.refusedId) continue;
    if (!(await input.isMarked(candidate))) return candidate;
  }
  return null;
}

/**
 * True when at least one model other than the refused one is on disk. It
 * decides which refusal message is honest: pointing at a switchable model
 * versus telling the user to download a smaller one.
 */
export function hasOtherDownloadedModel(
  downloadedIds: string[],
  refusedId: string,
): boolean {
  return downloadedIds.some((id) => id !== refusedId);
}
