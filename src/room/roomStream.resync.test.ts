/**
 * What the stream does with the room's verdicts: a response epoch that
 * disagrees with the cache, a 409 epoch_changed, a 400 bad_cursor and a
 * live entry from another epoch all mean one thing — resync (drop the
 * epoch, refetch info + history, reopen on the new floor); a401 marks
 * the pairing removed and ends the stream for good; a record that is
 * gone or already refused never dials at all.
 *
 * Frame and status shapes: the numbered frame from stream.rs:316-324,
 * the head/epoch header from stream.rs:232-237, and §9's error bodies —
 * epoch_changed (mod.rs:126-127), bad_cursor (mod.rs:77 via
 * stream.rs:136), 401 an empty body (§1).
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
  getPairing: jest.fn(),
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));
jest.mock("../engine/remote/remoteSecret", () => ({ getRemoteBrainToken: jest.fn() }));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import {
  bindPairingRoom,
  getPairing,
  getPairingCredential,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { FakeRoomXhr, installFakeRoomXhr } from "./fakeRoomXhr";
import infoFixture from "./fixtures/info.json";
import { noteRoomEpoch } from "./roomEpochs";
import { openRoomStream, type RoomStreamEvent } from "./roomStream";

const CREDENTIAL = "ab".repeat(32);
const EPOCH_ONE = "epoch-one";
const EPOCH_TWO = "epoch-two";

type RecordOf = Awaited<ReturnType<typeof getPairing>>;

function pairingRecord(localId: string, extra: Partial<NonNullable<RecordOf>> = {}) {
  return {
    localId,
    credential: CREDENTIAL,
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
    ...extra,
  };
}

function entryFrame(seq: number, epoch: string): string {
  const entry = {
    seq,
    epoch,
    member_id: 3,
    name: "Marco",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  };
  return `id: ${seq}\nevent: message\ndata: ${JSON.stringify(entry)}\n\n`;
}

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

/** The JSON side of a refetch: info at the given epoch, a history page
 *  whose newest seq is the resume floor. */
function serveRefetch(epoch: string, pageFloor: number): jest.Mock {
  const fetcher = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    isBodyEmpty: async () => false,
    json: async () => {
      if (url.includes("/history")) {
        return {
          messages: pageFloor === 0 ? [] : [entryFramePayload(pageFloor - 1, epoch), entryFramePayload(pageFloor, epoch)],
          has_older: pageFloor > 0,
          has_newer: false,
        };
      }
      return { ...infoFixture, epoch };
    },
  }));
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

function entryFramePayload(seq: number, epoch: string) {
  return {
    seq,
    epoch,
    member_id: 3,
    name: "Marco",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  installFakeRoomXhr();
  jest.resetAllMocks();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(
    pairingRecord("p-lid-default"),
  );
  (getPairingCredential as jest.MockedFunction<typeof getPairingCredential>).mockResolvedValue(null);
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockResolvedValue([]);
  (markPairingRemoved as jest.MockedFunction<typeof markPairingRemoved>).mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  randomSpy.mockRestore();
  jest.useRealTimers();
});

test("a response epoch the cache disagrees with: resync, then reopen on the new epoch's floor", async () => {
  const localId = "p-lid-header-mismatch";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  serveRefetch(EPOCH_TWO, 42);
  noteRoomEpoch(localId, EPOCH_ONE); // what this phone cached last time
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  expect(first.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH_ONE);
  first.head(200, { "Kalsa-Room-Epoch": EPOCH_TWO });
  await settle();

  expect(first.aborted).toBe(true);
  expect(events).toEqual([
    { type: "resynced", info: expect.objectContaining({ epoch: EPOCH_TWO }), history: expect.objectContaining({ messages: [expect.objectContaining({ seq: 41 }), expect.objectContaining({ seq: 42 })] }) },
  ]);
  const second = FakeRoomXhr.latest();
  expect(second).not.toBe(first);
  expect(second.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH_TWO);
  expect(second.requestHeaders["Last-Event-ID"]).toBe("42");
  handle.close();
});

test("409 epoch_changed is the same resync: refetch, reopen, no backoff wait", async () => {
  const localId = "p-lid-409";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  serveRefetch(EPOCH_TWO, 42);
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(409);
  first.chunk(errorBody("epoch_changed", "The room's transcript restarted; drop what was cached and read it again."));
  first.end();
  await settle(); // cycle runs at once: the door already answered

  expect(events.filter((event) => event.type === "resynced")).toHaveLength(1);
  const second = FakeRoomXhr.latest();
  expect(second).not.toBe(first);
  expect(second.requestHeaders["Last-Event-ID"]).toBe("42");
  expect(second.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH_TWO);
  handle.close();
});

test("400 bad_cursor resyncs too — the floor drops to the page's newest seq", async () => {
  const localId = "p-lid-bad-cursor";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  serveRefetch(EPOCH_ONE, 42);
  noteRoomEpoch(localId, EPOCH_ONE);
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(400);
  first.chunk(errorBody("bad_cursor", "The room resumes from a numeric Last-Event-ID."));
  first.end();
  await settle();

  expect(events.filter((event) => event.type === "resynced")).toHaveLength(1);
  const second = FakeRoomXhr.latest();
  expect(second.requestHeaders["Last-Event-ID"]).toBe("42");
  // Same epoch: the header was never dropped, only the cursor corrected.
  expect(second.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH_ONE);
  handle.close();
});

test("an entry from another epoch under a live stream resyncs mid-flight", async () => {
  const localId = "p-lid-live-epoch";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  serveRefetch(EPOCH_TWO, 42);
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(200, { "Kalsa-Room-Epoch": EPOCH_ONE });
  first.chunk(entryFrame(1, EPOCH_ONE));
  first.chunk(entryFrame(2, EPOCH_TWO)); // a recovery ran while we watched
  await settle();

  expect(events.filter((event) => event.type === "message")).toHaveLength(1);
  expect(events.filter((event) => event.type === "resynced")).toHaveLength(1);
  expect(FakeRoomXhr.instances.length).toBe(2);
  handle.close();
});

test("401 marks the pairing removed, tells the listener, and never redials", async () => {
  const localId = "p-lid-401";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  serveRefetch(EPOCH_ONE, 0);
  noteRoomEpoch(localId, EPOCH_ONE);
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(401); // the door's refusal is an empty body (§1)
  first.end();
  await settle();

  expect(markPairingRemoved).toHaveBeenCalledWith(localId);
  expect(events).toEqual([{ type: "removed" }]);
  await jest.advanceTimersByTimeAsync(120_000);
  expect(FakeRoomXhr.instances).toHaveLength(1);
  handle.close();
});

test("a record the store no longer holds is removed without ever dialling", async () => {
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(null);
  const events: RoomStreamEvent[] = [];

  const handle = openRoomStream("p-lid-gone", (event) => events.push(event));
  await settle();

  expect(events).toEqual([{ type: "removed" }]);
  expect(FakeRoomXhr.instances).toHaveLength(0);
  expect(establishDoorRoad).not.toHaveBeenCalled();
  handle.close();
});

test("a record this room already refused is removed without ever dialling", async () => {
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(
    pairingRecord("p-lid-refused", { removed: true }),
  );
  const events: RoomStreamEvent[] = [];

  const handle = openRoomStream("p-lid-refused", (event) => events.push(event));
  await settle();

  expect(events).toEqual([{ type: "removed" }]);
  expect(FakeRoomXhr.instances).toHaveLength(0);
  handle.close();
});
