import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** The global convenience object is off; the official API uses Tauri's
    internal IPC channel, which is the only bridge this build needs. */
export function available(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Rejects when the Rust command fails. Callers check available() first. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args);
}
