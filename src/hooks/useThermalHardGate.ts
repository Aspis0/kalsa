/**
 * Platform thermal HARD-gate monitor (C3).
 *
 * Subscribes to platform thermal severity/state changes and refreshes once on
 * foreground. It exposes a single boolean `gated` that flips on the RISING edge
 * (→ OS CRITICAL) and clears on the FALLING edge (back below CRITICAL).
 *
 * `apiAvailable` reports whether a native thermal module is linked. When it is
 * not linked the gate is always `false` (fail open) — the app never blocks.
 *
 * Advisory bands (thermal_zone0 °C) never drive this hook.
 */
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  addPlatformThermalListener,
  getPlatformThermalHardGate,
  isPlatformThermalApiAvailable,
  readToHardGate,
} from "../engine/platformThermalStatus";

export interface ThermalHardGateState {
  /** True while the OS reports CRITICAL thermal severity. */
  gated: boolean;
  /** Whether a native thermal module is linked (false = fail open). */
  apiAvailable: boolean;
}

/**
 * Listen for native thermal changes. `intervalMs` remains accepted for callers
 * that shared the old advisory monitor API, but no Celsius polling is used.
 */
export function useThermalHardGate(opts?: {
  intervalMs?: number;
  /** Imperative sync guard updated in the native event callback. */
  onGateChange?: (gated: boolean) => void;
}): ThermalHardGateState {
  // Compatibility only: hard-gate updates are event-driven, not temperature
  // polls. Keeping this option avoids forcing unrelated callers to change shape.
  void opts?.intervalMs;
  const onGateChangeRef = useRef(opts?.onGateChange);
  onGateChangeRef.current = opts?.onGateChange;

  const [gated, setGated] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(
    isPlatformThermalApiAvailable(),
  );
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const linked = isPlatformThermalApiAvailable();
    setApiAvailable(linked);

    const commit = (next: boolean) => {
      onGateChangeRef.current?.(next);
      if (mountedRef.current) setGated(next);
    };

    const sample = async () => {
      if (!mountedRef.current) return;
      let next = false;
      try {
        next = await getPlatformThermalHardGate();
      } catch {
        // A throwing sample must not hard-block: treat as not gated.
        next = false;
      }
      if (!mountedRef.current) return;
      commit(next);
    };

    // Native registration happens before the initial query so a startup
    // transition cannot be missed. The native module also emits its snapshot
    // immediately after registration.
    const listener = addPlatformThermalListener((read) => {
      try {
        commit(readToHardGate(read));
      } catch {
        commit(false);
      }
    });
    if (listener) setApiAvailable(true);

    void sample();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sample();
    });

    return () => {
      mountedRef.current = false;
      listener?.remove();
      appStateSubscription.remove();
    };
  }, []);

  return { gated, apiAvailable };
}
