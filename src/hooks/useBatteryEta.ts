/**
 * Battery-ETA monitor (C7) — platform wiring for `src/engine/batteryEta.ts`.
 *
 * Polls `expo-battery` (power state) at a coarse interval while the app is
 * foregrounded AND an on-device generation is ready, keeps a short rolling
 * window of `(timestamp, batteryPercent)` samples, and derives an honest
 * "about X–Y hours of continuous on-device generation" projection.
 *
 * Advisory ONLY: never hard-blocks send / load. Battery fields are never sent
 * to the telemetry worker. Sampling uses polling (not the push listener) at a
 * long interval — the lower-energy path for an advisory banner.
 */
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  estimateBatteryEtaHours,
  type BatteryEtaResult,
  type BatterySample,
} from "../engine/batteryEta";

/** Coarse polling interval — low energy, sufficient for an advisory. */
const DEFAULT_INTERVAL_MS = 60_000;
/** Keep at most this many foreground samples in the ring buffer. */
const RING_MAX = 12;

/** `expo-battery` power-state shape (structural, so it is optional). */
interface NativePowerState {
  batteryLevel: number;
  batteryState: number;
  lowPowerMode?: boolean;
}

/** Shape of the `expo-battery` module we actually call. */
interface NativeBatteryModule {
  getPowerStateAsync?: () => Promise<NativePowerState>;
  getBatteryLevelAsync?: () => Promise<number>;
  getBatteryStateAsync?: () => Promise<number>;
}

/** Normalized battery read. */
interface BatteryRead {
  batteryPercent: number | null;
  /** `true` = charging/full/not-charging; `false` = discharging; `null` = unknown. */
  charging: boolean | null;
  /** Whether the native battery API was reachable this tick. */
  apiAvailable: boolean;
}

/** Battery state enum values from `expo-battery`. */
const BATTERY_STATE = {
  UNKNOWN: 0,
  UNPLUGGED: 1,
  CHARGING: 2,
  FULL: 3,
  NOT_CHARGING: 4,
} as const;

/** Convert a native battery level (0..1, or -1) to a 0–100 percent. */
function percentFromLevel(level: number | null | undefined): number | null {
  const n = toFinite(level);
  if (n == null || n < 0) return null; // -1 means "unavailable"
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

/** Map a native battery state enum to a charging boolean. */
function chargingFromState(state: number | null | undefined): boolean | null {
  const n = toFinite(state);
  if (n == null) return null; // UNKNOWN
  if (
    n === BATTERY_STATE.UNPLUGGED ||
    n === BATTERY_STATE.CHARGING ||
    n === BATTERY_STATE.FULL ||
    n === BATTERY_STATE.NOT_CHARGING
  ) {
    // Only UNPLUGGED actually discharges; the rest mean "on power".
    return n !== BATTERY_STATE.UNPLUGGED;
  }
  return null;
}

/** Read battery level + state via `expo-battery`, fail closed on error. */
async function readBattery(): Promise<BatteryRead> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Battery = require("expo-battery") as NativeBatteryModule | undefined;

  if (!Battery) {
    return { batteryPercent: null, charging: null, apiAvailable: false };
  }

  try {
    if (typeof Battery.getPowerStateAsync === "function") {
      const ps = await Battery.getPowerStateAsync();
      return {
        batteryPercent: percentFromLevel(ps?.batteryLevel),
        charging: chargingFromState(ps?.batteryState),
        apiAvailable: true,
      };
    }
    // Fallback: level + state, resolved independently (either may be -1).
    const [level, state] = await Promise.all([
      Battery.getBatteryLevelAsync?.(),
      Battery.getBatteryStateAsync?.(),
    ]);
    return {
      batteryPercent: percentFromLevel(level),
      charging: chargingFromState(state),
      apiAvailable: true,
    };
  } catch {
    return { batteryPercent: null, charging: null, apiAvailable: false };
  }
}

