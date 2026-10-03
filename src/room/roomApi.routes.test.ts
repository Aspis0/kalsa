/**
 * The four room routes over a fake door: URL, method, headers, body and
 * the typed success each parses — plus what a successful info owes the
 * store (a bind under the local id that made the call) and the epoch
 * every later route sends once one is known.
 *
 * Fixture provenance — every field traced to the contract or the door
 * (citations against kalsa-brain's working tree, HEAD c40c6a12):
 *
 * info.json — ROOM-PROTOCOL.md §3's example, verbatim. The door writes
 *   the same keys: room_name/room_id/epoch/you/members/ai at
 *   crates/kalsa-door/src/room/routes.rs:61-66; member rows at
 *   routes.rs:56-58 (the AI) and routes.rs:102-106 (entry_member); the
 *   ai object's busy/running/queue/you_pending at routes.rs:93-97 — the
 *   door also answers state/who (routes.rs:92,96), fields §1 says to
 *   ignore.
 * history.json — key set and order from the door's entry_json,
 *   answers.rs:26-33 (seq, epoch, member_id, name, time, text, call_ai),
 *   former set only for a gone author at answers.rs:34-36, page wrapper
 *   at routes.rs:173-175. Values: §4's message for the live author; the
 *   second entry is §7's message and member examples.
 * post.json — seq/time from §5's answer example; ai_call and refusal
 *   null exactly as the door answers a message that called nobody
 *   (routes.rs:210-212, shape at routes.rs:225).
 * postQueued.json — seq/time from §5's answer example; "queued" and a
 *   null refusal from the door's Queued branch (routes.rs:215, the same
 *   shape at routes.rs:225).
 * postRefused.json — seq/time next in §5's numbering; "refused" and the
 *   refusal token "already_pending" from routes.rs:220 (shape:225).
 * name.json — §6's answer example, the same keys as routes.rs:263.
 */
// The establishment is mocked; the road decision (`pairedIrohRoad`)
// stays real — doorRequestBase and establishDoorRoad must read one verdict.
jest.mock("../remote/doorRoad", () => ({
  ...jest.requireActual("../remote/doorRoad"),
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));
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
import { bindPairingRoom } from "../pairing/pairingCredentialStore";
import { fetchRoomHistory, fetchRoomInfo, postRoomMessage, putRoomName } from "./roomApi";
import historyFixture from "./fixtures/history.json";
import infoFixture from "./fixtures/info.json";
import nameFixture from "./fixtures/name.json";
import postFixture from "./fixtures/post.json";
import postQueuedFixture from "./fixtures/postQueued.json";
import postRefusedFixture from "./fixtures/postRefused.json";

const CREDENTIAL = "ab".repeat(32);
const EPOCH = "8a7b6c5d4e3f20112233445566778899";

function installDoor(status: number, body: unknown, localId: string | null = "p-lid-routes") {
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
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockResolvedValue([]);
});

test("info: bearer on the wire, the room bound under the calling record, no epoch header yet", async () => {
  const fetcher = installDoor(200, infoFixture, "p-lid-first-info");
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
      roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
      epoch: EPOCH,
    },
  });
  expect(bindPairingRoom).toHaveBeenCalledWith(
    "p-lid-first-info",
    "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
  );
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://desk.example/kalsa/room/info");
  expect(init.method).toBe("GET");
  expect(init.headers).toEqual({
    Accept: "application/json",
    Authorization: `Bearer ${CREDENTIAL}`,
  });
  expect(init.signal).toBe(controller.signal);
  expect(establishDoorRoad).toHaveBeenCalledWith(
    expect.objectContaining({ url: "https://desk.example" }),
    controller.signal,
  );
});

test("info: the door's extra ai fields and an entry's extra read count are ignored, per §1", async () => {
  installDoor(200, {
    ...infoFixture,
    ai: { state: "idle", busy: false, running: null, queue: [], who: null, you_pending: false },
  });

  const first = await fetchRoomInfo();
  expect(first).toMatchObject({ ok: true, value: { ai: { busy: false, youPending: false } } });

  installDoor(200, {
    ...historyFixture,
    messages: [{ ...historyFixture.messages[0], read: 12 }],
  });
  const page = await fetchRoomHistory({});
  expect(page).toMatchObject({ ok: true, value: { messages: [{ seq: 41, former: false }] } });
});

