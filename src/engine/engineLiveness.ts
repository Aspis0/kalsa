/**
 * Engine-lost detection + UI/send recovery state machine.
 *
 * RSS collapse is NOT a death signal. llama.rn memory-maps the GGUF
 * (`LLAMA_LOAD_MODE_MMAP`) and `use_mlock: true` is fail-soft on Android
 * (RLIMIT_MEMLOCK ≈ 64 KB). Under pressure the kernel evicts file-backed
 * pages; a live engine shows a large RSS drop by design. Treating that
 * as "lost" leaks the still-live native context (no GC finalizer) and
 * double-allocates on reload — an OOM on the exact device state that
 * triggered the reading.
 *
 * Detection is on first native contact (send path): a bounded-timeout
 * tokenize/ping. Timeout or native error ⇒ lost. Probe unavailable,
 * omitted, or busy (in-flight stream/send) ⇒ alive (fail-safe / no-op).
 *
 * This module is pure (no RN / expo imports) so node harnesses compile it.
 * I/O (native ping, bounded release) lives in LlamaService.
 */

/** Wall-clock budget for the on-contact native ping (tokenize). */
export const ENGINE_CONTACT_PROBE_TIMEOUT_MS = 8_000;

export type EngineLivenessStatus = "alive" | "lost" | "absent";

export type EngineLivenessReason = "native_timeout" | "native_error";

export type EngineLivenessVerdict =
  | { status: "absent" }
  | { status: "alive" }
  | { status: "lost"; reason: EngineLivenessReason };

/**
 * Result of the send-path native ping.
 * - ok: tokenize returned — engine is alive (even if RSS collapsed).
 * - timeout / error: mark lost.
 * - unavailable: ping could not be issued — fail-safe alive.
 * - busy: stream/send already in flight — no-op, do not mark lost.
 */
export type ContactProbeResult =
  | "ok"
  | "timeout"
  | "error"
  | "unavailable"
  | "busy";

export type EngineLivenessInput = {
  /** JS-side `isEngineReady()` (context wrapper present, not hung). */
  jsReady: boolean;
  /**
   * On-contact native ping. Omitted / null / unavailable / busy ⇒ alive.
   * RSS fields below are telemetry only and never produce `lost`.
   */
  contact?: ContactProbeResult | null;
  /** Live process RSS (`/proc/self/status` VmRSS). Telemetry only. */
  rssBytes?: number | null;
  /** RSS captured after a successful initLlama. Telemetry only. */
  lastKnownRssBytes?: number | null;
  /** Active model file size. Telemetry only. */
  modelSizeBytes?: number | null;
};

/**
 * On-contact liveness. RSS is ignored: mmap eviction is not death.
 * Probe unavailable / busy / omitted ⇒ alive (false-negative-safe).
 */
export function decideEngineLiveness(
  input: EngineLivenessInput,
): EngineLivenessVerdict {
  if (!input.jsReady) return { status: "absent" };
  if (input.contact === "timeout") {
    return { status: "lost", reason: "native_timeout" };
  }
  if (input.contact === "error") {
    return { status: "lost", reason: "native_error" };
  }
  return { status: "alive" };
}

/**
 * Parse VmRSS from `/proc/self/status` (or a fixture).
 * `VmRSS:    171088 kB` → bytes. Null on missing / malformed input.
 * Telemetry only — never a lost trigger.
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

/** Scoped RAM-gate bypass: armed only for the model that was marked lost. */
export type EngineLostRecoveryState = {
  armed: boolean;
  lostModelId: string | null;
};

export function initialEngineLostRecovery(): EngineLostRecoveryState {
  return { armed: false, lostModelId: null };
}

export type EngineLostRecoveryEvent =
  | { type: "mark_lost"; modelId: string | null }
  | { type: "load_ok" }
  | { type: "load_fail" }
  | { type: "clear" };

/**
 * Recovery is one-shot and model-scoped. load_ok AND load_fail both
 * disarm — a failed reload must not leave the P0 RAM gate open.
 */
export function nextEngineLostRecovery(
  _state: EngineLostRecoveryState,
  event: EngineLostRecoveryEvent,
): EngineLostRecoveryState {
  switch (event.type) {
    case "mark_lost": {
      const id =
        typeof event.modelId === "string" && event.modelId.length > 0
          ? event.modelId
          : null;
      return { armed: id != null, lostModelId: id };
    }
    case "load_ok":
    case "load_fail":
    case "clear":
      return { armed: false, lostModelId: null };
    default:
      return { armed: false, lostModelId: null };
  }
}

/** True only when both ids are non-empty strings and equal. */
export function shouldRecoverLost(
  lostModelId: string | null | undefined,
  requestedModelId: string | null | undefined,
): boolean {
  return (
    typeof lostModelId === "string" &&
    lostModelId.length > 0 &&
    lostModelId === requestedModelId
  );
}

export function shouldBypassRamGate(
  recovery: EngineLostRecoveryState,
  requestedModelId: string,
): boolean {
  return recovery.armed && shouldRecoverLost(recovery.lostModelId, requestedModelId);
}

/**
 * Lost-mark release: stopCompletion + settled wait + safety timeout.
 * Any timeout ⇒ hung (never force-release a handle that just failed a ping).
 */
export type BoundedReleaseOutcome = "released" | "hung";

export function decideBoundedReleaseOutcome(input: {
  settled: boolean;
  /** Recorded for telemetry; lost-path never force-releases on timeout. */
  hasActiveNative?: boolean;
}): BoundedReleaseOutcome {
  return input.settled ? "released" : "hung";
}
