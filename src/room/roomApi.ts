/**
 * The typed room client: info, history, post and name (§3–§6) over the
 * door chat already rides — same bearer, same one-road-per-operation
 * decision (iroh `door` lane or HTTPS), same fetch. Every refusal comes
 * back as a typed RoomResult; no route here talks SSE.
 *
 * One pairing threads through one call: the door config carries the
 * record's local id captured BEFORE any await, and that id — never a
 * later read of "the active record" — is what gets the room bound, what
 * keys the cached epoch the door guard checks, and what a 401 marks.
 */
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import {
  canSendAuthorization,
  isNonLoopback,
  joinRemoteApiUrl,
  remoteUrlGateError,
} from "../engine/remote/remoteUrl";
import { bindPairingRoom, markPairingRemoved } from "../pairing/pairingCredentialStore";
import { doorFetchFor, establishDoorRoad } from "../remote/doorRoad";
import {
  checkClientMsgId,
  checkEncodedBody,
  checkHistoryLimit,
  checkRoomName,
  checkRoomText,
} from "./roomBounds";
import {
  malformedRoomResponse,
  roomErrorFromResponse,
  type RoomError,
  type RoomResult,
} from "./roomError";
import {
  parseRoomHistoryPage,
  parseRoomInfo,
  parseRoomNameAck,
  parseRoomPostAck,
  type RoomHistoryPage,
  type RoomInfo,
  type RoomNameAck,
  type RoomPostAck,
} from "./roomWire";

export type RoomCallOptions = { signal?: AbortSignal };

/** The epoch each pairing last read — this process only. A restart forgets
 *  it, and an absent header is a phone that cached nothing (§7). */
const roomEpochs = new Map<string, string>();

/** Only our own codes cross to a caller: a thrown message may quote
 *  anything, and nothing may ever quote a credential. */
function transportMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("remote_brain_") ? message : "remote_brain_network";
}

function refused(error: RoomError): RoomResult<never> {
  return { ok: false, error };
}

async function readErrorBody(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // The 401's body is empty by contract, and any unparsable error body
    // still has its status to map by.
    return null;
  }
}

type RoomCall = { result: RoomResult<unknown>; localId: string | null };

/** One route call: local bounds, door, bearer, road, request, status →
 *  typed result — plus the room-side effects a status owes (401 marks,
 *  a dead epoch is dropped). */
