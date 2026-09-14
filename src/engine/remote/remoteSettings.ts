/**
 * Remote-brain prefs. Backend defaults to local (zero regression).
 * URL defaults to the Mac mtplx loopback (adb reverse on device).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type EngineBackendMode = "local" | "remote";

export const ENGINE_BACKEND_KEY = "kalsa.engine.backend";
export const REMOTE_BRAIN_URL_KEY = "kalsa.remote-brain.url";
export const DEFAULT_REMOTE_BRAIN_URL = "http://127.0.0.1:8000";
export const DEFAULT_REMOTE_MODEL_ID =
  "philipjohnbasile-ornith-ai-ornith-1.5-35b-a3b-v2-mtplx";

let backendCache: EngineBackendMode = "local";
let urlCache = DEFAULT_REMOTE_BRAIN_URL;
let hydrated = false;

export function getEngineBackendMode(): EngineBackendMode {
  return backendCache;
}

export function isRemoteEngineBackend(): boolean {
  return backendCache === "remote";
}

export function getRemoteBrainUrl(): string {
  return urlCache;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_REMOTE_BRAIN_URL;
}

export async function setEngineBackendMode(
  mode: EngineBackendMode,
): Promise<void> {
  backendCache = mode === "remote" ? "remote" : "local";
  await AsyncStorage.setItem(ENGINE_BACKEND_KEY, backendCache);
}

export async function setRemoteBrainUrl(url: string): Promise<void> {
  urlCache = normalizeUrl(url);
  await AsyncStorage.setItem(REMOTE_BRAIN_URL_KEY, urlCache);
}

export async function hydrateRemoteBrainSettings(): Promise<{
  backend: EngineBackendMode;
  url: string;
}> {
  try {
    const [backendRaw, urlRaw] = await Promise.all([
      AsyncStorage.getItem(ENGINE_BACKEND_KEY),
      AsyncStorage.getItem(REMOTE_BRAIN_URL_KEY),
    ]);
    backendCache = backendRaw === "remote" ? "remote" : "local";
    urlCache = urlRaw ? normalizeUrl(urlRaw) : DEFAULT_REMOTE_BRAIN_URL;
  } catch {
    backendCache = "local";
    urlCache = DEFAULT_REMOTE_BRAIN_URL;
  }
  hydrated = true;
  return { backend: backendCache, url: urlCache };
}

export function remoteSettingsHydrated(): boolean {
  return hydrated;
}
