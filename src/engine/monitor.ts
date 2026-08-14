/**
 * Uncached memory sampling + AppState-aware pressure monitor.
 *
 * Decision paths (load / regen / edit) must re-read MemAvailable uncached
 * immediately before acting. getAvailableMemoryBytes() in memoryEstimate.ts
 * is process-lifetime cached and must NOT be used for live decisions.
 *
 * Pure at module scope (no static RN/expo imports) so node harnesses stay clean.
 */

import { parseMemAvailableBytes } from "./memoryEstimate";
import { parseProcessRssBytes } from "./engineLiveness";

export type AppStateValue = "active" | "background" | "inactive" | "unknown" | string;

export type AppStateHandler = (state: AppStateValue) => void;

export type MemoryMonitorOpts = {
  /** Polling interval; default 15_000 ms. */
  intervalMs?: number;
  /** Fired on AppState change (active / background / inactive). */
  onAppState: AppStateHandler;
  /** Fired on each sample with MemAvailable bytes (null when unreadable). */
  onPressure: (availableBytes: number | null) => void;
};

export type MemoryMonitorHandle = {
  stop: () => void;
};

async function readProcText(
  FileSystem: { readAsStringAsync: (uri: string) => Promise<string> },
  absPath: string,
): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(absPath);
  } catch {
    try {
      return await FileSystem.readAsStringAsync(`file://${absPath}`);
    } catch {
      return null;
    }
  }
}

/**
 * Read MemAvailable from /proc/meminfo (Android) with NO process cache.
 * Never throws. Returns null off-Android / on read or parse failure.
 */
export async function getAvailableMemoryBytesUncached(): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    const text = await readProcText(FileSystem, "/proc/meminfo");
    if (text == null) return null;
    return parseMemAvailableBytes(text);
  } catch {
    return null;
  }
}

/**
 * Read this process's VmRSS from /proc/self/status with NO cache.
 * Never throws. Returns null off-Android / on read or parse failure.
 */
export async function getProcessRssBytesUncached(): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    const text = await readProcText(FileSystem, "/proc/self/status");
    if (text == null) return null;
    return parseProcessRssBytes(text);
  } catch {
    return null;
  }
}

/**
 * Start interval polling of uncached MemAvailable + AppState listener.
 * Returns a handle whose stop() clears the timer and removes the listener.
 * Never throws from the start path; individual samples may yield null.
 */
export function startMemoryMonitor(opts: MemoryMonitorOpts): MemoryMonitorHandle {
  const intervalMs =
    typeof opts.intervalMs === "number" &&
    Number.isFinite(opts.intervalMs) &&
    opts.intervalMs > 0
      ? opts.intervalMs
      : 15_000;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let appSub: { remove: () => void } | null = null;

  const sample = () => {
    if (stopped) return;
    void getAvailableMemoryBytesUncached()
      .then((bytes) => {
        if (!stopped) opts.onPressure(bytes);
      })
      .catch(() => {
        if (!stopped) opts.onPressure(null);
      });
  };

  sample();
  timer = setInterval(sample, intervalMs);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require("react-native") as {
      AppState: {
        addEventListener: (
          type: string,
          handler: (state: AppStateValue) => void,
        ) => { remove: () => void };
      };
    };
    appSub = AppState.addEventListener("change", (next: AppStateValue) => {
      if (stopped) return;
      try {
        opts.onAppState(next);
      } catch {
        // listener must never throw into RN
      }
    });
  } catch {
    // Non-RN / test env — interval-only monitor.
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      if (appSub) {
        try {
          appSub.remove();
        } catch {
          // ignore
        }
        appSub = null;
      }
    },
  };
}
