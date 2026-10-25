/**
 * Defaults for the remote brain. Pure data, deliberately separate from
 * remoteSettings: the store is RN-coupled (AsyncStorage) and the model catalog
 * must stay importable without it.
 */

export const DEFAULT_REMOTE_BRAIN_URL = "";
export const DEFAULT_REMOTE_MAX_TOKENS = 4096;
export const DEFAULT_REMOTE_TEMPERATURE = 0.7;
export const DEFAULT_REMOTE_CTX = 32768;
