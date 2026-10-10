// The desktop app's own update, as the page asks for it. Rust does the check,
// the download and the install; this file only calls it and names its wire
// shapes.

import { available, invoke, listen } from "./tauri";

export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

export interface UpdateStatus {
  current: string;
  available: AvailableUpdate | null;
}

export interface UpdateProgress {
  done: number;
  total: number | null;
}

// The wire shape of a failed update step. `code` names a row of the `update`
// table in the per-language rust tables.
export interface UpdateErrorPayload {
  code: string;
  params?: Record<string, unknown>;
  text: string;
}

const UNAVAILABLE: UpdateErrorPayload = { code: "update.check_failed", text: "Kalsa couldn't check for updates. Try again later." };

export function appVersion(): Promise<string> {
  if (!available()) return Promise.reject(UNAVAILABLE);
  return invoke<string>("brain_app_version");
}

export function checkForUpdate(): Promise<UpdateStatus> {
  if (!available()) return Promise.reject(UNAVAILABLE);
  return invoke<UpdateStatus>("brain_update_check");
}

/** Installs `version`, the release the owner was shown. Rust installs only
    that one; if it has changed since, the call fails with `update.changed`. */
export function installUpdate(version: string): Promise<void> {
  if (!available()) return Promise.reject(UNAVAILABLE);
  return invoke<void>("brain_update_install", { version });
}

export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<() => void> {
  return listen("brain_update_progress", payload => handler(payload as UpdateProgress));
}

export function onUpdateAvailable(handler: (update: AvailableUpdate) => void): Promise<() => void> {
  return listen("brain_update_available", payload => handler(payload as AvailableUpdate));
}
