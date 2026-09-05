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

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

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
              if (!mountedRef.current) return;
              setState({
                status: statusFromTempC(tempC, state.status),
                currentTempC: tempC,
                source: "sysfs",
                sampledAt: Date.now(),
                hint: toGovernorHint(
                  statusFromTempC(tempC, state.status),
                  tempC,
                  "sysfs",
                ),
              });
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
          setState({
            status: "unknown",
            currentTempC: null,
            source: "none",
            sampledAt: Date.now(),
            hint: toGovernorHint("unknown", null, "none"),
          });
          return;
        }
        const availMiB = bytes / (1024 * 1024);
        // Very low free RAM → advisory "warm" (not a real temperature).
        const status: ThermalStatus = availMiB < 512 ? "warm" : "ok";
        setState({
          status,
          currentTempC: null,
          source: "memory_proxy",
          sampledAt: Date.now(),
          hint: toGovernorHint(status, null, "memory_proxy"),
        });
      } catch {
        if (!mountedRef.current) return;
        setState({
          status: "unknown",
          currentTempC: null,
          source: "none",
          sampledAt: Date.now(),
          hint: toGovernorHint("unknown", null, "none"),
        });
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
  }, [intervalMs, state.status]);

  return state;
}