/** Clamp to a finite number, or `null`. */
function toFinite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Push one sample into a capped ring buffer. */
function ringPush(buf: BatterySample[], s: BatterySample): BatterySample[] {
  const next = [...buf, s];
  return next.length > RING_MAX ? next.slice(next.length - RING_MAX) : next;
}

/** Display state returned to the UI. */
export type BatteryEtaUiState = BatteryEtaResult & {
  /** Last battery percent read (0–100), or `null` when unavailable. */
  batteryPercent: number | null;
  /** Last charging state (`true`/`false`), or `null` when unknown. */
  charging: boolean | null;
  /** Epoch ms of the last successful read. */
  sampledAt: number | null;
  /** Whether the native battery API was reachable at least once. */
  apiAvailable: boolean;
};

export const DEFAULT_BATTERY_eta_ui_state: BatteryEtaUiState = {
  kind: "unknown",
  batteryPercent: null,
  charging: null,
  sampledAt: null,
  apiAvailable: false,
};

export function useBatteryEta(opts: {
  /**
   * Whether sampling should run. AppShell passes `true` only while a model is
   * loaded and the engine is ready — the feature is useless otherwise.
   */
  enabled: boolean;
  /**
   * Current model id. Changing it resets the sample window (a model switch
   * invalidates the prior drain slope).
   */
  modelId?: string | null;
  /** Poll interval in ms. */
  intervalMs?: number;
}): BatteryEtaUiState {
  const { enabled, modelId, intervalMs = DEFAULT_INTERVAL_MS } = opts;

  const [state, setState] = useState<BatteryEtaUiState>(DEFAULT_BATTERY_eta_ui_state);
  const mountedRef = useRef(false);

  // Rolling window of foreground samples. Kept in a ref so the polling
  // interval is not rebuilt on every state update.
  const samplesRef = useRef<BatterySample[]>([]);

  // Re-arm the effect whenever the enabling inputs change.
  const armKey = `${enabled}:${modelId ?? ""}:${intervalMs}`;

  useEffect(() => {
    mountedRef.current = true;
    // Reset the window whenever we (re)arm or the model changes.
    samplesRef.current = [];

    if (!enabled) {
      if (mountedRef.current) {
        setState({
          ...DEFAULT_BATTERY_eta_ui_state,
          apiAvailable: false,
        });
      }
      return () => {
        mountedRef.current = false;
      };
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const { batteryPercent, charging, apiAvailable } = await readBattery();

      if (charging === true) {
        // On power → drain slope is invalid; drop the window.
        samplesRef.current = [];
      } else if (batteryPercent != null && charging === false) {
        // Discharging with a level → extend the window.
        samplesRef.current = ringPush(samplesRef.current, {
          tMs: Date.now(),
          percent: batteryPercent,
        });
      }
      // charging null / api unavailable: leave the window untouched.

      if (mountedRef.current) {
        setState({
          ...estimateBatteryEtaHours(samplesRef.current),
          batteryPercent,
          charging,
          sampledAt: Date.now(),
          apiAvailable,
        });
      }
    };

    const start = () => {
      void tick();
      if (timer == null) {
        timer = setInterval(() => void tick(), intervalMs);
      }
    };

    // Initial sample immediately so the first UI frame is not always empty.
    start();

    const appStateSub = AppState.addEventListener("change", (appState) => {
      if (appState === "active") {
        // Return to foreground: re-arm sampling if stopped.
        if (timer == null) start();
      } else {
        // Backgrounded / screen off: stop sampling and clear the window so a
        // stale cross-session slope can never produce an ETA.
        if (timer != null) {
          clearInterval(timer);
          timer = null;
        }
        samplesRef.current = [];
        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            kind: samplesRef.current.length > 0 ? "measuring" : "unknown",
          }));
        }
      }
    });

    return () => {
      mountedRef.current = false;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armKey, intervalMs]);

  return state;
}