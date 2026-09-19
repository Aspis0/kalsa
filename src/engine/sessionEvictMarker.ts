/**
 * The KALSA_SESSION evict marker: exactly one line per eviction run.
 *
 * Payload fields: op, ok, mode ("budget" | "space"),
 * reason?, errorType?, policy, keepModel, budgetBytes (budget mode) or
 * neededBytes/evictableBytes (space mode), freeBytes, sidecars, victims,
 * bytes, victimModels, poolBytes, totalBytes (budget mode), outcome?,
 * bookkeepingFailed?, gateReason?.
 *
 * `reason` always rides ok:false: over_budget_unevictable (budget mode,
 * nothing left it may evict while still over), deficit_uncoverable (space
 * mode, evictable bytes below the measured need — no whole session cache
 * deleted; stale sidecars may still be swept), invalid_budget (budget mode,
 * unusable input rejected before eviction), gate_unreadable (space mode,
 * post-sweep gate did not authorize a measured deficit).
 *
 * poolBytes is every chat file on disk, every model — the pool total. Nothing
 * caps it: the per-model budget multiplies (nModels x budgetBytes), and how
 * much disk KV may use in total is the owner's product decision, parked with
 * the "About 7 chats by default" Settings label. Until a number arrives, this
 * field is the only way to ever see "disk full with 1.9 GB of KV".
 *
 * Never a stem: stems contain conversation ids, and conversation identifiers
 * must not reach a log. errorType is allowlisted for the same reason — an
 * error name can carry a path as easily as a message can.
 */

export const EVICT_REASON_FAILED = "evict_failed";
export const EVICT_REASON_UNEVICTABLE = "over_budget_unevictable";
export const EVICT_REASON_DEFICIT = "deficit_uncoverable";
export const EVICT_REASON_INVALID_BUDGET = "invalid_budget";
export const EVICT_REASON_GATE_UNREADABLE = "gate_unreadable";

/** Error-shaped names only: Error, TypeError, DOMException.foo, <= 64 chars. */
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_$.]{0,63}$/;

export function errorTypeName(err: unknown): string {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" && ERROR_NAME_RE.test(name) ? name : "unknown";
}

export type EvictMarker = {
  /** Merge fields into the pending line; later sets win. */
  set: (fields: Record<string, unknown>) => void;
  /** Mark the run as thrown: reason evict_failed + allowlisted error type. */
  thrown: (err: unknown) => void;
  /** Emit the line. Once; never throws. */
  emit: () => void;
};

/**
 * The line starts ok:false so any early exit still tells the truth; a run
 * that reaches its end sets ok itself (true, or false + a reason).
 */
export function beginEvictMarker(): EvictMarker {
  const line: Record<string, unknown> = { op: "evict", ok: false };
  return {
    set(fields) {
      Object.assign(line, fields);
    },
    thrown(err) {
      line.ok = false;
      line.reason = EVICT_REASON_FAILED;
      line.errorType = errorTypeName(err);
    },
    emit() {
      try {
        console.log(`KALSA_SESSION ${JSON.stringify(line)}`);
      } catch {
        // telemetry must never throw
      }
    },
  };
}
