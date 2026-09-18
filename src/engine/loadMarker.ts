/**
 * Boot-loop defence bookkeeping, two pieces of small persisted state:
 * - a per-model death marker, written before a load starts. guardedLoad clears
 *   it on every settled outcome, so the marker that reaches the next launch
 *   means the process never reached its own error handler. One honest
 *   exception: a swallowed storage failure in the clear (disk gone, store
 *   broken) leaves a marker behind with the process alive — the clear is
 *   best-effort, fail-open, and the user can still recover by re-selection.
 * - the id of the last model that loaded successfully, the fallback target.
 * Storage is injected so the module is testable without AsyncStorage.
 */

export interface LoadMarkerStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const markerKey = (modelId: string): string => `kalsa.load.dead.${modelId}`;
const LAST_GOOD_KEY = "kalsa.model.lastGoodId";

export async function writeLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
): Promise<void> {
  await store.setItem(markerKey(modelId), "1");
}

export async function clearLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
): Promise<void> {
  await store.removeItem(markerKey(modelId));
}

export async function readLoadMarker(
  store: LoadMarkerStore,
  modelId: string,
): Promise<boolean> {
  return (await store.getItem(markerKey(modelId))) !== null;
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
 * outlive it; a storage failure never blocks the load (fail open).
 */
export async function guardedLoad<T>(
  store: LoadMarkerStore,
  modelId: string,
  load: () => Promise<T>,
): Promise<T> {
  await writeLoadMarker(store, modelId).catch(() => undefined);
  try {
    return await load();
  } finally {
    await clearLoadMarker(store, modelId).catch(() => undefined);
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
