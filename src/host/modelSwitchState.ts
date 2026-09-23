/** Shared storage key and single-flight lock for model/backend selection. */
export const MODEL_STORAGE_KEY = "kalsa.model.id";
export const modelSwitchInFlightRef = { current: false };

const settledListeners = new Set<() => void>();

export function subscribeModelSwitchSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function notifyModelSwitchSettled(): void {
  for (const listener of settledListeners) listener();
}
