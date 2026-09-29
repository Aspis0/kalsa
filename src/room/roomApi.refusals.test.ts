/**
 * §9's refusals as typed results: every error the door can answer,
 * traced to the line that produces it, plus the resync signal and the
 * one promise no result may break — a credential never appears in a
 * message.
 *
 * Error fixture provenance (message strings are the door's own):
 *
 * errorBadRequest.json  mod.rs:74 BAD_QUERY, emitted for after+before at
 *                       routes.rs:151-152
 * errorNameTaken.json   names.rs:45 (NameError::Taken), routes.rs:272
 * errorMsgIdReused.json room.rs:51 (PostError::ClientIdReused),
 *                       routes.rs:236
 * errorTooLarge.json    room.rs:48 (PostError::TextTooLong), routes.rs:235
 * errorEpochChanged.json mod.rs:126-127 (the epoch guard on every route)
 * errorNoRoom.json      mod.rs:71 NO_ROOM, mod.rs:110
 * errorReadOnly.json    room.rs:55 (PostError::ReadOnly), routes.rs:237
 * errorNotFound.json    mod.rs:72 UNKNOWN_ROUTE, mod.rs:195
 * errorInternal.json    answers.rs:69 store_failed, mod.rs:135
 * errorBadCursor.json   mod.rs:77 BAD_LAST_EVENT_ID, emitted stream.rs:136
 * 401                    an empty body, §1
 *
 * too_large and bad_cursor are mapped directly: once the local bounds
 * and the encoded-body check have run, no P2 route can provoke them.
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../engine/remote/remoteDoorConfig", () => ({
  getRemoteDoorConfig: jest.fn(),
  getRemoteDoorToken: jest.fn(),
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { markPairingRemoved } from "../pairing/pairingCredentialStore";
import { requiresRoomResync, roomErrorFromResponse } from "./roomError";
import { fetchRoomHistory, fetchRoomInfo, postRoomMessage, putRoomName } from "./roomApi";
import errorBadRequestFixture from "./fixtures/errorBadRequest.json";
import errorBadCursorFixture from "./fixtures/errorBadCursor.json";
import errorEpochChangedFixture from "./fixtures/errorEpochChanged.json";
import errorMsgIdReusedFixture from "./fixtures/errorMsgIdReused.json";
import errorInternalFixture from "./fixtures/errorInternal.json";
import errorNameTakenFixture from "./fixtures/errorNameTaken.json";
import errorNoRoomFixture from "./fixtures/errorNoRoom.json";
import errorNotFoundFixture from "./fixtures/errorNotFound.json";
import errorReadOnlyFixture from "./fixtures/errorReadOnly.json";
import errorTooLargeFixture from "./fixtures/errorTooLarge.json";
import infoFixture from "./fixtures/info.json";

const CREDENTIAL = "ab".repeat(32);
const EMPTY_BODY = Symbol("empty body");

type DoorSetup = {
  status: number;
  body: unknown;
  localId?: string | null;
  source?: "pairing" | "manual";
};

function installDoor(setup: DoorSetup) {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => ({
    ok: setup.status >= 200 && setup.status < 300,
    status: setup.status,
    isBodyEmpty: async () => setup.body === EMPTY_BODY,
    json: async () => {
      if (setup.body === EMPTY_BODY) throw new Error("body is empty");
      return setup.body;
    },
  }));
  const localId = setup.localId === undefined ? "p-lid-refusals" : setup.localId;
  (getRemoteDoorConfig as jest.MockedFunction<typeof getRemoteDoorConfig>).mockResolvedValue({
    url: "https://desk.example",
    pairedCredential: CREDENTIAL,
    node: null,
    pairedVia: null,
    source: setup.source ?? "pairing",
    pairing: localId === null ? null : { localId, removed: false },
  });
  (getRemoteDoorToken as jest.MockedFunction<typeof getRemoteDoorToken>).mockResolvedValue(
    CREDENTIAL,
  );
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

beforeEach(() => {
  jest.resetAllMocks();
});

test("400 bad_request carries the door's sentence", async () => {
  installDoor({ status: 400, body: errorBadRequestFixture });

  await expect(fetchRoomHistory({ after: 41, before: 42 })).resolves.toEqual({
    ok: false,
    error: { code: "bad_request", message: "The room reads after, before and limit as plain numbers." },
  });
});

test("401 with its empty body means removed — and marks the calling record", async () => {
  installDoor({ status: 401, body: EMPTY_BODY });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "removed", message: "This phone is no longer a member of the room." },
  });
  expect(markPairingRemoved).toHaveBeenCalledWith("p-lid-refusals");
});

test("401 on a manual door is still removed, but there is no record to mark", async () => {
  installDoor({ status: 401, body: EMPTY_BODY, localId: null, source: "manual" });

  await expect(fetchRoomInfo()).resolves.toMatchObject({ ok: false, error: { code: "removed" } });
  expect(markPairingRemoved).not.toHaveBeenCalled();
});

test("409 name_taken keeps its code and sentence", async () => {
  installDoor({ status: 409, body: errorNameTakenFixture });

  await expect(putRoomName("Kalsa")).resolves.toEqual({
    ok: false,
    error: { code: "name_taken", message: "someone in this room already wears that name" },
  });
});

test("409 client_msg_id_reused keeps its code and sentence", async () => {
  installDoor({ status: 409, body: errorMsgIdReusedFixture });

  await expect(
    postRoomMessage({ clientMsgId: "b3f1c2", text: "different text" }),
  ).resolves.toEqual({
    ok: false,
    error: {
      code: "client_msg_id_reused",
      message: "that client message id was already used for a different message",
    },
  });
});

test("409 epoch_changed is the resync signal, and it drops the cached epoch", async () => {
  installDoor({ status: 409, body: errorEpochChangedFixture });

  const result = await fetchRoomHistory({});

  expect(result).toEqual({
    ok: false,
    error: {
      code: "epoch_changed",
      message: "The room's transcript restarted; drop what was cached and read it again.",
    },
  });
  expect(requiresRoomResync(result)).toBe(true);
  expect(requiresRoomResync({ ok: true, value: infoFixture })).toBe(false);
});

test("503 no_room is the door saying this computer opens no room", async () => {
  installDoor({ status: 503, body: errorNoRoomFixture });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "no_room", message: "The room is not open on this computer." },
  });
});

test("503 read_only is a transcript under repair: posts refuse, typed", async () => {
  installDoor({ status: 503, body: errorReadOnlyFixture });

  await expect(postRoomMessage({ clientMsgId: "b3f1c2", text: "hello" })).resolves.toEqual({
    ok: false,
    error: {
      code: "read_only",
      message: "the room's transcript needs repair; posts are refused until it is reopened",
    },
  });
});

test("404 not_found is a computer that does not serve room routes at all", async () => {
  installDoor({ status: 404, body: errorNotFoundFixture });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "not_found", message: "The door does not serve that room route." },
  });
});

test("500 internal is the store's failure, and there is nothing to do about it", async () => {
  installDoor({ status: 500, body: errorInternalFixture });

  await expect(fetchRoomHistory({})).resolves.toEqual({
    ok: false,
    error: { code: "internal", message: "The room's store failed on disk." },
  });
});

test("a 409 code this client does not know yet stays typed, sentence and all", async () => {
  installDoor({ status: 409, body: { error: { code: "name_expired", message: "The room restarted its roster." } } });

  await expect(putRoomName("Marco")).resolves.toEqual({
    ok: false,
    error: { code: "unexpected", message: "The room restarted its roster." },
  });
});

test("a failure the contract never names maps by its status", async () => {
  installDoor({ status: 500, body: EMPTY_BODY });

  await expect(fetchRoomHistory({})).resolves.toEqual({
    ok: false,
    error: { code: "unexpected", message: "unexpected room response (HTTP 500)" },
  });
});

test("a 2xx answer the contract never promised is malformed, not half-read", async () => {
  installDoor({ status: 200, body: { room_name: 5 } });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "malformed_response", message: "The room's answer did not match the protocol." },
  });
});

test("413 too_large: mapped for the text bound the client now pre-checks", () => {
  expect(roomErrorFromResponse(413, errorTooLargeFixture)).toEqual({
    code: "too_large",
    message: "the message is too long",
  });
});

test("400 bad_cursor: the SSE route's refusal is mapped for P3", () => {
  expect(roomErrorFromResponse(400, errorBadCursorFixture)).toEqual({
    code: "bad_cursor",
    message: "The room resumes from a numeric Last-Event-ID.",
  });
});

test("no result the room client produces ever contains the credential", async () => {
  const results: Array<Promise<{ ok: boolean }>> = [];
  installDoor({ status: 401, body: EMPTY_BODY });
  results.push(fetchRoomInfo());
  installDoor({ status: 503, body: errorNoRoomFixture });
  results.push(fetchRoomInfo());
  installDoor({ status: 404, body: errorNotFoundFixture });
  results.push(fetchRoomInfo());
  installDoor({ status: 500, body: errorInternalFixture });
  results.push(fetchRoomHistory({}));
  installDoor({ status: 409, body: errorEpochChangedFixture });
  results.push(fetchRoomHistory({}));
  installDoor({ status: 409, body: errorNameTakenFixture });
  results.push(putRoomName("Kalsa"));
  installDoor({ status: 200, body: { room_name: 5 } });
  results.push(fetchRoomInfo());
  results.push(postRoomMessage({ clientMsgId: "", text: "x" }));
  results.push(postRoomMessage({ clientMsgId: "b3f1c2", text: "\u0000".repeat(4000) }));

  for (const result of await Promise.all(results)) {
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
  }
});
