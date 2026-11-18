import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The global convenience object is off; the official API uses Tauri's
    internal IPC channel, which is the only bridge this build needs. */
export function available(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Rejects when the Rust command fails. Callers check available() first. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args);
}

/** Listens to a backend event and returns the cleanup. If the cleanup runs before the
    listener is ready, the listener is removed as soon as it is. */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let off: (() => void) | null = null;
  let closed = false;
  void listen<T>(event, (message) => handler(message.payload)).then((stop) => {
    if (closed) stop();
    else off = stop;
  });
  return () => {
    closed = true;
    off?.();
  };
}
