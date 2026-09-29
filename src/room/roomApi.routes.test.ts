/**
 * The four room routes over a fake door: URL, method, headers, body and
 * the typed success each one parses — plus the adoption that info's first
 * successful answer triggers.
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../engine/remote/remoteDoorConfig", () => ({
  getRemoteDoorConfig: jest.fn(),
  getRemoteDoorToken: jest.fn(),
}));
jest.mock("../pairing/roomPairingStore", () => ({ adoptActivePairing: jest.fn() }));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { adoptActivePairing } from "../pairing/roomPairingStore";
import { fetchRoomHistory, fetchRoomInfo, postRoomMessage, putRoomName } from "./roomApi";
import infoFixture from "./fixtures/info.json";
import historyFixture from "./fixtures/history.json";
import nameFixture from "./fixtures/name.json";
import postQueuedFixture from "./fixtures/postQueued.json";
import postRefusedFixture from "./fixtures/postRefused.json";

const CREDENTIAL = "ab".repeat(32);

function installDoor(status: number, body: unknown) {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => ({
    ok: status >= 200 && status < 300,
    status,
    isBodyEmpty: async () => false,
    json: async () => body,
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

test("info: bearer on the wire, room adopted, the answer typed", async () => {
  const fetcher = installDoor(200, infoFixture);
  const controller = new AbortController();

  const result = await fetchRoomInfo({ signal: controller.signal });

  expect(result).toEqual({
    ok: true,
    value: {
      roomName: "This computer",
      members: [
        { memberId: 4294967295, name: "This computer", kind: "host" },
        { memberId: 3, name: "Paired phone 2", kind: "phone" },
        { memberId: 4294967294, name: "Kalsa", kind: "ai" },
      ],
      ai: { busy: false, running: null, queue: [], youPending: false },
      you: 3,
      roomId: "7c1f0e5a9b3d4c28",
      transcriptEpoch: 4,
    },
  });
  expect(adoptActivePairing).toHaveBeenCalledWith("7c1f0e5a9b3d4c28");
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://desk.example/kalsa/room/info");
  expect(init.method).toBe("GET");
  expect(init.headers).toEqual({
    Accept: "application/json",
    Authorization: `Bearer ${CREDENTIAL}`,
  });
  expect(init.body).toBeUndefined();
  expect(init.signal).toBe(controller.signal);
  expect(establishDoorRoad).toHaveBeenCalledWith(
    expect.objectContaining({ url: "https://desk.example" }),
    controller.signal,
  );
});

test("info: an epoch the computer names as a string reads the same", async () => {
  installDoor(200, { ...infoFixture, transcript_epoch: "e-17" });

  const result = await fetchRoomInfo();

  expect(result).toMatchObject({ ok: true, value: { transcriptEpoch: "e-17" } });
});

test("info: a failed adoption never fails a read that succeeded", async () => {
  installDoor(200, infoFixture);
  (adoptActivePairing as jest.MockedFunction<typeof adoptActivePairing>).mockRejectedValue(
    new Error("secure store unavailable"),
  );

  const result = await fetchRoomInfo();

  expect(result).toMatchObject({ ok: true, value: { roomId: "7c1f0e5a9b3d4c28" } });
});

test("history: cursors and limit ride the query, the page comes back typed", async () => {
  const fetcher = installDoor(200, historyFixture);

  const result = await fetchRoomHistory({ after: 41, limit: 50 });

  expect(result).toEqual({
    ok: true,
    value: {
      messages: [
        {
          seq: 41,
          memberId: 3,
          name: "Marco",
          time: 1791000000,
          text: "dinner at eight?",
          callAi: false,
        },
        {
          seq: 42,
          memberId: 4294967294,
          name: "Kalsa",
          time: 1791000017,
          text: "Dinner is at eight.",
          callAi: true,
        },
      ],
      hasOlder: true,
      hasNewer: false,
    },
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://desk.example/kalsa/room/history?after=41&limit=50");
  expect(init.method).toBe("GET");
  expect(init.body).toBeUndefined();
});

test("history: no cursor asks for the newest page, limit left to the computer", async () => {
  const fetcher = installDoor(200, historyFixture);

  const result = await fetchRoomHistory({});

  expect(result.ok).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe("https://desk.example/kalsa/room/history");
});

test("post: id, text and flag go out; the queued ack comes back typed", async () => {
  const fetcher = installDoor(200, postQueuedFixture);

  const result = await postRoomMessage({
    clientMsgId: "b3f1c2",
    text: "@Kalsa what time is it?",
    callAi: true,
  });

  expect(result).toEqual({
    ok: true,
    value: { seq: 42, time: 1791000017, aiCall: "queued", refusal: null },
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://desk.example/kalsa/room/messages");
  expect(init.method).toBe("POST");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(init.body as string)).toEqual({
    client_msg_id: "b3f1c2",
    text: "@Kalsa what time is it?",
    call_ai: true,
  });
});

test("post: a refused call still posts the message with its honest sentence", async () => {
  const fetcher = installDoor(200, postRefusedFixture);

  const result = await postRoomMessage({ clientMsgId: "b3f1c2", text: "ping" });

  expect(result).toEqual({
    ok: true,
    value: { seq: 43, time: 1791000018, aiCall: "refused", refusal: "You already have a call pending." },
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
    client_msg_id: "b3f1c2",
    text: "ping",
    call_ai: false,
  });
});

test("name: the raw name goes out and the ack comes back typed", async () => {
  const fetcher = installDoor(200, nameFixture);

  const result = await putRoomName("Marco");

  expect(result).toEqual({ ok: true, value: { memberId: 3, name: "Marco" } });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://desk.example/kalsa/room/name");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body as string)).toEqual({ name: "Marco" });
});
