/**
 * The runtime half of `/bench route`: push the stored request onto the
 * loaded governor before every completion, and shape the KALSA_GOVERNOR
 * route-evidence fields. A REQUEST only — the engine's safety gates keep
 * deciding; the push is feature-detected because the app's pinned llama.rn
 * may predate `setPrefillOverride`.
 */
import type { BenchRouteMode } from "../bench/benchConfig";

type EngineWithPrefillOverride = {
  setPrefillOverride?: (mode: BenchRouteMode) => Promise<void>;
};

export type PrefillOverridePush = "applied" | "unsupported";

/** One unsupported line per process: the pin does not change mid-session. */
let unsupportedLogged = false;

/**
 * Request the prefill route for the next turn. An engine without the method
 * is not an error: log `KALSA_BENCH_ROUTE` once and let the engine keep
 * deciding. Throws only from a supporting engine whose call rejects — the
 * caller owns the timeout/turn-dependency handling.
 */
export async function pushPrefillOverride(
  engine: unknown,
  mode: BenchRouteMode,
): Promise<PrefillOverridePush> {
  const target = engine as EngineWithPrefillOverride;
  if (typeof target.setPrefillOverride !== "function") {
    if (!unsupportedLogged) {
      unsupportedLogged = true;
      try {
        console.log(
          `KALSA_BENCH_ROUTE ${JSON.stringify({ applied: false, reason: "unsupported" })}`,
        );
      } catch {
        // telemetry must never throw
      }
    }
    return "unsupported";
  }
  // Method call, not a detached extract: the llama.rn wrappers read `this`.
  await target.setPrefillOverride(mode);
  return "applied";
}

/**
 * The route-evidence fields of KALSA_GOVERNOR: the join id, the requested
 * mode echoed, and the per-chunk facts copied from the completion result —
 * `null` while the binding does not emit them (the current pin predates
 * `route_chunks`).
 */
export function governorRouteLogFields(input: {
  turnId: string;
  routeMode: BenchRouteMode;
  completionResult: unknown;
}): { turnId: string; route_mode: BenchRouteMode; route_chunks: unknown[] | null } {
  const chunks = (
    input.completionResult as { route_chunks?: unknown } | null | undefined
  )?.route_chunks;
  return {
    turnId: input.turnId,
    route_mode: input.routeMode,
    route_chunks: Array.isArray(chunks) ? chunks : null,
  };
}
