/**
 * Remote-brain prefs. Backend defaults to local (zero regression).
 * URL defaults to loopback (adb reverse). Server model-id is required and
 * is never inferred from /v1/models[0].
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeRemoteUrl } from "./remoteUrl";

export type EngineBackendMode = "local" | "remote";

export const ENGINE_BACKEND_KEY = "kalsa.engine.backend";
export const REMOTE_BRAIN_URL_KEY = "kalsa.remote-brain.url";
export const REMOTE_BRAIN_MODEL_KEY = "kalsa.remote-brain.model";
export const REMOTE_BRAIN_MAX_TOKENS_KEY = "kalsa.remote-brain.max-tokens";
export const REMOTE_BRAIN_TEMPERATURE_KEY = "kalsa.remote-brain.temperature";
export const REMOTE_BRAIN_CTX_KEY = "kalsa.remote-brain.ctx";

export const DEFAULT_REMOTE_BRAIN_URL = "http://127.0.0.1:8000";
export const DEFAULT_REMOTE_MAX_TOKENS = 4096;
export const DEFAULT_REMOTE_TEMPERATURE = 0.7;
export const DEFAULT_REMOTE_CTX = 32768;

let backendCache: EngineBackendMode = "local";
let urlCache = DEFAULT_REMOTE_BRAIN_URL;
let serverModelCache = "";
let maxTokensCache = DEFAULT_REMOTE_MAX_TOKENS;
let temperatureCache = DEFAULT_REMOTE_TEMPERATURE;
let ctxCache = DEFAULT_REMOTE_CTX;
/** When set, setEngineBackendMode refuses a conflicting mode (switch in flight). */
let backendWriteIntent: EngineBackendMode | null = null;

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

export async function setEngineBackendMode(
  mode: EngineBackendMode,
): Promise<void> {
  const next: EngineBackendMode = mode === "remote" ? "remote" : "local";
  if (backendWriteIntent != null && backendWriteIntent !== next) {
    return;
  }
  backendCache = next;
  await AsyncStorage.setItem(ENGINE_BACKEND_KEY, backendCache);
}

export async function setRemoteBrainUrl(url: string): Promise<void> {
  urlCache = normalizeUrl(url);
  await AsyncStorage.setItem(REMOTE_BRAIN_URL_KEY, urlCache);
}

export async function setRemoteServerModelId(id: string): Promise<void> {
  serverModelCache = id.trim();
  await AsyncStorage.setItem(REMOTE_BRAIN_MODEL_KEY, serverModelCache);
}

export async function setRemoteMaxTokens(n: number): Promise<void> {
  maxTokensCache =
    Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_REMOTE_MAX_TOKENS;
  await AsyncStorage.setItem(REMOTE_BRAIN_MAX_TOKENS_KEY, String(maxTokensCache));
}

export async function setRemoteTemperature(n: number): Promise<void> {
  temperatureCache =
    Number.isFinite(n) && n >= 0 && n <= 2 ? n : DEFAULT_REMOTE_TEMPERATURE;
  await AsyncStorage.setItem(
    REMOTE_BRAIN_TEMPERATURE_KEY,
    String(temperatureCache),
  );
}

export async function setRemoteContextSize(n: number): Promise<void> {
  ctxCache = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_REMOTE_CTX;
  await AsyncStorage.setItem(REMOTE_BRAIN_CTX_KEY, String(ctxCache));
}

export type RemoteBrainSnapshot = {
  backend: EngineBackendMode;
  url: string;
  serverModelId: string;
  maxTokens: number;
  temperature: number;
  ctx: number;
};

/**
 * Read-only snapshot. Does not write backendCache — only setEngineBackendMode
 * may change the live backend (boot applies the snapshot through that setter).
 */
export async function hydrateRemoteBrainSettings(): Promise<RemoteBrainSnapshot> {
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
    if (urlRaw) {
      const parsed = normalizeRemoteUrl(urlRaw);
      urlCache = parsed.ok ? parsed.url : DEFAULT_REMOTE_BRAIN_URL;
    } else {
      urlCache = DEFAULT_REMOTE_BRAIN_URL;
    }
    serverModelCache = (modelRaw ?? "").trim();
    maxTokensCache = parsePositiveInt(maxRaw, DEFAULT_REMOTE_MAX_TOKENS);
    temperatureCache = parseTemperature(tempRaw, DEFAULT_REMOTE_TEMPERATURE);
    ctxCache = parsePositiveInt(ctxRaw, DEFAULT_REMOTE_CTX);
    return {
      backend: backendRaw === "remote" ? "remote" : "local",
      url: urlCache,
      serverModelId: serverModelCache,
      maxTokens: maxTokensCache,
      temperature: temperatureCache,
      ctx: ctxCache,
    };
  } catch {
    urlCache = DEFAULT_REMOTE_BRAIN_URL;
    serverModelCache = "";
    maxTokensCache = DEFAULT_REMOTE_MAX_TOKENS;
    temperatureCache = DEFAULT_REMOTE_TEMPERATURE;
    ctxCache = DEFAULT_REMOTE_CTX;
    return {
      backend: "local",
      url: urlCache,
      serverModelId: serverModelCache,
      maxTokens: maxTokensCache,
      temperature: temperatureCache,
      ctx: ctxCache,
    };
  }
}
