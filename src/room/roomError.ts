/**
 * A room call's typed outcome: §9's refusals exactly as the door codes
 * them, plus the failures this client recognises before or instead of
 * an answer. A message never carries a credential — it holds the door's
 * own one honest sentence or a fixed sentence of ours.
 */

export type RoomErrorCode =
  /** Door 400: a refusal with no finer code, known or not. */
  | "bad_request"
  /** Door 409: the name another member or the host already wears. */
  | "name_taken"
  /** Door 409: one id, one message — this id carries a different one. */
  | "client_msg_id_reused"
  /** Door 413: the bytes overran the bound. */
  | "too_large"
  /** Door 400: a cursor claiming events that never happened (the SSE route). */
  | "bad_cursor"
  /** Door 409: the cached epoch is dead — drop it and refetch (§7). */
  | "epoch_changed"
  /** Door 503: no room is open on that computer. */
  | "no_room"
  /** Door 503: the transcript needs repair; reads work, posts refuse. */
  | "read_only"
  /** Door 404: this computer does not serve room routes at all. */
  | "not_found"
  /** Door 500: the room's store failed; nothing the phone can do. */
  | "internal"
  /** Door 401 (empty body): this phone is no longer a member of the room. */
  | "removed"
  /** Refused locally against §9's bounds — the request was never sent. */
  | "invalid_input"
  /** Refused locally: the encoded body is over the 16 KiB the door reads. */
  | "body_too_large"
  /** Refused locally: no secure random source could mint the id. */
  | "client_msg_id_unavailable"
  /** Refused locally: the shelf already holds its 200-message cap. */
  | "queue_full"
  /** The pairing store on this phone is damaged: backed up, writes refused. */
  | "pairing_store_damaged"
  /** The saved pairing that owned this shelf no longer exists. */
  | "pairing_missing"
  /** No door may carry this request: URL gate, or no bearer for a remote door. */
  | "door_unusable"
  /** The transport failed: dial, request or abort. */
  | "unreachable"
  /** An HTTP status or error code the contract does not define. */
  | "unexpected"
  /** A 2xx answer that is not the shape §3–§6 promise. */
  | "malformed_response";

export type RoomError = { code: RoomErrorCode; message: string };

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomError };

/**
 * The sentence for the one doorless-door failure — the iroh road this
 * pairing rides is gone on this phone — kept in step with en.ts's
 * settings.remoteBrainFailIrohMissing (the room layer has no translator).
 * Room calls show it instead of the raw code, and the stream knows the
 * case by it: the one unusable door that can heal, so it is retried.
 */
export const IROH_MISSING_MESSAGE =
  "This app can't reach a computer paired without an address. Update Kalsa on this phone, or pair again using the computer's address.";

/** Every code the door sends with its own sentence (§9). */
const SERVER_CODES = [
  "bad_request",
  "name_taken",
  "client_msg_id_reused",
  "too_large",
  "bad_cursor",
  "epoch_changed",
  "no_room",
  "read_only",
  "not_found",
  "internal",
] as const;

const REMOVED_MESSAGE = "This phone is no longer a member of the room.";
const REFUSED_MESSAGE = "The room refused the request.";

function errorBody(value: unknown): { code: string | null; message: string | null } {
  if (typeof value !== "object" || value === null) return { code: null, message: null };
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return { code: null, message: null };
  const fields = error as Record<string, unknown>;
  return {
    code: typeof fields.code === "string" ? fields.code : null,
    message: typeof fields.message === "string" ? fields.message : null,
  };
}

/** Map a non-2xx room answer: 401 first (its body is empty by contract),
 *  then §9's codes, then the status the contract defaults a refusal to. */
export function roomErrorFromResponse(status: number, body: unknown): RoomError {
  if (status === 401) return { code: "removed", message: REMOVED_MESSAGE };
  const parsed = errorBody(body);
  const message = parsed.message ?? REFUSED_MESSAGE;
  if (parsed.code !== null && (SERVER_CODES as readonly string[]).includes(parsed.code)) {
    return { code: parsed.code as RoomErrorCode, message };
  }
  if (status === 400) return { code: "bad_request", message };
  if (status === 413) return { code: "too_large", message };
  return {
    code: "unexpected",
    message: parsed.message ?? `unexpected room response (HTTP ${status})`,
  };
}

/** The one 401 verdict, for every path that refuses BEFORE a request:
 *  the room routes, the chat engine, wherever the record itself already
 *  says the door will not have it. */
export function removedRoomError(): RoomError {
  return roomErrorFromResponse(401, null);
}

/** The one resync signal, in one function: a room answer saying the epoch
 *  behind every cached seq is dead. Drop the cache, refetch info (§7). */
export function requiresRoomResync(result: RoomResult<unknown>): boolean {
  return !result.ok && result.error.code === "epoch_changed";
}

/** An answer whose status was fine but whose body was not. */
export function malformedRoomResponse(): RoomError {
  return { code: "malformed_response", message: "The room's answer did not match the protocol." };
}
