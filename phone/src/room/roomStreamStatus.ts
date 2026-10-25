/**
 * The verdict each non-2xx answer earns the stream: the room's refusal
 * to talk to it (removed), a stop no retry can change (404 — with the
 * codes a session stops with), a resync (409 or a bad cursor, the
 * latter keeping its epoch), or a retry through the backoff — 503 and
 * 500 are no verdict: the room may yet answer. Pure: status and body
 * in, action out.
 */
import { roomErrorFromResponse, type RoomError } from "./roomError";

/** Why a session stopped without a room verdict: never retried. */
export type RoomStreamStopCode = "not_found" | "resync_failed";

export type RoomStreamStatusAction =
  | { kind: "removed"; error: RoomError }
  | { kind: "stop"; code: RoomStreamStopCode; message: string }
  | { kind: "resync"; forgetEpoch: boolean }
  | { kind: "retry" };

export function roomStreamStatusAction(status: number, body: string): RoomStreamStatusAction {
  let parsed: unknown = null;
  try {
    parsed = body === "" ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  const error = roomErrorFromResponse(status, parsed);
  if (error.code === "removed") return { kind: "removed", error };
  if (error.code === "not_found") {
    // This computer serves no room routes; retrying asks a question
    // with one answer.
    return { kind: "stop", code: "not_found", message: error.message };
  }
  if (error.code === "epoch_changed") return { kind: "resync", forgetEpoch: true };
  if (error.code === "bad_cursor") return { kind: "resync", forgetEpoch: false };
  return { kind: "retry" };
}