async function roomRequest(
  method: string,
  path: string,
  query: readonly string[],
  body: unknown,
  options?: RoomCallOptions,
): Promise<RoomCall> {
  let encodedBody: string | undefined;
  if (body !== undefined) {
    encodedBody = JSON.stringify(body);
    const oversized = checkEncodedBody(encodedBody);
    if (oversized !== null) return { result: refused(oversized), localId: null };
  }
  try {
    const door = await getRemoteDoorConfig();
    const localId = door.pairing?.localId ?? null;
    // §2: a record this room already refused stops sending its bearer —
    // the 401 needs no round trip to be known.
    if (door.pairing !== null && door.pairing.removed) {
      return { result: refused(roomErrorFromResponse(401, null)), localId };
    }
    const gate = remoteUrlGateError(door.url);
    if (gate !== null) return { result: refused({ code: "door_unusable", message: gate }), localId };
    const token = await getRemoteDoorToken(door);
    if (token === null && isNonLoopback(door.url)) {
      return {
        result: refused({ code: "door_unusable", message: "remote_brain_token_required" }),
        localId,
      };
    }
    const road = await establishDoorRoad(door, options?.signal);
    const fetcher = doorFetchFor(road);
    const url = joinRemoteApiUrl(door.url, path) + (query.length > 0 ? `?${query.join("&")}` : "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (encodedBody !== undefined) headers["Content-Type"] = "application/json";
    if (token !== null && canSendAuthorization(url)) headers.Authorization = `Bearer ${token}`;
    if (localId !== null) {
      const epoch = roomEpochs.get(localId);
      if (epoch !== undefined) headers["Kalsa-Room-Epoch"] = epoch;
    }
    const response = await fetcher(url, {
      method,
      headers,
      body: encodedBody,
      signal: options?.signal,
    });
    if (!response.ok) {
      const error = roomErrorFromResponse(response.status, await readErrorBody(response));
      if (localId !== null && error.code === "removed") {
        // §2's mark: kept even though the refusal stands either way — the
        // record survives, only its bearer is retired for this room.
        try {
          await markPairingRemoved(localId);
        } catch {
          // The next401 marks again; an unreadable map is its own error.
        }
      }
      if (localId !== null && error.code === "epoch_changed") {
        roomEpochs.delete(localId);
      }
      return { result: refused(error), localId };
    }
    try {
      return { result: { ok: true, value: await response.json() }, localId };
    } catch {
      return { result: refused(malformedRoomResponse()), localId };
    }
  } catch (error) {
    return {
      result: refused({ code: "unreachable", message: transportMessage(error) }),
      localId: null,
    };
  }
}

function parsed<T>(value: unknown, parse: (body: unknown) => T | null): RoomResult<T> {
  const result = parse(value);
  return result === null ? refused(malformedRoomResponse()) : { ok: true, value: result };
}

/** §3 room info. The first successful answer binds the room under the
 *  record whose credential read it and caches the epoch every later
 *  route sends; a failed bind never fails a read that succeeded — the
 *  next info retries it. */
export async function fetchRoomInfo(options?: RoomCallOptions): Promise<RoomResult<RoomInfo>> {
  const { result, localId } = await roomRequest("GET", "/kalsa/room/info", [], undefined, options);
  if (!result.ok) return result;
  const info = parseRoomInfo(result.value);
  if (info === null) return refused(malformedRoomResponse());
  if (localId !== null) {
    roomEpochs.set(localId, info.epoch);
    try {
      await bindPairingRoom(localId, info.roomId);
    } catch {
      // The read stands; the map surfaces its own damage on its next access.
    }
  }
  return { ok: true, value: info };
}

export type RoomHistoryQuery = { after?: number; before?: number; limit?: number };

/** §4 history page; with no cursor the computer sends its newest limit. */
export async function fetchRoomHistory(
  query: RoomHistoryQuery,
  options?: RoomCallOptions,
): Promise<RoomResult<RoomHistoryPage>> {
  const invalidLimit = query.limit === undefined ? null : checkHistoryLimit(query.limit);
  if (invalidLimit !== null) return refused(invalidLimit);
  const params: string[] = [];
  if (query.after !== undefined) params.push(`after=${query.after}`);
  if (query.before !== undefined) params.push(`before=${query.before}`);
  if (query.limit !== undefined) params.push(`limit=${query.limit}`);
  const { result } = await roomRequest(
    "GET",
    "/kalsa/room/history",
    params,
    undefined,
    options,
  );
  if (!result.ok) return result;
  return parsed(result.value, parseRoomHistoryPage);
}

/** §5 post: the id makes a retry of the same content idempotent. */
export async function postRoomMessage(
  message: { clientMsgId: string; text: string; callAi?: boolean },
  options?: RoomCallOptions,
): Promise<RoomResult<RoomPostAck>> {
  const invalid = checkClientMsgId(message.clientMsgId) ?? checkRoomText(message.text);
  if (invalid !== null) return refused(invalid);
  const { result } = await roomRequest(
    "POST",
    "/kalsa/room/messages",
    [],
    {
      client_msg_id: message.clientMsgId,
      text: message.text,
      call_ai: message.callAi === true,
    },
    options,
  );
  if (!result.ok) return result;
  return parsed(result.value, parseRoomPostAck);
}

/** §6 set my name; the computer trims and judges it, this only bounds it. */
export async function putRoomName(
  name: string,
  options?: RoomCallOptions,
): Promise<RoomResult<RoomNameAck>> {
  const invalid = checkRoomName(name);
  if (invalid !== null) return refused(invalid);
  const { result } = await roomRequest("PUT", "/kalsa/room/name", [], { name }, options);
  if (!result.ok) return result;
  return parsed(result.value, parseRoomNameAck);
}
