/**
 * Boot-loop defence bookkeeping, two pieces of small persisted state:
 * - a per-model death marker, written before a load starts and cleared after
 *   that load succeeds. If the process dies mid-load, the next launch refuses
 *   that modelId and starts on the fallback instead of launch → load → kill.
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
 * Boot start model: the persisted selection unless it carries a death marker;
 * a marked selection falls back to the last good model (never the marked one),
 * else the registry default.
 */
export function pickStartModel(input: {
  savedId: string;
  savedMarked: boolean;
  lastGoodId: string | null;
  defaultId: string;
}): string {
  if (!input.savedMarked) return input.savedId;
  if (input.lastGoodId && input.lastGoodId !== input.savedId) {
    return input.lastGoodId;
  }
  return input.defaultId;
}

/**
 * Fallback after a refused load: the last good model if it is not the one
 * that just failed, else the default. Null when even the default is the
 * refusal — the caller must then show the message and load nothing.
 */
export function pickFallbackModel(input: {
  refusedId: string;
  lastGoodId: string | null;
  defaultId: string;
}): string | null {
  if (input.lastGoodId && input.lastGoodId !== input.refusedId) {
    return input.lastGoodId;
  }
  return input.defaultId !== input.refusedId ? input.defaultId : null;
}
