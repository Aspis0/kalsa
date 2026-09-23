/**
 * Remote-brain prefs. Backend defaults to local (zero regression).
 * URL has no built-in default — the user must set their computer's address.
 * Server model-id is required and is never inferred from /v1/models[0].
 * The default values live in remoteDefaults (pure) and are re-exported here.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_REMOTE_BRAIN_URL,
  DEFAULT_REMOTE_CTX,
  DEFAULT_REMOTE_MAX_TOKENS,
  DEFAULT_REMOTE_TEMPERATURE,
} from "./remoteDefaults";
import { normalizeRemoteUrl } from "./remoteUrl";

export type EngineBackendMode = "local" | "remote";

export const ENGINE_BACKEND_KEY = "kalsa.engine.backend";
export const REMOTE_BRAIN_URL_KEY = "kalsa.remote-brain.url";
export const REMOTE_BRAIN_MODEL_KEY = "kalsa.remote-brain.model";
export const REMOTE_BRAIN_MAX_TOKENS_KEY = "kalsa.remote-brain.max-tokens";
export const REMOTE_BRAIN_TEMPERATURE_KEY = "kalsa.remote-brain.temperature";
export const REMOTE_BRAIN_CTX_KEY = "kalsa.remote-brain.ctx";

export {
  DEFAULT_REMOTE_BRAIN_URL,
  DEFAULT_REMOTE_CTX,
  DEFAULT_REMOTE_MAX_TOKENS,
  DEFAULT_REMOTE_TEMPERATURE,
};

let backendCache: EngineBackendMode = "local";
let urlCache = DEFAULT_REMOTE_BRAIN_URL;
let serverModelCache = "";
let maxTokensCache = DEFAULT_REMOTE_MAX_TOKENS;
let temperatureCache = DEFAULT_REMOTE_TEMPERATURE;
let ctxCache = DEFAULT_REMOTE_CTX;
/** When set, setEngineBackendMode refuses a conflicting mode (switch in flight). */
let backendWriteIntent: EngineBackendMode | null = null;
/** Sequence of hydrateRemoteBrainSettings calls: only the newest writes caches. */
let hydrationSeq = 0;

export function getEngineBackendMode(): EngineBackendMode {
  return backendCache;
}

/** Sole gate for backendCache writes besides setEngineBackendMode itself. */
export function beginBackendSwitch(intent: EngineBackendMode): void {
  backendWriteIntent = intent === "remote" ? "remote" : "local";
}

export function endBackendSwitch(): void {
  backendWriteIntent = null;
}

/** Boot catch / remount fallback: force local through the gated setter. */
export async function recoverLocalBackend(): Promise<void> {
  endBackendSwitch();
  await setEngineBackendMode("local");
}

export function isRemoteEngineBackend(): boolean {
  return backendCache === "remote";
}

export function getRemoteBrainUrl(): string {
  return urlCache;
}

export function getRemoteServerModelId(): string {
  return serverModelCache;
}

export function getRemoteMaxTokens(): number {
  return maxTokensCache;
}

export function getRemoteTemperature(): number {
  return temperatureCache;
}

export function getRemoteContextSize(): number {
  return ctxCache;
}

/** Null if ok; otherwise an error code. Empty served list skips membership check. */
export function validateServedModel(
  configured: string,
  servedIds: string[],
): string | null {
  const id = configured.trim();
  if (!id) return "remote_brain_model_required";
  if (servedIds.length > 0 && !servedIds.includes(id)) {
    return "remote_brain_model_missing";
  }
  return null;
}

