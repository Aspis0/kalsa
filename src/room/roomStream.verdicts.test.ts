/**
 * The stream's terminal verdicts: 401 marks the pairing removed and ends
 * the stream for good; a record that is gone or already refused never
 * dials at all; 404 not_found is a typed error with no retry; 500 is no
 * verdict — it comes back through the backoff.
 *
 * Status shapes: 401 an empty body (§1), not_found (mod.rs:72 via
 * mod.rs:195), internal (answers.rs:69 via mod.rs:135).
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

import { establishDoorRoad } from "../remote/doorRoad";
import {
  bindPairingRoom,
  getPairing,
  getPairingCredential,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { FakeRoomXhr, installFakeRoomXhr } from "../../test-support/fakeRoomXhr";
import { cachedRoomEpoch, noteRoomEpoch, resetRoomEpochs } from "./roomEpochs";
import { openRoomStream, type RoomStreamEvent } from "./roomStream";

const CREDENTIAL = "ab".repeat(32);
const EPOCH = "epoch-one";

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

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  installFakeRoomXhr();
  resetRoomEpochs();
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

test("401 marks the pairing removed, forgets the epoch, and never redials", async () => {
  const localId = "p-lid-401";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  noteRoomEpoch(localId, EPOCH);
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(401); // the door's refusal is an empty body (§1)
  first.end();
  await settle();

  expect(markPairingRemoved).toHaveBeenCalledWith(localId);
  expect(cachedRoomEpoch(localId)).toBeNull();
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

test("404 not_found is terminal: the door's sentence as a typed error, no retry", async () => {
  const localId = "p-lid-404";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(404);
  first.chunk(errorBody("not_found", "The door does not serve that room route."));
  first.end();
  await settle();

  expect(events[events.length - 1]).toEqual({
    type: "error",
    code: "not_found",
    message: "The door does not serve that room route.",
  });
  await jest.advanceTimersByTimeAsync(120_000);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(1);
  handle.close();
});

test("500 internal is no verdict: it retries through the backoff", async () => {
  const localId = "p-lid-500";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(localId, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(500);
  first.chunk(errorBody("internal", "The room's store failed on disk."));
  first.end();
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(1); // no hot retry
  expect(events.some((event) => event.type === "error")).toBe(false);

  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2); // and a retry at the backoff's floor
  handle.close();
});

test("503 no_room retries with the same backoff — the room may yet open", async () => {
  const localId = "p-lid-503";
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(pairingRecord(localId));
  const handle = openRoomStream(localId, () => undefined);
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(503);
  first.chunk(errorBody("no_room", "The room is not open on this computer."));
  first.end();
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(1);

  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2);
  handle.close();
});