test("history: cursors and limit ride the query, the page comes back typed with epoch and former", async () => {
  const fetcher = installDoor(200, historyFixture);

  const result = await fetchRoomHistory({ after: 41, limit: 50 });

  expect(result).toEqual({
    ok: true,
    value: {
      messages: [
        {
          seq: 41,
          epoch: EPOCH,
          memberId: 3,
          name: "Marco",
          time: 1791000000,
          text: "dinner at eight?",
          callAi: false,
          former: false,
        },
        {
          seq: 42,
          epoch: EPOCH,
          memberId: 5,
          name: "Paired phone 3",
          time: 1791000017,
          text: "@Kalsa hi",
          callAi: true,
          former: true,
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

test("post: id, text and flag go out; the null-ai_call ack comes back typed", async () => {
  const fetcher = installDoor(200, postFixture);

  const result = await postRoomMessage({
    clientMsgId: "b3f1c2",
    text: "@Kalsa what time is it?",
    callAi: true,
  });

  expect(result).toEqual({
    ok: true,
    value: { seq: 42, time: 1791000017, aiCall: null, refusal: null },
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

test("post: queued and refused answers are typed as the door writes them", async () => {
  installDoor(200, postQueuedFixture);
  await expect(
    postRoomMessage({ clientMsgId: "b3f1c3", text: "hi" }),
  ).resolves.toEqual({ ok: true, value: { seq: 42, time: 1791000017, aiCall: "queued", refusal: null } });

  installDoor(200, postRefusedFixture);
  await expect(
    postRoomMessage({ clientMsgId: "b3f1c4", text: "hi again" }),
  ).resolves.toEqual({
    ok: true,
    value: { seq: 43, time: 1791000018, aiCall: "refused", refusal: "already_pending" },
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

test("the epoch: cached from info, sent on every route, dropped on 409, silent until refetched", async () => {
  const fetcher = installDoor(200, historyFixture, "p-lid-epoch-flow");
  const epochInfo = { ...infoFixture, epoch: "epoch-one" };

  // Nothing cached: the first reads go out bare.
  await fetchRoomHistory({});
  expect(fetcher.mock.calls[0][1].headers["Kalsa-Room-Epoch"]).toBeUndefined();

  // info names the epoch for this pairing.
  const fetcherForInfo = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => ({
    ok: true,
    status: 200,
    isBodyEmpty: async () => false,
    json: async () => epochInfo,
  }));
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcherForInfo);
  await fetchRoomInfo();

  // Every later route sends the cached epoch.
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  await fetchRoomHistory({});
  await postRoomMessage({ clientMsgId: "b3f1c2", text: "hello" });
  expect(fetcher.mock.calls[1][1].headers["Kalsa-Room-Epoch"]).toBe("epoch-one");
  expect(fetcher.mock.calls[2][1].headers["Kalsa-Room-Epoch"]).toBe("epoch-one");

  // A 409 epoch_changed drops the cache: the next call goes out bare.
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(
    jest.fn(async () => ({
      ok: false,
      status: 409,
      isBodyEmpty: async () => false,
      json: async () => ({
        error: {
          code: "epoch_changed",
          message: "The room's transcript restarted; drop what was cached and read it again.",
        },
      }),
    })) as unknown as DoorFetch,
  );
  const resync = await fetchRoomHistory({});
  expect(resync).toMatchObject({ ok: false, error: { code: "epoch_changed" } });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  await fetchRoomHistory({});
  expect(fetcher.mock.calls.at(-1)?.[1].headers["Kalsa-Room-Epoch"]).toBeUndefined();
});

test("a record superseded while its epoch sat cached stops sending that epoch", async () => {
  const fetcher = installDoor(200, infoFixture, "p-lid-supersede");

  await fetchRoomInfo();
  await fetchRoomHistory({});
  expect(fetcher.mock.calls[1][1].headers["Kalsa-Room-Epoch"]).toBe(infoFixture.epoch);

  // The next bind files the room under a newer pairing and reports THIS record dropped.
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockResolvedValue([
    "p-lid-supersede",
  ]);
  await fetchRoomInfo();
  await fetchRoomHistory({});

  expect(fetcher.mock.calls[3][1].headers["Kalsa-Room-Epoch"]).toBeUndefined();
});

test("a bind that fails never fails a read that succeeded", async () => {
  installDoor(200, infoFixture, "p-lid-bindfail");
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockRejectedValue(
    new Error("pairing map damaged"),
  );

  const result = await fetchRoomInfo();

  expect(result).toMatchObject({ ok: true, value: { roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8" } });
});

test("a manual door reads rooms too, but binds nothing: it owns no record", async () => {
  const fetcher = installDoor(200, infoFixture, null);

  const result = await fetchRoomInfo();

  expect(result.ok).toBe(true);
  expect(bindPairingRoom).not.toHaveBeenCalled();
  expect(fetcher.mock.calls[0][1].headers["Kalsa-Room-Epoch"]).toBeUndefined();
});
