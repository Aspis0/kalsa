/**
 * What one queued post's outcome asks the queue to do next — pure, so
 * every §5/§9 verdict is testable without a wire: sent, terminal
 * failure (the id is burned — never a new one), hold (the room refused
 * this phone or the store is damaged: items stay queued, the next
 * trigger retries), or a backoff retry — epoch_changed forgetting the
 * cached epoch first, so the same id goes out bare and lands as new.
 */
import { type RoomError, type RoomResult } from "./roomError";
import type { RoomPostAck } from "./roomWire";

export type RoomQueueAttempt =
  | { kind: "sent"; seq: number; time: number }
  /** Terminal: this client_msg_id never posts again (§5). */
  | { kind: "failed"; error: RoomError }
  /** Stop now with everything still queued; a trigger retries later. */
  | { kind: "hold"; error: RoomError }
  /** Backoff retry of the SAME id; forgetEpoch drops the dead epoch first. */
  | { kind: "retry"; forgetEpoch: boolean; error: RoomError };

const TERMINAL = ["client_msg_id_reused", "bad_request", "too_large", "not_found", "invalid_input", "body_too_large"];
const HOLDS = ["removed", "pairing_store_damaged", "door_unusable"];

export function roomQueueAttempt(result: RoomResult<RoomPostAck>): RoomQueueAttempt {
  if (result.ok) return { kind: "sent", seq: result.value.seq, time: result.value.time };
  const error = result.error;
  if ((TERMINAL as readonly string[]).includes(error.code)) return { kind: "failed", error };
  if ((HOLDS as readonly string[]).includes(error.code)) return { kind: "hold", error };
  if (error.code === "epoch_changed") return { kind: "retry", forgetEpoch: true, error };
  // read_only, no_room, internal and the transport's failures: the room
  // may yet answer — anything unnamed keeps its message and waits.
  return { kind: "retry", forgetEpoch: false, error };
}
