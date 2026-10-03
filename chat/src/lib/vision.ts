/**
 * What `brain_state`'s running arm says about this launch's eyes —
 * `{"state":"none"}` (the row ships no projector), `{"state":"offer",
 * "bytes":N}` (one the owner has not accepted), `{"state":"on"}` (a verified
 * projector rode this launch). The offer below reads the second. Whether an
 * attached picture may be sent is the ENGINE's own answer, from `/props`
 * (`modalities.ts`), never this: a file on the disk is not a projector in the
 * argv.
 */
export type VisionState =
  | { state: "none" }
  | { state: "offer"; bytes: number }
  | { state: "on" };

/** Anything absent, malformed or unknown is `none`: a state this page cannot
    read is never turned into an offer to download something. */
export function parseVision(value: unknown): VisionState {
  if (typeof value !== "object" || value === null) return { state: "none" };
  const record = value as { state?: unknown; bytes?: unknown };
  if (record.state === "on") return { state: "on" };
  if (
    record.state === "offer" &&
    typeof record.bytes === "number" &&
    Number.isFinite(record.bytes) &&
    record.bytes > 0
  ) {
    return { state: "offer", bytes: record.bytes };
  }
  return { state: "none" };
}

/** The size the offer names, or null when there is nothing to offer. */
export function offeredBytes(vision: VisionState | null): number | null {
  return vision?.state === "offer" ? vision.bytes : null;
}
