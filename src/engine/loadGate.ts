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

export type LoadRefusalKind = "marker" | "fit" | "disposeTimeout";

export type LoadGateVerdict = {
  allow: boolean;
  /** Existing i18n key to surface on refusal; null when allowed. */
  reasonKey: "model.tooLarge" | "model.tightNow" | "errors.engineDisposeTimeout" | null;
  refusedBy: LoadRefusalKind | null;
  /** True only when a different resident model WAS disposed (not attempted). */
  disposedResident: boolean;
};

/**
 * Refusal → i18n key, selected by the cause the code actually knows. The
 * marker knows only that a load did not finish — dev reload, native error and
 * swipe-kill land there too — so it must not claim "too large", which is the
 * fit verdict's claim. When nothing else is on disk the marker message must
 * point at the real way out: downloading a smaller model.
 */
export function refusalMessageKey(
  refusedBy: LoadRefusalKind,
  otherModelDownloaded: boolean,
): "model.tooLarge" | "model.loadSetAside" | "model.loadSetAsideDownloadSmaller" | "errors.engineDisposeTimeout" {
  switch (refusedBy) {
    case "fit":
      return "model.tooLarge";
    case "disposeTimeout":
      return "errors.engineDisposeTimeout";
    case "marker":
      return otherModelDownloaded
        ? "model.loadSetAside"
        : "model.loadSetAsideDownloadSmaller";
  }
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
  if (input.markerPresent) {
    return {
      allow: false,
      reasonKey: "model.tooLarge",
      refusedBy: "marker",
      disposedResident: false,
    };
  }
  // Same model already resident: nothing to free, and size-vs-available would
  // double-count the resident bytes that lowered MemAvailable (P0).
  if (input.residentModelId === input.model.id) {
    return { allow: true, reasonKey: null, refusedBy: null, disposedResident: false };
  }
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
        reasonKey: "errors.engineDisposeTimeout",
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
    ? { allow: true, reasonKey: null, refusedBy: null, disposedResident }
    : { allow: false, reasonKey: decision.reasonKey, refusedBy: "fit", disposedResident };
}
