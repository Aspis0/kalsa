/**
 * The live stream's own machinery: one bare open that takes the door's
 * first ai_status and delivers numbered entries typed, at most once and
 * in order; a cut that resumes with Last-Event-ID and the cached epoch —
 * no gap, no duplicate — with the reconnect's one info call (§7); pings
 * that keep it alive and silence that kills it; the backoff's band.
 *
 * Frame shapes are the door's, cited against kalsa-brain's working tree
 * at HEAD c40c6a12: the numbered frame `id:` + `event:` + `data:` from
 * stream.rs:316-324, the opening ai_status snapshot from stream.rs:253-257
 * with the ai_state payload of routes.rs:92-100, `: ping` from
 * stream.rs:282, entries in the answers.rs:26-33 shape.
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
import { openRoomStream, reconnectDelayMs, type RoomStreamEvent } from "./roomStream";

const LOCAL_ID = "p-lid-stream";
const EPOCH = "e-stream-1";
const CREDENTIAL = "ab".repeat(32);

const RECORD = {
  localId: LOCAL_ID,
  credential: CREDENTIAL,
  doorUrl: "https://desk.example",
  node: null,
  pairedVia: null,
  roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
};

function aiStatusFrame(): string {
  const status = {
    state: "idle",
    busy: false,
    running: null,
    queue: [],
    who: null,
    you_pending: false,
    note_code: null,
    note: null,
  };
  return `event: ai_status\ndata: ${JSON.stringify(status)}\n\n`;
}

function entryFrame(kind: "message" | "ai_message", seq: number, epoch = EPOCH): string {
  const entry = {
    seq,
    epoch,
    member_id: kind === "message" ? 3 : 4294967294,
    name: kind === "message" ? "Marco" : "Kalsa",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  };
  return `id: ${seq}\nevent: ${kind}\ndata: ${JSON.stringify(entry)}\n\n`;
}

function infoFor(epoch: string): unknown {
  return { ...infoFixture, epoch };
}

function doorFetchServing(epoch: string) {
  const fetcher = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    isBodyEmpty: async () => false,
    json: async () => (url.includes("/history") ? { messages: [], has_older: false, has_newer: false } : infoFor(epoch)),
  }));
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

/** Drain the immediate promise chain a connect runs on. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  installFakeRoomXhr();
  jest.resetAllMocks();
  // After the reset: resetting a spy strips the implementation too.
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(RECORD);
  (getPairingCredential as jest.MockedFunction<typeof getPairingCredential>).mockResolvedValue(null);
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockResolvedValue([]);
  (markPairingRemoved as jest.MockedFunction<typeof markPairingRemoved>).mockResolvedValue(
    undefined,
  );
  doorFetchServing(EPOCH);
});

afterEach(() => {
  randomSpy.mockRestore();
  jest.useRealTimers();
});

test("a fresh stream opens bare, takes the first ai_status, and delivers typed entries once each", async () => {
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();

  const xhr = FakeRoomXhr.latest();
  expect(xhr.method).toBe("GET");
  expect(xhr.url).toBe("https://desk.example/kalsa/room/events");
  expect(xhr.requestHeaders["Accept"]).toBe("text/event-stream");
  expect(xhr.requestHeaders["Authorization"]).toBe(`Bearer ${CREDENTIAL}`);
  expect(xhr.requestHeaders["Last-Event-ID"]).toBeUndefined();
  expect(xhr.requestHeaders["Kalsa-Room-Epoch"]).toBeUndefined();

  xhr.head(200, { "Kalsa-Room-Epoch": EPOCH });
  xhr.chunk(aiStatusFrame());
  xhr.chunk(entryFrame("message", 1) + entryFrame("ai_message", 2));
  // A frame resent inside the live tail is a duplicate: dropped.
  xhr.chunk(entryFrame("message", 1) + entryFrame("message", 2));

  expect(events).toEqual([
    {
      type: "ai_status",
      status: {
        state: "idle",
        who: null,
        running: null,
        queue: [],
        busy: false,
        youPending: false,
        noteCode: null,
        note: null,
      },
    },
    { type: "message", entry: expect.objectContaining({ seq: 1, epoch: EPOCH, memberId: 3 }) },
    { type: "ai_message", entry: expect.objectContaining({ seq: 2, memberId: 4294967294 }) },
  ]);
  // The first open owes no info call; only a reconnect does (§7).
  expect(doorFetchFor).not.toHaveBeenCalled();
  handle.close();
});

test("a cut stream resumes from its last seq with the epoch — no gap, no duplicate, one info", async () => {
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();
  const first = FakeRoomXhr.latest();
  first.head(200, { "Kalsa-Room-Epoch": EPOCH });
  first.chunk(entryFrame("message", 1) + entryFrame("message", 2));

  first.end(); // the door cut the stream → backoff 500 ms (random pinned to 0)
  await jest.advanceTimersByTimeAsync(500);
  await settle();

  const second = FakeRoomXhr.latest();
  expect(second).not.toBe(first);
  expect(second.requestHeaders["Last-Event-ID"]).toBe("2");
  expect(second.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH);
  second.head(200, { "Kalsa-Room-Epoch": EPOCH });
  // Replay overlaps on 2 and continues at 3.
  second.chunk(entryFrame("message", 2) + entryFrame("message", 3));
  await settle();

  const delivered = events.filter((event) => event.type === "message");
  expect(delivered.map((event) => (event as { entry: { seq: number } }).entry.seq)).toEqual([1, 2, 3]);
  // The reconnect fetched info once (§7) and told the listener (§7).
  expect(events.some((event) => event.type === "refetched")).toBe(true);
  const fetcher = (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mock.results[0]
    .value as jest.Mock;
  expect(fetcher.mock.calls[0][0]).toContain("/kalsa/room/info");
  handle.close();
});

test("pings keep the stream alive; silence past twice the interval kills it and redials", async () => {
  const handle = openRoomStream(LOCAL_ID, () => undefined);
  await settle();
  const first = FakeRoomXhr.latest();
  first.head(200, { "Kalsa-Room-Epoch": EPOCH });
  first.chunk(entryFrame("message", 1));

  for (const at of [15_000, 15_000]) {
    await jest.advanceTimersByTimeAsync(at);
    first.chunk(": ping\n\n");
  }
  expect(FakeRoomXhr.instances).toHaveLength(1);

  // 36 s of nothing past the last byte: the30 s window passes at a 5 s
  // check, the dead wire closes, the backoff (pinned to 500 ms) redials.
  await jest.advanceTimersByTimeAsync(36_000);
  await settle();
  expect(FakeRoomXhr.instances.length).toBe(2);
  handle.close();
});

test("the backoff grows exponentially and never leaves its jittered half-band", () => {
  expect(reconnectDelayMs(0)).toBe(500);
  expect(reconnectDelayMs(1)).toBe(1_000);
  expect(reconnectDelayMs(3)).toBe(4_000); // random pinned to 0 = the band's floor
  expect(reconnectDelayMs(5)).toBe(15_000); // 32 s capped at 30 s, halved by the pin
  expect(reconnectDelayMs(50)).toBe(15_000);
  randomSpy.mockRestore();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.999999);
  expect(reconnectDelayMs(5)).toBeLessThan(30_000);
  expect(reconnectDelayMs(50)).toBeGreaterThanOrEqual(15_000);
});
