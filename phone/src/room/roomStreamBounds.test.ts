/**
 * What a minute of a door that says no costs: the reviewer's CPU report — a
 * Room opened over a stale pairing left the JS thread at 112% — is answered
 * by counting requests, not by reading timers. Each failure shape stays in
 * single figures over 60 simulated seconds, the 401 path is asked once and
 * stops for good, and the 409 epoch loop ends itself.
 */
// The establishment is mocked; the road decision (`pairedIrohRoad`)
// stays real — doorRequestBase and establishDoorRoad must read one verdict.
jest.mock("../remote/doorRoad", () => ({
  ...jest.requireActual("../remote/doorRoad"),
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
  getPairing: jest.fn(),
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
  },
}));
jest.mock("../engine/remote/remoteSecret", () => ({ getRemoteBrainToken: jest.fn() }));

import { doorFetchFor, establishDoorRoad } from "../remote/doorRoad";
import {
  bindPairingRoom,
  getPairing,
  getPairingCredential,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { DONE, FakeRoomXhr, installFakeRoomXhr } from "../../test-support/fakeRoomXhr";
import infoFixture from "./fixtures/info.json";
import { resetRoomEpochs } from "./roomEpochs";
import { openRoomStream, type RoomStreamEvent } from "./roomStream";

const LOCAL_ID = "p-lid-bounds";
const EPOCH = "e-bounds-1";
/** The backoff's band over a minute: 0.5 + 1 + 2 + 4 + 8 + 15 + 15 + 15 s. */
const BAND_IN_A_MINUTE = 9;

function record() {
  return {
    localId: LOCAL_ID,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
  };
}

function errorBody(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

/** The refetch pair a resync rides: info and history, both answering. */
function doorFetchServing(): jest.Mock {
  const fetcher = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    isBodyEmpty: async () => false,
    json: async () =>
      url.includes("/history")
        ? { messages: [], has_older: false, has_newer: false }
        : { ...infoFixture, epoch: EPOCH },
  }));
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Answer every dial this run opens with one status, and let a minute pass. */
async function statusForAMinute(status: number, body = ""): Promise<number> {
  let answered = 0;
  const answer = (): void => {
    while (answered < FakeRoomXhr.instances.length) {
      const wire = FakeRoomXhr.instances[answered];
      wire.head(status);
      if (body !== "") wire.chunk(body);
      wire.end();
      answered += 1;
    }
  };
  for (let round = 0; round < 40; round += 1) {
    await settle();
    answer();
    await jest.advanceTimersByTimeAsync(2_000);
    await settle();
    answer();
  }
  return FakeRoomXhr.instances.length;
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
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(record());
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

test("a door that 500s for a minute is redialled by the backoff's band, never a loop", async () => {
  const handle = openRoomStream(LOCAL_ID, () => undefined);
  const dials = await statusForAMinute(500, errorBody("internal", "The room's store failed."));
  expect(dials).toBeGreaterThan(3); // it does keep trying…
  expect(dials).toBeLessThanOrEqual(BAND_IN_A_MINUTE); // …at the capped, growing band
  handle.close();
});

test("a door that 503s for a minute costs the same band", async () => {
  const handle = openRoomStream(LOCAL_ID, () => undefined);
  const dials = await statusForAMinute(503, errorBody("no_room", "The room is not open."));
  expect(dials).toBeGreaterThan(3);
  expect(dials).toBeLessThanOrEqual(BAND_IN_A_MINUTE);
  handle.close();
});

test("a 401 is asked once: the stream stops, and a minute changes nothing", async () => {
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();

  const first = FakeRoomXhr.latest();
  first.head(401); // the door's refusal is an empty body (§1)
  first.end();
  await settle();

  expect(FakeRoomXhr.instances).toHaveLength(1);
  expect(events).toContainEqual({ type: "removed" });
  expect(markPairingRemoved).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(60_000);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(1);
  expect(markPairingRemoved).toHaveBeenCalledTimes(1);
  handle.close();
});

test("a door that keeps answering 409 stops itself after three fruitless resyncs", async () => {
  const fetcher = doorFetchServing();
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();

  let dials = 0;
  const answer = (): void => {
    while (dials < FakeRoomXhr.instances.length) {
      const wire = FakeRoomXhr.instances[dials];
      dials += 1;
      wire.head(409);
      wire.chunk(errorBody("bad_cursor", "The room resumes from a numeric Last-Event-ID."));
      wire.end();
    }
  };
  for (let round = 0; round < 40; round += 1) {
    await settle();
    answer();
    await jest.advanceTimersByTimeAsync(2_000);
    await settle();
    answer();
  }

  // Three resync rounds (info + history each) then the session's own end: the
  // loop is bounded, and the fetches ride it, never outrun it.
  expect(dials).toBeGreaterThan(1);
  expect(dials).toBeLessThanOrEqual(4);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(8);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "error", code: "resync_failed" }),
  );

  const afterStop = FakeRoomXhr.instances.length;
  await jest.advanceTimersByTimeAsync(60_000);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(afterStop);
  handle.close();
});
