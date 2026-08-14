/**
 * Engine-lost detection + UI/send recovery state machine.
 *
 * JS `isEngineReady()` is only `context !== null`. HyperOS can reclaim the
 * native llama heap (RSS 3 GB → ~167 MB) while the JS wrapper survives —
 * the header stays "Ready" and Send talks to a dead handle.
 *
 * This module is pure (no RN / expo imports) so node harnesses compile it.
 * I/O (RSS read, JS-context invalidate) lives in monitor / LlamaService.
 */

/** RSS below this fraction of the last post-init sample ⇒ native heap is gone. */
export const ENGINE_RSS_COLLAPSE_RATIO = 0.3;

/**
 * Fallback when no post-init RSS sample exists: compare live RSS to the
 * GGUF size. 167 MB vs a 2.7 GB 4B is still a clear collapse.
 */
export const ENGINE_RSS_VS_MODEL_RATIO = 0.25;

export type EngineLivenessStatus = "alive" | "lost" | "absent";

export type EngineLivenessReason = "rss_collapsed" | "native_probe_failed";

export type EngineLivenessVerdict =
  | { status: "absent" }
  | { status: "alive" }
  | { status: "lost"; reason: EngineLivenessReason };

export type EngineLivenessInput = {
  /** JS-side `isEngineReady()` (context wrapper present, not hung). */
  jsReady: boolean;
  /** Live process RSS (`/proc/self/status` VmRSS). Null when unreadable. */
  rssBytes: number | null;
  /** RSS captured after a successful initLlama. Null if never sampled. */
  lastKnownRssBytes: number | null;
  /** Active model file size; used only when lastKnownRssBytes is missing. */
  modelSizeBytes?: number | null;
};

/**
 * Cheap invariant: JS says ready, but RSS collapsed vs the post-init
 * baseline (or vs GGUF size). Never calls into the native context.
 */
export function decideEngineLiveness(
  input: EngineLivenessInput,
): EngineLivenessVerdict {
  if (!input.jsReady) return { status: "absent" };

  const rss = asPositiveBytes(input.rssBytes);
  if (rss == null) {
    // Cannot see RSS — do not invent a lost verdict (false lost + reload
    // would leak a still-resident model and OOM). Treat as alive.
    return { status: "alive" };
  }

  const baseline = asPositiveBytes(input.lastKnownRssBytes);
  if (baseline != null && rss < baseline * ENGINE_RSS_COLLAPSE_RATIO) {
    return { status: "lost", reason: "rss_collapsed" };
  }

  const modelBytes = asPositiveBytes(input.modelSizeBytes);
  if (
    baseline == null &&
    modelBytes != null &&
    rss < modelBytes * ENGINE_RSS_VS_MODEL_RATIO
  ) {
    return { status: "lost", reason: "rss_collapsed" };
  }

  return { status: "alive" };
}

/**
 * Parse VmRSS from `/proc/self/status` (or a fixture).
 * `VmRSS:    171088 kB` → bytes. Null on missing / malformed input.
 */
export function parseProcessRssBytes(statusText: string): number | null {
  if (typeof statusText !== "string") return null;
  const m = /^VmRSS:\s*(\d+)\s*kB\s*$/m.exec(statusText);
  if (!m) return null;
  const kB = Number(m[1]);
  if (!Number.isFinite(kB) || kB < 0) return null;
  return kB * 1024;
}

/** Header chip kind derived from modelState + JS engine residency. */
export type EngineBarKind =
  | "checking"
  | "missing"
  | "downloading"
  | "loading"
  | "error"
  | "ready"
  | "reload";

export type ModelUiState =
  | "checking"
  | "missing"
  | "downloading"
  | "loading"
  | "error"
  | "ready";

/**
 * Same mapping AppShell uses for the model chip. `ready` + JS wrapper
 * gone (or lost) must leave "Ready" and show the reload affordance.
 */
export function decideEngineBarKind(input: {
  modelState: ModelUiState;
  jsReady: boolean;
  activeMatches: boolean;
}): EngineBarKind {
  switch (input.modelState) {
    case "checking":
    case "missing":
    case "downloading":
    case "loading":
    case "error":
      return input.modelState;
    case "ready":
      return input.jsReady && input.activeMatches ? "ready" : "reload";
  }
}

/**
 * Spec for the recover path (ready → lost → send → reload → ready;
 * lost → foreground leaves "lost", never auto-loads).
 */
export type EngineUiPhase = "ready" | "lost" | "loading" | "absent";

export type EngineUiEvent =
  | { type: "probe"; status: EngineLivenessStatus }
  | { type: "send" }
  | { type: "load_started" }
  | { type: "load_ok" }
  | { type: "load_fail" }
  | { type: "foreground" };

export function nextEngineUiPhase(
  phase: EngineUiPhase,
  event: EngineUiEvent,
): EngineUiPhase {
  switch (event.type) {
    case "probe":
      if (event.status === "lost") return "lost";
      if (event.status === "absent") {
        return phase === "loading" ? "loading" : "absent";
      }
      return "ready";
    case "send":
      if (phase === "lost" || phase === "absent") return "loading";
      return phase;
    case "load_started":
      return "loading";
    case "load_ok":
      return "ready";
    case "load_fail":
      return phase === "loading" ? "absent" : phase;
    case "foreground":
      // ANTI_OOM: never auto-load. Lost stays lost so the chip can leave Ready.
      return phase;
    default:
      return phase;
  }
}

function asPositiveBytes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}
