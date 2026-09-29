/**
 * §9's refusals as typed results: every error body a route can legally
 * receive, plus the two answers no P2 route can produce (too_large and
 * bad_cursor come from bounds the phone checks itself and from the SSE
 * route) — the mapper still owes them a typed shape.
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../engine/remote/remoteDoorConfig", () => ({
  getRemoteDoorConfig: jest.fn(),
  getRemoteDoorToken: jest.fn(),
}));
jest.mock("../pairing/roomPairingStore", () => ({ adoptActivePairing: jest.fn() }));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { roomErrorFromResponse } from "./roomError";
import { fetchRoomHistory, fetchRoomInfo, postRoomMessage, putRoomName } from "./roomApi";
import errorBadRequestFixture from "./fixtures/errorBadRequest.json";
import errorBadCursorFixture from "./fixtures/errorBadCursor.json";
import errorMsgIdReusedFixture from "./fixtures/errorMsgIdReused.json";
import errorNameTakenFixture from "./fixtures/errorNameTaken.json";
import errorTooLargeFixture from "./fixtures/errorTooLarge.json";
import infoFixture from "./fixtures/info.json";

const CREDENTIAL = "ab".repeat(32);
const EMPTY_BODY = Symbol("empty body");

function installDoor(status: number, body: unknown) {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => ({
    ok: status >= 200 && status < 300,
    status,
    isBodyEmpty: async () => body === EMPTY_BODY,
    json: async () => {
      if (body === EMPTY_BODY) throw new Error("body is empty");
      return body;
    },
  }));
  (getRemoteDoorConfig as jest.MockedFunction<typeof getRemoteDoorConfig>).mockResolvedValue({
    url: "https://desk.example",
    pairedCredential: CREDENTIAL,
    node: null,
    pairedVia: null,
    source: "pairing",
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

test("400 bad_request carries the computer's sentence", async () => {
  installDoor(400, errorBadRequestFixture);

  await expect(fetchRoomHistory({ after: 41, before: 42 })).resolves.toEqual({
    ok: false,
    error: { code: "bad_request", message: "after and before cannot be combined" },
  });
});

test("401 with its empty body means removed from this room", async () => {
  installDoor(401, EMPTY_BODY);

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "removed", message: "This phone is no longer a member of the room." },
  });
});

test("409 name_taken keeps its code and sentence", async () => {
  installDoor(409, errorNameTakenFixture);

  await expect(putRoomName("Kalsa")).resolves.toEqual({
    ok: false,
    error: { code: "name_taken", message: "That name is already taken." },
  });
});

test("409 client_msg_id_reused keeps its code and sentence", async () => {
  installDoor(409, errorMsgIdReusedFixture);

  await expect(
    postRoomMessage({ clientMsgId: "b3f1c2", text: "different text" }),
  ).resolves.toEqual({
    ok: false,
    error: { code: "client_msg_id_reused", message: "This id already carries a different message." },
  });
});

test("a 409 code this client does not know yet stays typed, sentence and all", async () => {
  installDoor(409, { error: { code: "name_expired", message: "The room restarted its roster." } });

  await expect(putRoomName("Marco")).resolves.toEqual({
    ok: false,
    error: { code: "unexpected", message: "The room restarted its roster." },
  });
});

test("a failure the contract never names maps by its status", async () => {
  installDoor(500, EMPTY_BODY);

  await expect(fetchRoomHistory({})).resolves.toEqual({
    ok: false,
    error: { code: "unexpected", message: "unexpected room response (HTTP 500)" },
  });
});

test("a 2xx answer the contract never promised is malformed, not half-read", async () => {
  installDoor(200, { room_name: 5 });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "malformed_response", message: "The room's answer did not match the protocol." },
  });
});

test("413 too_large: the mapper owes it a shape no P2 route can provoke", () => {
  expect(roomErrorFromResponse(413, errorTooLargeFixture)).toEqual({
    code: "too_large",
    message: "Message text exceeds 8000 bytes.",
  });
});

test("400 bad_cursor: the SSE route's refusal is mapped for P3", () => {
  expect(roomErrorFromResponse(400, errorBadCursorFixture)).toEqual({
    code: "bad_cursor",
    message: "Last-Event-ID claims events that never happened.",
  });
});
