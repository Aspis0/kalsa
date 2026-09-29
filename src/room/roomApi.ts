/**
 * The typed room client: info, history, post and name (§3–§6) over the
 * door chat already rides — same bearer, same one-road-per-operation
 * decision (iroh `door` lane or HTTPS), same fetch. Every refusal comes
 * back as a typed RoomResult; no route here talks SSE.
 */
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import {
  canSendAuthorization,
  isNonLoopback,
  joinRemoteApiUrl,
  remoteUrlGateError,
} from "../engine/remote/remoteUrl";
import { adoptActivePairing } from "../pairing/roomPairingStore";
import { doorFetchFor, establishDoorRoad } from "../remote/doorRoad";
import { checkClientMsgId, checkHistoryLimit, checkRoomName, checkRoomText } from "./roomBounds";
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

/** One route call: door, bearer, road, request, status → typed result. */
async function roomRequest(
  method: string,
  path: string,
  query: readonly string[],
  body: unknown,
  options?: RoomCallOptions,
): Promise<RoomResult<unknown>> {
  try {
    const door = await getRemoteDoorConfig();
    const gate = remoteUrlGateError(door.url);
    if (gate !== null) return refused({ code: "door_unusable", message: gate });
    const token = await getRemoteDoorToken(door);
    if (token === null && isNonLoopback(door.url)) {
      return refused({ code: "door_unusable", message: "remote_brain_token_required" });
    }
    const road = await establishDoorRoad(door, options?.signal);
    const fetcher = doorFetchFor(road);
    const url = joinRemoteApiUrl(door.url, path) + (query.length > 0 ? `?${query.join("&")}` : "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token !== null && canSendAuthorization(url)) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) {
      return refused(roomErrorFromResponse(response.status, await readErrorBody(response)));
    }
    try {
      return { ok: true, value: await response.json() };
    } catch {
      return refused(malformedRoomResponse());
    }
  } catch (error) {
    return refused({ code: "unreachable", message: transportMessage(error) });
  }
}

function parsed<T>(value: unknown, parse: (body: unknown) => T | null): RoomResult<T> {
  const result = parse(value);
  return result === null ? refused(malformedRoomResponse()) : { ok: true, value: result };
}

/** §3 room info. The first successful answer names the room this phone's
 *  active pairing belongs to, and adoption happens before the caller sees
 *  the result — a failed stamp is retried by the next info, never by
 *  failing a read that already succeeded. */
export async function fetchRoomInfo(options?: RoomCallOptions): Promise<RoomResult<RoomInfo>> {
  const response = await roomRequest("GET", "/kalsa/room/info", [], undefined, options);
  if (!response.ok) return response;
  const info = parseRoomInfo(response.value);
  if (info === null) return refused(malformedRoomResponse());
  try {
    await adoptActivePairing(info.roomId);
  } catch {
    // The read stands; adoption is idempotent and retries on the next info.
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
  const response = await roomRequest("GET", "/kalsa/room/history", params, undefined, options);
  if (!response.ok) return response;
  return parsed(response.value, parseRoomHistoryPage);
}

/** §5 post: the id makes a retry of the same content idempotent. */
export async function postRoomMessage(
  message: { clientMsgId: string; text: string; callAi?: boolean },
  options?: RoomCallOptions,
): Promise<RoomResult<RoomPostAck>> {
  const invalid = checkClientMsgId(message.clientMsgId) ?? checkRoomText(message.text);
  if (invalid !== null) return refused(invalid);
  const response = await roomRequest(
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
  if (!response.ok) return response;
  return parsed(response.value, parseRoomPostAck);
}

/** §6 set my name; the computer trims and judges it, this only bounds it. */
export async function putRoomName(
  name: string,
  options?: RoomCallOptions,
): Promise<RoomResult<RoomNameAck>> {
  const invalid = checkRoomName(name);
  if (invalid !== null) return refused(invalid);
  const response = await roomRequest("PUT", "/kalsa/room/name", [], { name }, options);
  if (!response.ok) return response;
  return parsed(response.value, parseRoomNameAck);
}
