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
import { FakeRoomXhr, installFakeRoomXhr } from "../../test-support/fakeRoomXhr";
import infoFixture from "./fixtures/info.json";
import { noteRoomEpoch, resetRoomEpochs } from "./roomEpochs";
import { backoffDelayMs } from "./roomBackoff";
import { openRoomStream, type RoomStreamEvent } from "./roomStream";

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
  resetRoomEpochs();
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
  // The cut was announced before the reconnect began (§7's UI cue).
  expect(events).toContainEqual({ type: "disconnected" });
  // The reconnect fetched info once (§7) and told the listener (§7).
  expect(events.some((event) => event.type === "refetched")).toBe(true);
  const fetcher = (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mock.results[0]
    .value as jest.Mock;
  expect(fetcher.mock.calls[0][0]).toContain("/kalsa/room/info");
  handle.close();
});

test("every ping — four virtual minutes of them — keeps the one wire alive; silence then kills it", async () => {
  const events: RoomStreamEvent[] = [];
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();
  const first = FakeRoomXhr.latest();
  first.head(200, { "Kalsa-Room-Epoch": EPOCH });
  first.chunk(entryFrame("message", 1));

  // 16 pings at the door's 15 s interval: every one of them is a byte
  // that must reset the dead-window — a healthy stream is never killed.
  for (let ping = 0; ping < 16; ping += 1) {
    await jest.advanceTimersByTimeAsync(15_000);
    first.chunk(": ping\n\n");
  }
  expect(FakeRoomXhr.instances).toHaveLength(1);

  // Now36 s of nothing: the30 s window passes at a 5 s check, the dead
  // wire is cut with a disconnected event, the backoff redials.
  await jest.advanceTimersByTimeAsync(36_000);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2);
  expect(events).toContainEqual({ type: "disconnected" });
  handle.close();
});

test("a dial that cannot even start says so, and its retries back off", async () => {
  const events: RoomStreamEvent[] = [];
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockRejectedValue(
    new Error("fetch failed"),
  );
  const handle = openRoomStream(LOCAL_ID, (event) => events.push(event));
  await settle();

  // The dial threw before any wire existed: the same cue a cut wire gives,
  // once per try.
  expect(events).toEqual([{ type: "disconnected" }]);
  const dialsAfterFirstTry = (establishDoorRoad as jest.Mock).mock.calls.length;
  expect(dialsAfterFirstTry).toBe(1);

  // A minute of a computer that is off: the retries grow with the backoff and
  // never become a loop.
  await jest.advanceTimersByTimeAsync(60_000);
  await settle();
  const dials = (establishDoorRoad as jest.Mock).mock.calls.length;
  expect(dials).toBeLessThanOrEqual(9);
  expect(events.filter((event) => event.type === "disconnected")).toHaveLength(dials);
  handle.close();
});

test("the backoff restarts only on health — a delivered entry, never the bare head", async () => {
  const handle = openRoomStream(LOCAL_ID, () => undefined);
  await settle();

  // Two quick cuts:500 ms (attempt 0), then 1000 ms (attempt 1) — the
  // 2xx head in between resets nothing.
  FakeRoomXhr.latest().head(200, { "Kalsa-Room-Epoch": EPOCH });
  FakeRoomXhr.latest().end();
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2);
  FakeRoomXhr.latest().head(200, { "Kalsa-Room-Epoch": EPOCH });
  FakeRoomXhr.latest().end();
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2); // still waiting out the 1000 ms
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(3);

  // A delivered entry earns a fresh backoff: the next cut is 500 ms again.
  const third = FakeRoomXhr.latest();
  third.head(200, { "Kalsa-Room-Epoch": EPOCH });
  third.chunk(entryFrame("message", 1));
  third.end();
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(4);
  handle.close();
});

test("sixty seconds of a quiet-but-alive stream restarts the backoff too", async () => {
  const handle = openRoomStream(LOCAL_ID, () => undefined);
  await settle();

  // Walk the backoff up to 2000 ms: two cuts (500, then 1000)…
  FakeRoomXhr.latest().head(200, { "Kalsa-Room-Epoch": EPOCH });
  FakeRoomXhr.latest().end();
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  FakeRoomXhr.latest().head(200, { "Kalsa-Room-Epoch": EPOCH });
  FakeRoomXhr.latest().end();
  await jest.advanceTimersByTimeAsync(1_000);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(3);

  // …then a stream that just stays up, fed by pings, past the healthy
  // window: its cut is answered at the floor again (500 ms, not 2000).
  const third = FakeRoomXhr.latest();
  third.head(200, { "Kalsa-Room-Epoch": EPOCH });
  for (let ping = 0; ping < 5; ping += 1) {
    await jest.advanceTimersByTimeAsync(15_000);
    third.chunk(": ping\n\n");
  }
  third.end();
  await jest.advanceTimersByTimeAsync(500);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(4);
  handle.close();
});

test("the backoff grows exponentially and never leaves its jittered half-band", () => {
  expect(backoffDelayMs(0)).toBe(500);
  expect(backoffDelayMs(1)).toBe(1_000);
  expect(backoffDelayMs(3)).toBe(4_000); // random pinned to 0 = the band's floor
  expect(backoffDelayMs(5)).toBe(15_000); // 32 s capped at 30 s, halved by the pin
  expect(backoffDelayMs(50)).toBe(15_000);
  randomSpy.mockRestore();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.999999);
  expect(backoffDelayMs(5)).toBeLessThan(30_000);
  expect(backoffDelayMs(50)).toBeGreaterThanOrEqual(15_000);
});
