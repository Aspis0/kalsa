/**
 * Lightweight process-health ticker for Settings diagnostics.
 * Samples uncached MemAvailable every 15s and exposes fit tier + unload reason.
 */
import { useEffect, useRef, useState } from "react";

import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { getRamTier, type RamTier } from "../engine/contextProfile";

export type ProcessHealthState = {
  availableMemoryBytes: number | null;
  /** Coarse RAM tier from total memory (null when unknown). */
  fitTier: RamTier | null;
  /** Last unload reason key (i18n), null when engine is not unloaded-for-pressure. */
  unloadedReason: string | null;
  sampledAt: number | null;
};

const DEFAULT_INTERVAL_MS = 15_000;

/** Module-level unload reason set by AppShell on pressure unload; read by the hook. */
let lastUnloadedReason: string | null = null;

/** AppShell calls this when the engine is disposed due to memory pressure. */
export function setProcessUnloadedReason(reason: string | null): void {
  lastUnloadedReason = reason;
}

export function getProcessUnloadedReason(): string | null {
  return lastUnloadedReason;
}

/**
 * Tick every intervalMs with uncached MemAvailable + current unload reason.
 * totalMemoryBytes (optional) seeds fitTier via getRamTier.
 */
export function useProcessHealth(opts?: {
  intervalMs?: number;
  totalMemoryBytes?: number | null;
}): ProcessHealthState {
  const intervalMs =
    typeof opts?.intervalMs === "number" &&
    Number.isFinite(opts.intervalMs) &&
    opts.intervalMs > 0
      ? opts.intervalMs
      : DEFAULT_INTERVAL_MS;
  const totalMemoryBytes = opts?.totalMemoryBytes ?? null;

  const [state, setState] = useState<ProcessHealthState>({
    availableMemoryBytes: null,
    fitTier: totalMemoryBytes != null ? getRamTier(totalMemoryBytes) : null,
    unloadedReason: lastUnloadedReason,
    sampledAt: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const sample = async () => {
      try {
        const bytes = await getAvailableMemoryBytesUncached();
        if (!mountedRef.current) return;
        setState({
          availableMemoryBytes: bytes,
          fitTier:
            totalMemoryBytes != null ? getRamTier(totalMemoryBytes) : null,
          unloadedReason: lastUnloadedReason,
          sampledAt: Date.now(),
        });
      } catch {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          unloadedReason: lastUnloadedReason,
          sampledAt: Date.now(),
        }));
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
  }, [intervalMs, totalMemoryBytes]);

  return state;
}
