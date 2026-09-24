/**
 * The runtime half of `/bench route`: push the stored request onto the
 * loaded governor before every completion (a REQUEST — the engine's safety
 * gates keep deciding), record how THIS turn's push went, and shape the
 * KALSA_GOVERNOR route-evidence fields: the applied mode or null, the push
 * outcome, and validated per-chunk facts. Feature-detected: the app's
 * pinned llama.rn may predate `setPrefillOverride`.
 */
import type { BenchRouteMode } from "../bench/benchConfig";

type EngineWithPrefillOverride = {
  setPrefillOverride?: (mode: BenchRouteMode) => Promise<void>;
};

export type RoutePushOutcome =
  | "applied"
  | "unsupported"
  | "failed"
  | "timeout"
  | "skipped";

/** What THIS turn pushed — captured at the push, never re-read at the emit. */
export type RoutePushRecord = {
  mode: BenchRouteMode;
  outcome: Exclude<RoutePushOutcome, "skipped">;
};

/**
 * Short bound on purpose: ENGINE_AUX_CALL_TIMEOUT_MS (15 s) covers native
 * work that gates the turn, while this setter is a sticky dev request that
 * answers in ms when healthy. 2 s caps the added latency of one refresh —
 * the push runs before every completion, each cooling retry, each utility
 * call and the prewarm — and stays far above a healthy answer.
 */
export const BENCH_ROUTE_PUSH_TIMEOUT_MS = 2_000;

const ROUTE_PUSH_TIMEOUT = Symbol("benchRoutePushTimeout");

/** One unsupported line per process: the pin does not change mid-session. */
let unsupportedLogged = false;

/**
 * Push the mode and report how it went — never throws. Absent method →
 * "unsupported" (the one-per-process KALSA_BENCH_ROUTE line), a rejecting
 * setter → "failed", one still pending at BENCH_ROUTE_PUSH_TIMEOUT_MS →
 * "timeout", otherwise "applied". Called as a method: the llama.rn wrappers
 * read `this`.
 */
export async function pushPrefillOverride(
  engine: unknown,
  mode: BenchRouteMode,
): Promise<Exclude<RoutePushOutcome, "skipped">> {
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      target.setPrefillOverride(mode),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(ROUTE_PUSH_TIMEOUT), BENCH_ROUTE_PUSH_TIMEOUT_MS);
      }),
    ]);
    return "applied";
  } catch (error) {
    return error === ROUTE_PUSH_TIMEOUT ? "timeout" : "failed";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One per-chunk route fact as the spec defines it — the six fields only. */
export type RouteChunk = {
  index: number;
  requested: BenchRouteMode;
  actual: "cpu" | "gpu";
  tokens: number;
  prefill_ms: number;
  forced: boolean;
};

const CHUNK_REQUESTED: ReadonlySet<string> = new Set(["cpu", "gpu", "auto"]);
const CHUNK_ACTUAL: ReadonlySet<string> = new Set(["cpu", "gpu"]);

/** Project a binding-emitted entry onto the six spec fields, or null if malformed. */
function asRouteChunk(value: unknown): RouteChunk | null {
  if (typeof value !== "object" || value === null) return null;
  const chunk = value as Record<string, unknown>;
  if (
    typeof chunk.index !== "number" ||
    typeof chunk.requested !== "string" ||
    !CHUNK_REQUESTED.has(chunk.requested) ||
    typeof chunk.actual !== "string" ||
    !CHUNK_ACTUAL.has(chunk.actual) ||
    typeof chunk.tokens !== "number" ||
    typeof chunk.prefill_ms !== "number" ||
    typeof chunk.forced !== "boolean"
  ) {
    return null;
  }
  return {
    index: chunk.index,
    requested: chunk.requested as BenchRouteMode,
    actual: chunk.actual as "cpu" | "gpu",
    tokens: chunk.tokens,
    prefill_ms: chunk.prefill_ms,
    forced: chunk.forced,
  };
}

/**
 * The route-evidence fields of KALSA_GOVERNOR. `route_mode` names a mode
 * ONLY when this turn's push was applied — anything else left the engine
 * holding whatever it had, and `route_push` says why (null record →
 * "skipped": no push this turn). `route_chunks` is projected onto the six
 * spec fields (extras dropped) with the malformed-entry count alongside.
 */
export function governorRouteLogFields(input: {
  turnId: string;
  routePush: RoutePushRecord | null;
  completionResult: unknown;
}): {
  turnId: string;
  route_mode: BenchRouteMode | null;
  route_push: RoutePushOutcome;
  route_chunks: RouteChunk[] | null;
  route_chunks_dropped: number | null;
} {
  const raw = (
    input.completionResult as { route_chunks?: unknown } | null | undefined
  )?.route_chunks;
  const projected = Array.isArray(raw) ? raw.map(asRouteChunk) : null;
  const dropped =
    projected === null ? null : projected.filter((chunk) => chunk === null).length;
  return {
    turnId: input.turnId,
    route_mode:
      input.routePush?.outcome === "applied" ? input.routePush.mode : null,
    route_push: input.routePush?.outcome ?? "skipped",
    route_chunks:
      projected === null
        ? null
        : projected.filter((chunk): chunk is RouteChunk => chunk !== null),
    route_chunks_dropped: dropped,
  };
}
