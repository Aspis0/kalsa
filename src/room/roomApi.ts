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
import {
  doorConfigForPairing,
  getRemoteDoorConfig,
  getRemoteDoorToken,
  type RemoteDoorConfig,
} from "../engine/remote/remoteDoorConfig";
import {
  canSendAuthorization,
  isNonLoopback,
  joinRemoteApiUrl,
  remoteUrlGateError,
} from "../engine/remote/remoteUrl";
import { doorRequestBase } from "../engine/remote/doorRequestBase";
import {
  bindPairingRoom,
  getPairing,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { isPairingStoreDamaged } from "../pairing/pairingMap";
import { doorFetchFor, establishDoorRoad } from "../remote/doorRoad";
import {
  checkClientMsgId,
  checkEncodedBody,
  checkHistoryLimit,
  checkRoomName,
  checkRoomText,
} from "./roomBounds";
import {
  IROH_MISSING_MESSAGE,
  malformedRoomResponse,
  removedRoomError,
  roomErrorFromResponse,
  type RoomError,
  type RoomResult,
} from "./roomError";
import {
  cachedRoomEpoch,
  forgetRoomEpoch,
  noteRoomEpoch,
} from "./roomEpochs";
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

export type RoomCallOptions = {
  signal?: AbortSignal;
  /** Whose pairing this call rides: the record with this local id — the
   *  event stream's resync refetches for the room IT is attached to —
   *  or, absent, the active pairing the chat door reads. */
  roomLocalId?: string;
};

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

export type RoomCallDoor = {
  door: RemoteDoorConfig;
  localId: string | null;
  token: string | null;
  /** The URL this call's request lines name: the door's address, or the
   *  iroh stand-in origin for a pairing that saved none. */
  base: string;
};

/** The door, bearer and pre-request verdicts one room call or event
 *  stream rides: the record named by roomLocalId, or the active pairing
 *  (manual door included). A pairing this room refused — or one that no
 *  longer exists — answers removed before a byte; an unusable door is
 *  typed; a damaged store throws for the caller to surface. */
export async function roomDoorForCall(
  roomLocalId?: string,
): Promise<{ ok: true; value: RoomCallDoor } | { ok: false; error: RoomError }> {
  let door: RemoteDoorConfig;
  if (roomLocalId !== undefined) {
    const record = await getPairing(roomLocalId);
    if (record === null) {
      // Nothing left to dial — a record a newer pairing superseded has no
      // bearer to send anywhere, and reads like one the room refused.
      return { ok: false, error: removedRoomError() };
    }
    door = doorConfigForPairing(record);
  } else {
    door = await getRemoteDoorConfig();
  }
  // §2: a record this room already refused stops sending its bearer —
  // the 401 needs no round trip to be known.
  if (door.pairing !== null && door.pairing.removed) {
    return { ok: false, error: removedRoomError() };
  }
  // The request line names the saved address, or the iroh stand-in for a
  // pairing that saved none — a road this phone may no longer have, which
  // reads as an unusable door before anything dials. The iroh code maps
  // to its sentence here: no raw code crosses to a caller.
  const resolved = doorRequestBase(door);
  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        code: "door_unusable",
        message:
          resolved.error === "remote_brain_iroh_missing"
            ? IROH_MISSING_MESSAGE
            : resolved.error,
      },
    };
  }
  const gate = remoteUrlGateError(resolved.base);
  if (gate !== null) return { ok: false, error: { code: "door_unusable", message: gate } };
  const token = await getRemoteDoorToken(door);
  if (token === null && isNonLoopback(resolved.base)) {
    return {
      ok: false,
      error: { code: "door_unusable", message: "remote_brain_token_required" },
    };
  }
  return {
    ok: true,
    value: { door, localId: door.pairing?.localId ?? null, token, base: resolved.base },
  };
}

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
    const resolved = await roomDoorForCall(options?.roomLocalId);
    if (!resolved.ok) return { result: refused(resolved.error), localId: null };
    const { door, localId, token, base } = resolved.value;
    const road = await establishDoorRoad(door, options?.signal);
    const fetcher = doorFetchFor(road);
    const url = joinRemoteApiUrl(base, path) + (query.length > 0 ? `?${query.join("&")}` : "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (encodedBody !== undefined) headers["Content-Type"] = "application/json";
    if (token !== null && canSendAuthorization(url)) headers.Authorization = `Bearer ${token}`;
    if (localId !== null) {
      const epoch = cachedRoomEpoch(localId);
      if (epoch !== null) headers["Kalsa-Room-Epoch"] = epoch;
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
        // record survives, only its bearer is retired for this room. The
        // epoch goes with it: a pairing nobody may call again sends nothing.
        forgetRoomEpoch(localId);
        try {
          await markPairingRemoved(localId);
        } catch {
          // The next 401 marks again; an unreadable map is its own error.
        }
      }
      if (localId !== null && error.code === "epoch_changed") {
        forgetRoomEpoch(localId);
      }
      return { result: refused(error), localId };
    }
    try {
      return { result: { ok: true, value: await response.json() }, localId };
    } catch {
      return { result: refused(malformedRoomResponse()), localId };
    }
  } catch (error) {
    // The store's own verdict stays its own: the UI must be able to say a
    // damaged pairing store is what stands between it and the room.
    if (isPairingStoreDamaged(error)) {
      return {
        result: refused({
          code: "pairing_store_damaged",
          message: "The pairing store on this phone is damaged.",
        }),
        localId: null,
      };
    }
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
    noteRoomEpoch(localId, info.epoch);
    try {
      const dropped = await bindPairingRoom(localId, info.roomId);
      // A record superseded while its epoch sat in the cache (this one or
      // an older one the bind lost the room to) never sends that epoch.
      for (const superseded of dropped) forgetRoomEpoch(superseded);
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
