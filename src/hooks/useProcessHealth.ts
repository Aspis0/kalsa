/**
 * Lightweight process-health ticker for Settings diagnostics.
 * Samples uncached MemAvailable every 15s and exposes fit tier + unload reason.
 */
import { useEffect, useRef, useState } from "react";

import {
  getAvailableMemoryBytesUncached,
  getProcessMemorySampleUncached,
} from "../engine/monitor";
import {
  isSwapDistressed,
  majfltGrewBy,
  residentHeadroomBytes,
  swapGrewBy,
} from "../engine/memoryPressure";
import { getRamTier, type RamTier } from "../engine/contextProfile";

export type ProcessHealthState = {
  availableMemoryBytes: number | null;
  /**
   * MemAvailable minus this process's RssFile — what is reclaimable ELSEWHERE.
   * With a model resident, availableMemoryBytes counts the model's own mapped
   * weights as free space, so this is the honest number of the two. Diagnostic
   * only: it has not been validated against a collapse yet (see memoryPressure).
   */
  residentHeadroomBytes: number | null;
  /** Bytes swapped out since this hook's first sample. */
  swapGrownBytes: number | null;
  /** Swap growth past the distress threshold — independent of headroom. */
  swapDistressed: boolean;
  /** Major page faults since this hook's first readable sample. */
  majfltGrown: number | null;
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
    residentHeadroomBytes: null,
    swapGrownBytes: null,
    swapDistressed: false,
    majfltGrown: null,
    fitTier: totalMemoryBytes != null ? getRamTier(totalMemoryBytes) : null,
    unloadedReason: lastUnloadedReason,
    sampledAt: null,
  });
  const mountedRef = useRef(true);
  /**
   * VmSwap at the first readable sample; growth is measured against it.
   * Deliberately NOT reset when totalMemoryBytes changes: the baseline is
   * per-session, and swap growth is a property of the process, not of the tier.
   */
  const swapBaselineRef = useRef<number | null>(null);
  /** majflt at the first readable sample; the counter is cumulative. */
  const majfltBaselineRef = useRef<number | null>(null);
  /** Monotonic tick id — a slow sample must not overwrite a newer one. */
  const tickRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const sample = async () => {
      const tick = ++tickRef.current;
      try {
        const bytes = await getAvailableMemoryBytesUncached();
        const proc = await getProcessMemorySampleUncached();
        // Both awaits are done before the guards: an unmount mid-sample must
        // not leave a half-applied state, and two /proc reads can take longer
        // than intervalMs, so a stale tick must drop rather than overwrite.
        if (!mountedRef.current || tick !== tickRef.current) return;
        if (swapBaselineRef.current == null && proc.vmSwapBytes != null) {
          swapBaselineRef.current = proc.vmSwapBytes;
        }
        if (majfltBaselineRef.current == null && proc.majflt != null) {
          majfltBaselineRef.current = proc.majflt;
        }
        const grown = swapGrewBy(swapBaselineRef.current, proc.vmSwapBytes);
        const majfltGrown = majfltGrewBy(
          majfltBaselineRef.current,
          proc.majflt,
        );
        setState({
          availableMemoryBytes: bytes,
          residentHeadroomBytes: residentHeadroomBytes(
            bytes,
            proc.rssFileBytes,
          ),
          swapGrownBytes: grown,
          swapDistressed: isSwapDistressed(grown),
          majfltGrown,
          fitTier:
            totalMemoryBytes != null ? getRamTier(totalMemoryBytes) : null,
          unloadedReason: lastUnloadedReason,
          sampledAt: Date.now(),
        });
      } catch {
        if (!mountedRef.current || tick !== tickRef.current) return;
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
