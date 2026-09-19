/**
 * Load-path fit gate. Runs the SAME evaluation as the send path
 * (deviceProfile.decidePreSendFit) before a model load, with one
 * load-specific precondition: a resident model different from the target is
 * disposed first (bounded, injected) so the gate does not refuse on memory
 * held by the very model it is about to replace. Same model resident →
 * no dispose, no size-vs-available re-check.
 */
import { decidePreSendFit } from "./deviceProfile";
import { shouldRecoverLost } from "./engineLiveness";
import type { LoadPolicy } from "./loadPolicy";

/**
 * reasonKey carries ONLY the fit decider's own reason, pass-through. A marker
 * refusal has no fit reason — the marker knows only that a load did not
 * finish — so its reasonKey is null, never a borrowed claim.
 */
export type LoadGateVerdict =
  | { allow: true; refusedBy: null; reasonKey: null; disposedResident: boolean }
  | {
      allow: false;
      refusedBy: "fit";
      reasonKey: "model.tooLarge" | "model.tightNow";
      disposedResident: boolean;
    }
  | {
      allow: false;
      refusedBy: "marker" | "disposeTimeout";
      reasonKey: null;
      disposedResident: boolean;
    };

export type LoadRefusal = Extract<LoadGateVerdict, { allow: false }>;

/**
 * Refusal → i18n key, selected by the cause the code actually knows. The fit
 * branch passes the decider's reason through untouched (tooLarge vs tightNow —
 * two different truths). The marker branch never claims a memory verdict: it
 * says the load was set aside, and points at what can actually be done —
 * switch to another downloaded model, download a smaller one, or, when no
 * smaller model exists at all, retry the load.
 */
export function refusalMessageKey(
  verdict: LoadRefusal,
  otherModelDownloaded: boolean,
  smallerModelExists: boolean,
): "model.tooLarge" | "model.tightNow" | "model.loadSetAside" | "model.loadSetAsideDownloadSmaller" | "model.loadSetAsideRetry" | "errors.engineDisposeTimeout" {
  switch (verdict.refusedBy) {
    case "fit":
      return verdict.reasonKey;
    case "disposeTimeout":
      return "errors.engineDisposeTimeout";
    case "marker":
      if (otherModelDownloaded) return "model.loadSetAside";
      return smallerModelExists
        ? "model.loadSetAsideDownloadSmaller"
        : "model.loadSetAsideRetry";
  }
}

/**
 * True when the registry offers a strictly smaller bundle than the refused
 * model — "download a smaller model" is advice nobody can follow when the
 * refused model is already the smallest.
 */
export function smallerModelExists(
  otherModelSizes: number[],
  refusedSizeBytes: number,
): boolean {
  return otherModelSizes.some((size) => size < refusedSizeBytes);
}

export async function gateModelLoad(input: {
  model: {
    id: string;
    sizeBytes: number;
    engineCtx: number;
    kvBytesPerToken?: number | null;
    mmproj?: { sizeBytes: number } | null;
    loadPolicy?: LoadPolicy;
  };
  markerPresent: boolean;
  /** Active engine model id while the engine is ready, else null. */
  residentModelId: string | null;
  lostModelId: string | null;
  /** kalsa.bench.norepack tri-state, same as the send path's opts. */
  benchNoRepack?: boolean;
  /** Bounded dispose of the resident engine; false on timeout. */
  disposeResident: () => Promise<boolean>;
  /** Uncached MemAvailable; the injected wrapper maps errors to null. */
  getAvailableBytes: () => Promise<number | null>;
}): Promise<LoadGateVerdict> {
  // Death on a previous launch: refuse before touching the resident engine.
  // No fit reason exists here — reasonKey stays null.
  if (input.markerPresent) {
    return {
      allow: false,
      reasonKey: null,
      refusedBy: "marker",
      disposedResident: false,
    };
  }
  // Same model already resident: nothing to free, and size-vs-available would
  // double-count the resident bytes that lowered MemAvailable (P0).
  if (input.residentModelId === input.model.id) {
    return { allow: true, refusedBy: null, reasonKey: null, disposedResident: false };
  }
  // Reachable, not defensive. Precondition: a model-switch dispose that TIMED
  // OUT — runNativeOpBounded refused without ever invoking disposeEngine, so
  // the old context is still resident (isEngineReady() still true, activeModelId
  // never cleared) while the switch's finally released the chat slot. The next
  // explicit load acquires from idle and lands here: dispose the leaked
  // resident (bounded) before admitting the target.
  let disposedResident = false;
  if (input.residentModelId !== null) {
    const disposed = await input.disposeResident();
    // Telemetry reports what happened, not what was attempted: a timeout
    // means runNativeOpBounded never enqueued, so nothing was disposed.
    disposedResident = disposed;
    if (!disposed) {
      // Previous model still resident — refuse rather than stack a second
      // context on top of it.
      return {
        allow: false,
        reasonKey: null,
        refusedBy: "disposeTimeout",
        disposedResident,
      };
    }
  }
  const available = await input.getAvailableBytes();
  const decision = decidePreSendFit(
    {
      sizeBytes: input.model.sizeBytes,
      engineCtx: input.model.engineCtx,
      kvBytesPerToken: input.model.kvBytesPerToken,
      mmproj: input.model.mmproj,
      loadPolicy: input.model.loadPolicy,
    },
    available,
    {
      alreadyResident: false,
      recoverLost: shouldRecoverLost(input.lostModelId, input.model.id),
      lostModelId: input.lostModelId,
      requestedModelId: input.model.id,
      benchNoRepack: input.benchNoRepack,
    },
  );
  return decision.allow
    ? { allow: true, refusedBy: null, reasonKey: null, disposedResident }
    : {
        allow: false,
        // Pass-through: the decider produced this reason, the message must
        // carry exactly it (tooLarge and tightNow are different truths).
        reasonKey: decision.reasonKey,
        refusedBy: "fit",
        disposedResident,
      };
}
