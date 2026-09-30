/**
 * What one queued post's outcome asks the queue to do next — pure, so
 * every §5/§9 verdict is testable without a wire: sent, terminal
 * failure (the id is burned — never a new one), hold (the room refused
 * this phone, or its member is gone: items stay queued with the
 * sentence, the next trigger retries), or a backoff retry of the SAME
 * id.
 */
import { type RoomError, type RoomResult } from "./roomError";
import type { RoomPostAck } from "./roomWire";

export type RoomQueueAttempt =
  | { kind: "sent"; seq: number; time: number }
  /** Terminal: this client_msg_id never posts again (§5). */
  | { kind: "failed"; error: RoomError }
  /** Stop now with everything still queued; a trigger retries later. */
  | { kind: "hold"; error: RoomError }
  /** Backoff retry of the SAME id. */
  | { kind: "retry"; error: RoomError };

const TERMINAL = ["client_msg_id_reused", "bad_request", "too_large", "not_found", "invalid_input", "body_too_large"];
const HOLDS = ["removed", "pairing_store_damaged", "door_unusable"];

/** The door's own sentence for a member no room claims anymore —
 *  kalsa-room/src/room.rs:53, wired as 400 bad_request with its
 *  siblings at crates/kalsa-door/src/room/routes.rs:260. */
const NOT_A_MEMBER = "that member cannot post in this room";

export function roomQueueAttempt(result: RoomResult<RoomPostAck>): RoomQueueAttempt {
  if (result.ok) return { kind: "sent", seq: result.value.seq, time: result.value.time };
  const error = result.error;
  // NotAMember rides400 with EmptyText and BadClientMsgId, but it means
  // what401 means: the id is NOT burned — enrollment is re-earned, and
  // the same message must still be able to post.
  if (error.code === "bad_request" && error.message === NOT_A_MEMBER) {
    return { kind: "hold", error };
  }
  if ((TERMINAL as readonly string[]).includes(error.code)) return { kind: "failed", error };
  if ((HOLDS as readonly string[]).includes(error.code)) return { kind: "hold", error };
  if (error.code === "epoch_changed") return { kind: "retry", error };
  // read_only, no_room, internal and the transport's failures: the room
  // may yet answer — anything unnamed keeps its message and waits.
  return { kind: "retry", error };
}