export function normalizeUrl(raw: string): string {
  const parsed = normalizeRemoteUrl(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.url;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseTemperature(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : fallback;
}

/**
 * Cache-first write: the cache keeps the new value only if the disk took it.
 * Otherwise the running process works with a value the next start does not have,
 * and nothing says so.
 */
async function commit<T>(
  previous: T,
  next: T,
  assign: (value: T) => void,
  write: (value: T) => Promise<void>,
): Promise<void> {
  assign(next);
  try {
    await write(next);
  } catch (error) {
    assign(previous);
    throw error;
  }
}

export async function setEngineBackendMode(
  mode: EngineBackendMode,
): Promise<void> {
  const next: EngineBackendMode = mode === "remote" ? "remote" : "local";
  if (backendWriteIntent != null && backendWriteIntent !== next) {
    return;
  }
  await commit(backendCache, next, (value) => {
    backendCache = value;
  }, (value) => AsyncStorage.setItem(ENGINE_BACKEND_KEY, value));
}

export async function setRemoteBrainUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  const next = trimmed ? normalizeUrl(trimmed) : "";
  await commit(urlCache, next, (value) => {
    urlCache = value;
  }, (value) => AsyncStorage.setItem(REMOTE_BRAIN_URL_KEY, value));
}

export async function setRemoteServerModelId(id: string): Promise<void> {
  await commit(serverModelCache, id.trim(), (value) => {
    serverModelCache = value;
  }, (value) => AsyncStorage.setItem(REMOTE_BRAIN_MODEL_KEY, value));
}

export async function setRemoteMaxTokens(n: number): Promise<void> {
  const next =
    Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_REMOTE_MAX_TOKENS;
  await commit(maxTokensCache, next, (value) => {
    maxTokensCache = value;
  }, (value) => AsyncStorage.setItem(REMOTE_BRAIN_MAX_TOKENS_KEY, String(value)));
}

export async function setRemoteTemperature(n: number): Promise<void> {
  const next =
    Number.isFinite(n) && n >= 0 && n <= 2 ? n : DEFAULT_REMOTE_TEMPERATURE;
  await commit(temperatureCache, next, (value) => {
    temperatureCache = value;
  }, (value) => AsyncStorage.setItem(REMOTE_BRAIN_TEMPERATURE_KEY, String(value)));
}

export async function setRemoteContextSize(n: number): Promise<void> {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_REMOTE_CTX;
  await commit(ctxCache, next, (value) => {
    ctxCache = value;
  }, (value) => AsyncStorage.setItem(REMOTE_BRAIN_CTX_KEY, String(value)));
}

export type RemoteBrainSnapshot = {
  backend: EngineBackendMode;
  /** The hydration call this snapshot came from; see isHydrationCurrent. */
  hydrationSeq: number;
  url: string;
  /** True when REMOTE_BRAIN_URL_KEY was never written (null), not when it is "". */
  urlNeverSet: boolean;
  hydrationOk: boolean;
  urlParseError: string | null;
  serverModelId: string;
  maxTokens: number;
  temperature: number;
  ctx: number;
};

/**
 * False once a newer hydration has run: the snapshot in hand was read before
 * something changed the stored settings, so its values are obsolete and must not
 * steer a decision (nor be displayed as current).
 */
export function isHydrationCurrent(snapshot: { hydrationSeq: number }): boolean {
  return snapshot.hydrationSeq === hydrationSeq;
}

/**
 * Read-only snapshot. Does not write backendCache — only setEngineBackendMode
 * may change the live backend (boot applies the snapshot through that setter).
 * The value caches are written by the NEWEST call only: an older hydration that
 * finishes later must not resurrect the values it read before a newer one.
 */
export async function hydrateRemoteBrainSettings(): Promise<RemoteBrainSnapshot> {
  const seq = ++hydrationSeq;
  const newest = () => seq === hydrationSeq;
  try {
    const [backendRaw, urlRaw, modelRaw, maxRaw, tempRaw, ctxRaw] =
      await Promise.all([
        AsyncStorage.getItem(ENGINE_BACKEND_KEY),
        AsyncStorage.getItem(REMOTE_BRAIN_URL_KEY),
        AsyncStorage.getItem(REMOTE_BRAIN_MODEL_KEY),
        AsyncStorage.getItem(REMOTE_BRAIN_MAX_TOKENS_KEY),
        AsyncStorage.getItem(REMOTE_BRAIN_TEMPERATURE_KEY),
        AsyncStorage.getItem(REMOTE_BRAIN_CTX_KEY),
      ]);
    const urlNeverSet = urlRaw === null;
    let urlParseError: string | null = null;
    let url = DEFAULT_REMOTE_BRAIN_URL;
    if (urlRaw) {
      const parsed = normalizeRemoteUrl(urlRaw);
      if (parsed.ok) {
        url = parsed.url;
      } else {
        url = urlRaw.trim();
        urlParseError = parsed.error;
      }
    }
    const serverModelId = (modelRaw ?? "").trim();
    const maxTokens = parsePositiveInt(maxRaw, DEFAULT_REMOTE_MAX_TOKENS);
    const temperature = parseTemperature(tempRaw, DEFAULT_REMOTE_TEMPERATURE);
    const ctx = parsePositiveInt(ctxRaw, DEFAULT_REMOTE_CTX);
    if (newest()) {
      urlCache = url;
      serverModelCache = serverModelId;
      maxTokensCache = maxTokens;
      temperatureCache = temperature;
      ctxCache = ctx;
    }
    return {
      backend: backendRaw === "remote" ? "remote" : "local",
      hydrationSeq: seq,
      url,
      urlNeverSet,
      hydrationOk: true,
      urlParseError,
      serverModelId,
      maxTokens,
      temperature,
      ctx,
    };
  } catch {
    if (newest()) {
      urlCache = DEFAULT_REMOTE_BRAIN_URL;
      serverModelCache = "";
      maxTokensCache = DEFAULT_REMOTE_MAX_TOKENS;
      temperatureCache = DEFAULT_REMOTE_TEMPERATURE;
      ctxCache = DEFAULT_REMOTE_CTX;
    }
    return {
      backend: "local",
      hydrationSeq: seq,
      url: DEFAULT_REMOTE_BRAIN_URL,
      urlNeverSet: true,
      hydrationOk: false,
      urlParseError: null,
      serverModelId: "",
      maxTokens: DEFAULT_REMOTE_MAX_TOKENS,
      temperature: DEFAULT_REMOTE_TEMPERATURE,
      ctx: DEFAULT_REMOTE_CTX,
    };
  }
}
