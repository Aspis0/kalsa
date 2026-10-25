/**
 * The subscription surface: one live wire per room however many
 * listeners (the door's per-device seat cap is never raced), fan-out to
 * each, the last unsubscribe closing the stream, and pause/resume
 * keeping the cursor a foreground redial needs.
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
const stored: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => stored[key] ?? null,
    setItem: async (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: async (key: string) => {
      delete stored[key];
    },
  },
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn(),
}));
jest.mock("../engine/remote/remoteSecret", () => ({ getRemoteBrainToken: jest.fn() }));

import { getRandomBytes } from "expo-crypto";
import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import {
  bindPairingRoom,
  getPairing,
  getPairingCredential,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { FakeRoomXhr, installFakeRoomXhr } from "../../test-support/fakeRoomXhr";
import { resetRoomEpochs } from "./roomEpochs";
import { enqueueRoomMessage, subscribeRoomQueue, type RoomQueueEvent } from "./roomQueue";
import { pauseRoomStreams, resumeRoomStreams, subscribeRoomEvents } from "./roomSubscriptions";
import type { RoomStreamEvent } from "./roomStream";

const EPOCH = "e-subs-1";
/** Distinct ids per mint: identity is load-bearing (§5), never constant. */
const mintSequence = { counter: 0 };

function entryFrame(seq: number): string {
  const entry = {
    seq,
    epoch: EPOCH,
    member_id: 3,
    name: "Marco",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  };
  return `id: ${seq}\nevent: message\ndata: ${JSON.stringify(entry)}\n\n`;
}

async function settle(): Promise<void> {
  // The queue's lock → write → announce chain runs deep; drain generously.
  for (let i = 0; i < 300; i += 1) await Promise.resolve();
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  installFakeRoomXhr();
  resetRoomEpochs();
  jest.resetAllMocks();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  // resetAllMocks strips factory implementations: restore the mint.
  mintSequence.counter = 0;
  (getRandomBytes as unknown as jest.Mock).mockImplementation((length: number) => {
    const byte = (mintSequence.counter++ % 250) + 1;
    return new Uint8Array(length).fill(byte);
  });
  for (const key of Object.keys(stored)) delete stored[key];
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  // Every room's own record, as the store would answer for its local id.
  (getPairing as jest.MockedFunction<typeof getPairing>).mockImplementation(async (localId) => ({
    localId,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
  }));
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

test("one wire per room: the second listener joins it, only the last one out closes it", async () => {
  const first: RoomStreamEvent[] = [];
  const second: RoomStreamEvent[] = [];
  const leaveFirst = subscribeRoomEvents("p-lid-subs", (event) => first.push(event));
  const leaveSecond = subscribeRoomEvents("p-lid-subs", (event) => second.push(event));
  await settle();

  expect(FakeRoomXhr.instances).toHaveLength(1);
  const wire = FakeRoomXhr.latest();
  wire.head(200, { "Kalsa-Room-Epoch": EPOCH });
  wire.chunk(entryFrame(1));
  expect(first.filter((event) => event.type === "message")).toHaveLength(1);
  expect(second.filter((event) => event.type === "message")).toHaveLength(1);

  leaveSecond();
  expect(wire.aborted).toBe(false);
  wire.chunk(entryFrame(2));
  expect(first.filter((event) => event.type === "message")).toHaveLength(2);
  expect(second.filter((event) => event.type === "message")).toHaveLength(1);

  leaveFirst();
  expect(wire.aborted).toBe(true);
  const again = subscribeRoomEvents("p-lid-subs", () => undefined);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2); // a new subscription is a new wire, never a second one
  again();
});

test("pause closes the wire and its timers; resume redials from the seq it saw", async () => {
  const events: RoomStreamEvent[] = [];
  const leave = subscribeRoomEvents("p-lid-subs", (event) => events.push(event));
  await settle();
  const wire = FakeRoomXhr.latest();
  wire.head(200, { "Kalsa-Room-Epoch": EPOCH });
  wire.chunk(entryFrame(1));
  expect(events.filter((event) => event.type === "message")).toHaveLength(1);

  pauseRoomStreams();
  expect(wire.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(60_000); // background: nothing redials
  expect(FakeRoomXhr.instances).toHaveLength(1);

  resumeRoomStreams();
  await settle();
  const redial = FakeRoomXhr.latest();
  expect(redial).not.toBe(wire);
  expect(redial.requestHeaders["Last-Event-ID"]).toBe("1");
  expect(redial.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH);
  leave();
});

test("only one room streams at a time: the room on screen wins the device's seat", async () => {
  const onScreen: RoomStreamEvent[] = [];
  const previous: RoomStreamEvent[] = [];
  const leavePrevious = subscribeRoomEvents("p-lid-previous", (event) => previous.push(event));
  await settle();
  const previousWire = FakeRoomXhr.latest();
  previousWire.head(200, { "Kalsa-Room-Epoch": EPOCH });
  previousWire.chunk(entryFrame(1));
  expect(previous.filter((event) => event.type === "message")).toHaveLength(1);

  const leaveOnScreen = subscribeRoomEvents("p-lid-subs", (event) => onScreen.push(event));
  // The door retires the oldest of its two seats silently — we close
  // ours first, so the cap never decides for us.
  expect(previousWire.aborted).toBe(true);
  await settle();
  expect(FakeRoomXhr.instances).toHaveLength(2);
  const onScreenWire = FakeRoomXhr.latest();
  onScreenWire.head(200, { "Kalsa-Room-Epoch": EPOCH });
  onScreenWire.chunk(entryFrame(2));

  expect(onScreen.filter((event) => event.type === "message")).toHaveLength(1);
  expect(previous.filter((event) => event.type === "message")).toHaveLength(1); // nothing after the cut

  leavePrevious(); // its entry is already gone: a no-op, never a second cut
  leaveOnScreen();
  expect(onScreenWire.aborted).toBe(true);
});

test("a post the queue completes itself shows once: the stream's own copy is dropped", async () => {
  const streamEvents: RoomStreamEvent[] = [];
  const queueEvents: RoomQueueEvent[] = [];
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(
    jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      isBodyEmpty: async () => false,
      json: async () =>
        url.includes("/messages")
          ? { seq: 42, time: 1_791_000_042, ai_call: null, refusal: null }
          : { messages: [], has_older: false, has_newer: false },
    })) as unknown as DoorFetch,
  );

  const leaveStream = subscribeRoomEvents("p-lid-subs", (event) => streamEvents.push(event));
  const leaveQueue = subscribeRoomQueue("p-lid-subs", (event) => queueEvents.push(event));
  await settle();
  const wire = FakeRoomXhr.latest();
  wire.head(200, { "Kalsa-Room-Epoch": EPOCH });

  await enqueueRoomMessage("p-lid-subs", { text: "from the queue" });
  await settle();
  expect(queueEvents.filter((event) => event.type === "sent")).toHaveLength(1);

  // The door carries its own copy of the same entry: the queue's sent
  // verdict raised the floor, so the dispatch drops it — one bubble.
  wire.chunk(entryFrame(42));
  wire.chunk(entryFrame(43));
  await settle();

  const delivered = streamEvents.filter((event) => event.type === "message");
  expect(delivered.map((event) => (event as { entry: { seq: number } }).entry.seq)).toEqual([43]);
  leaveStream();
  leaveQueue();
});
