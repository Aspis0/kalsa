/**
 * A room call's typed outcome: §9's refusals exactly as the contract
 * names them, plus the failures this client can recognise before or
 * instead of an answer. A message never carries a credential — it holds
 * the server's own one honest sentence or a fixed sentence of ours.
 */

export type RoomErrorCode =
  /** Server 400 (and any refusal code this client does not know on a 400). */
  | "bad_request"
  /** Server 409: the name another member or the host already wears. */
  | "name_taken"
  /** Server 409: one id, one message — this id carries a different one. */
  | "client_msg_id_reused"
  /** Server 413: the bytes overran the bound. */
  | "too_large"
  /** Server 400: a cursor claiming events that never happened. */
  | "bad_cursor"
  /** Server 401: this phone is no longer a member of this room. */
  | "removed"
  /** Refused locally against §9's bounds — the request was never sent. */
  | "invalid_input"
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

const SERVER_CODES = [
  "bad_request",
  "name_taken",
  "client_msg_id_reused",
  "too_large",
  "bad_cursor",
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

/** An answer whose status was fine but whose body was not. */
export function malformedRoomResponse(): RoomError {
  return { code: "malformed_response", message: "The room's answer did not match the protocol." };
}
