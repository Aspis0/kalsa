/**
 * One privacy-safe line for every failed remote chat or init: logcat must
 * answer "did the remote brain fail, at which stage, on which road, with
 * which code" with no diagnostics switch — the same deal KALSA_ROAD makes
 * for dials and KALSA_PAIRING_FAIL for pairing stages. The record carries
 * the road, the stage and the normalized code only: never user text,
 * tokens, keys, node ids, or a raw exception message.
 */
import type { Road } from "../../remote/road";

export type RemoteBrainFailureStage = "init" | "stream";

/** The road a failure rode; "unknown" = it died before the dial answered. */
export type RemoteBrainFailureRoad = Road | "unknown";

/** The probe's own status spelling ("models HTTP 401") is a code here too. */
const PROBE_HTTP = /^(?:models|health) HTTP (\d{3})$/;

/**
 * Only a full lower_snake_case token of our own shape may be logged
 * verbatim. A message merely STARTING with "remote_brain_" could carry a
 * suffix nobody vetted (a URL, a token), so anything else — a localized
 * sentence, a native exception, a prefixed foreign string — collapses to
 * the fixed "other".
 */
const OWN_CODE = /^remote_brain_[a-z0-9_]+$/;

/**
 * The normalized failure code. Our own codes pass through; the engine's
 * control codes map to their token; everything else collapses to "other",
 * so no arbitrary text can reach the log.
 */
export function remoteBrainFailureReason(error: unknown): string {
  if (error instanceof Error) {
    if (OWN_CODE.test(error.message)) return error.message;
    const code = (error as { code?: unknown }).code;
    if (code === "interrupted" || code === "truncated") return code;
    const probe = PROBE_HTTP.exec(error.message);
    if (probe) return `remote_brain_http_${probe[1]}`;
  }
  return "other";
}

export function logRemoteBrainFailure(
  stage: RemoteBrainFailureStage,
  road: RemoteBrainFailureRoad,
  error: unknown,
): void {
  // The turn's own abort is a user stop, not a failure: logging it would
  // put one noise line on every pressed Stop.
  if (remoteBrainFailureReason(error) === "interrupted") return;
  try {
    console.log(
      "remote.brain.failure",
      JSON.stringify({ road, stage, reason: remoteBrainFailureReason(error) }),
    );
  } catch {
    // Logging must never change the failure it reports.
  }
}
