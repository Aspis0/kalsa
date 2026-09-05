/**
 * Advisory thermal monitor. Tries sysfs thermal_zone0; falls back to a
 * memory-pressure heuristic. Never unloads the model — UI banner only.
 * No run-as / sudo. Dynamic requires keep node harnesses import-clean.
 *
 * Advisory ONLY: never hard-blocks send / load / download. `thermal_zone0` is
 * an unknown / internal-like sensor (NOT battery, NOT proven skin), so its
 * bands live in `src/engine/thermalThresholds.ts` and are deliberately warm.
 */
import { useEffect, useRef, useState } from "react";

import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import {
  type ThermalGovernorHint,
  type ThermalStatus,
  type ThermalMonitorState,
  toGovernorHint,
  statusFromTempC,
  MEMORY_PROXY_WARM_BELOW_MIB,
} from "../engine/thermalThresholds";

const DEFAULT_INTERVAL_MS = 30_000;

/** Millidegree strings from thermal_zoneN/temp (millidegrees) to Celsius. */
function parseThermalZoneTemp(text: string): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const milli = Number(trimmed);
  if (!Number.isFinite(milli)) return null;
  // Kernel thermal zones report millidegrees Celsius (e.g. 45000 → 45 °C).
  const c = milli / 1000;
  // Sanity: reject absurd values (probe noise / wrong zone units).
  if (c < -20 || c > 120) return null;
  return c;
}

async function readSysfsText(absPath: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    try {
      return await FileSystem.readAsStringAsync(absPath);
    } catch {
      return await FileSystem.readAsStringAsync(`file://${absPath}`);
    }
  } catch {
    return null;
  }
}

/**
 * Poll thermal_zone0 every intervalMs. On failure, proxy via MemAvailable:
 * very low free RAM is treated as "warm" (advisory only, no invented °C).
 */
export function useThermalMonitor(opts?: {
  intervalMs?: number;
}): ThermalMonitorState {
  const intervalMs =
    typeof opts?.intervalMs === "number" &&
    Number.isFinite(opts.intervalMs) &&
    opts.intervalMs > 0
      ? opts.intervalMs
      : DEFAULT_INTERVAL_MS;

  const [state, setState] = useState<ThermalMonitorState>({
    status: "unknown",
    currentTempC: null,
    source: "none",
    sampledAt: null,
    hint: toGovernorHint("unknown", null, "none"),
  });
  const mountedRef = useRef(true);

  // Previous advisory state, kept in refs (never in the effect deps) so the
  // polling interval is torn down and rebuilt only when `intervalMs` changes —
  // not on every status flap. `statusFromTempC` reads these refs for source-
  // aware hysteresis, and they are refreshed on every committed sample.
  const prevStatusRef = useRef<ThermalStatus>(state.status);
  const prevSourceRef = useRef<string>(state.source);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    // Commit one sample: advance the prev refs and update state functionally
    // (spreading prior state) so only the changed fields move.
    const commit = (next: {
      status: ThermalStatus;
      currentTempC: number | null;
      source: "sysfs" | "memory_proxy" | "none";
    }) => {
      prevStatusRef.current = next.status;
      prevSourceRef.current = next.source;
      setState((s) => ({
        ...s,
        status: next.status,
        currentTempC: next.currentTempC,
        source: next.source,
        sampledAt: Date.now(),
        hint: toGovernorHint(next.status, next.currentTempC, next.source),
      }));
    };

    const sample = async () => {
      // iOS has no sysfs path; it would map ProcessInfo.thermalState → the
      // same ThermalStatus enum. Wired here only when cheap (TODO).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Platform } = require("react-native") as {
          Platform: { OS: string };
        };
        if (Platform.OS === "android") {
          const text = await readSysfsText(
            "/sys/class/thermal/thermal_zone0/temp",
          );
          if (text != null) {
            const tempC = parseThermalZoneTemp(text);
            if (tempC != null) {
              const status = statusFromTempC(tempC, {
                prevStatus: prevStatusRef.current,
                prevSource: prevSourceRef.current,
                source: "sysfs",
              });
              if (!mountedRef.current) return;
              commit({ status, currentTempC: tempC, source: "sysfs" });
              return;
            }
          }
        }
      } catch {
        // fall through to memory proxy
      }

      // Fallback: memory-pressure heuristic (no temperature available).
      try {
        const bytes = await getAvailableMemoryBytesUncached();
        if (!mountedRef.current) return;
        if (bytes == null) {
          commit({ status: "unknown", currentTempC: null, source: "none" });
          return;
        }
        // Very low free RAM → advisory "warm" (not a real temperature).
        const availMiB = bytes / (1024 * 1024);
        const status: ThermalStatus =
          availMiB < MEMORY_PROXY_WARM_BELOW_MIB ? "warm" : "ok";
        commit({ status, currentTempC: null, source: "memory_proxy" });
      } catch {
        if (!mountedRef.current) return;
        commit({ status: "unknown", currentTempC: null, source: "none" });
      }
    };

    void sample();
    timer = setInterval(() => {
      void sample();
    }, intervalMs);

    return () => {
      mountedRef.current = false;
      if (timer != null) clearInterval(timer);
    };
  }, [intervalMs]);

  return state;
}