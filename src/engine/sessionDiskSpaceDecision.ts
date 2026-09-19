import { sessionDiskDeficitBytes } from "./sessionDiskMath";
import type {
  SessionDiskGateInput,
  SessionDiskGateResult,
} from "./sessionPersistence";
import type { SpaceEvictionResult } from "./sessionPool";

export type SessionDiskSpaceDecision =
  | { proceed: true }
  | { proceed: false; log: Record<string, number | string> };

type SessionDiskGate = (
  input: SessionDiskGateInput,
) => Promise<SessionDiskGateResult>;

type SessionSpaceEvictor = (
  keepStem: string,
  diskInput: SessionDiskGateInput,
) => Promise<SpaceEvictionResult>;

/**
 * Decide whether a save may proceed when the first disk gate refuses.
 * The gate and evictor are injected so this deletion-authorizing path stays
 * testable without loading the native engine or filesystem modules.
 */
export async function decideSessionDiskSpace(
  input: { stem: string; diskInput: SessionDiskGateInput },
  dependencies: { gate: SessionDiskGate; evict: SessionSpaceEvictor },
): Promise<SessionDiskSpaceDecision> {
  const { stem, diskInput } = input;
  const { gate, evict } = dependencies;
  const diskGate = await gate(diskInput);
  if (!diskGate.ok) {
    // Only a measured short-space refusal may delete anything: no_size
    // cannot be fixed by freeing (the write cannot be sized), and an
    // unreadable reading is not proof that space is short.
    if (diskGate.reason !== "short") {
      return {
        proceed: false,
        log: {
          reason: "disk",
          diskReason: diskGate.reason ?? "gate_error",
        },
      };
    }
    // The write has not happened yet — this is the one place eviction
    // runs BEFORE a save instead of after one. The space evictor
    // deliberately re-reads after sweeping: stale sidecars can close the
    // deficit, and any refusal must describe the disk as it is then.
    const space = await evict(stem, diskInput);
    if (space.status !== "covered" && space.status !== "not_needed") {
      return {
        proceed: false,
        log: {
          reason: "disk",
          diskReason: space.status === "uncoverable" ? "short" : space.status,
          diskEvictionStatus: space.status,
          ...(space.requiredDeficitBytes != null &&
          space.requiredDeficitBytes > 0
            ? { diskRequiredDeficitBytes: space.requiredDeficitBytes }
            : {}),
          ...(space.bytes > 0 ? { diskFreedBytes: space.bytes } : {}),
        },
      };
    }
    const retryGate = await gate(diskInput);
    if (!retryGate.ok) {
      // Residual case (deleted, still failed): the deficit was an
      // estimate and the disk can move under it. The bytes stay in the
      // open — what was actually dropped, and what is still missing
      // (-1 = unknown, same convention as usedTokens in the save line).
      return {
        proceed: false,
        log: {
          reason: "disk",
          diskReason: retryGate.reason ?? "gate_error",
          diskFreedBytes: space.bytes,
          // Keep -1 for unknown retry inputs; known inputs use the shared
          // strict-gate arithmetic instead of re-deriving it here.
          diskResidualShortfallBytes:
            retryGate.requiredBytes != null && retryGate.freeBytes != null
              ? sessionDiskDeficitBytes(
                  retryGate.requiredBytes,
                  retryGate.freeBytes,
                )
              : -1,
        },
      };
    }
    // The caller can serve one save with two evictions, and both are correct:
    // this one was space mode (measured deficit, foreign first, whole files);
    // the caller's post-save eviction after the write enforces the user's
    // budget in LRU order and runs after ANY successful save. Each runs at
    // most once per save.
  }
  return { proceed: true };
}
