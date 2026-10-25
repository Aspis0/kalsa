// The browser driver, as the page asks for it. Rust does the download, the
// digest check and the unpack; this file only calls it and names its shapes.

import { available, invoke, listen } from "./tauri";

/** What Rust says about the driver on this computer. */
export interface DriverStatus {
  /** Kalsa has a driver for this computer at all. */
  supported: boolean;
  /** It is unpacked here and every file still matches what was installed. */
  installed: boolean;
  /** What the archive weighs in bytes, so the cost is shown before the press. */
  size: number;
}

export interface DriverProgress {
  done: number;
  total: number;
}

const UNAVAILABLE = "browser.download_failed";

export function driverStatus(): Promise<DriverStatus> {
  if (!available()) return Promise.reject(code(UNAVAILABLE));
  return invoke<DriverStatus>("brain_browser_driver_status");
}

/** Starts the download. Resolves with the finished state; progress arrives as
    events in between, so a failed call and a failed download look different to
    the page and only one of them has a bar to clean up. */
export function downloadDriver(): Promise<DriverStatus> {
  if (!available()) return Promise.reject(code(UNAVAILABLE));
  return invoke<DriverStatus>("brain_browser_driver_download");
}

/** Calls the running download off.
    It returns as soon as the flag is set; the download thread stops at its next
    chunk boundary and `downloadDriver` settles on its own, so the row waits for
    that rather than inventing a finished state here. A press with nothing
    running is not a failure. */
export function cancelDriver(): Promise<void> {
  if (!available()) return Promise.reject(code(UNAVAILABLE));
  return invoke<void>("brain_browser_driver_cancel");
}

export function clearBrowserData(): Promise<void> {
  if (!available()) return Promise.reject(code(UNAVAILABLE));
  return invoke<void>("brain_browser_clear_data");
}

export function onDriverProgress(handler: (progress: DriverProgress) => void): Promise<() => void> {
  return listen("brain_browser_driver_progress", payload => handler(payload as DriverProgress));
}

/** Whether a refused download is the person having pressed Cancel rather than
    something having gone wrong. Both settle the same promise and the row shows
    a sentence rather than a reason, so the one that does differ is the one the
    person caused: it gets its own sentence and no blame. */
export function cancelledBy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "browser.cancelled";
}

function code(name: string): { code: string; text: string } {
  return { code: name, text: "" };
}