/**
 * The shelf's policies and the room's triggers: no secure random source
 * means a typed refusal instead of a throw (the text is never lost —
 * the caller still owns it), the 200-item cap refuses before a mint,
 * NotAMember holds like removed (door sentences: kalsa-room/src/room.rs:51
 * and :53, wired as 400 at crates/kalsa-door/src/room/routes.rs:260),
 * discard is P5's removal path, an orphaned pairing's shelf is deleted
 * when its record is gone, an enqueue respects an owed backoff, and the
 * last unsubscribe kills the session's timer — no POST for a room
 * nobody watches; the next subscribe probes again.
 */
const stored: Record<string, string> = {};
/** Distinct ids per mint (the contract's one-id-per-message rule makes
 *  identity load-bearing); read only from inside the mock callback. */
const mintSequence = { counter: 0 };

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async (key: string) => stored[key] ?? null,
  setItem: async (key: string, value: string) => {
    stored[key] = value;
  },
  removeItem: async (key: string) => {
    delete stored[key];
  },
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((length: number) => {
    const byte = (mintSequence.counter++ % 250) + 1;
    return new Uint8Array(length).fill(byte);
  }),
}));
jest.mock("./roomApi", () => ({ postRoomMessage: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({ getPairing: jest.fn() }));

import { getRandomBytes } from "expo-crypto";
import { getPairing } from "../pairing/pairingCredentialStore";
import { postRoomMessage } from "./roomApi";
import {
  enqueueRoomMessage,
  flushRoomQueue,
  getRoomQueue,
  subscribeRoomQueue,
} from "./roomQueue";
import { roomQueueKey, type RoomQueueItem } from "./roomQueueStore";
import type { RoomErrorCode, RoomResult } from "./roomError";
import type { RoomPostAck } from "./roomWire";

const LOCAL = "p-lid-queue";
/** The nth id the mocked mint produced (16 bytes → 32 hex chars). */
const idOf = (n: number) => (((n - 1) % 250) + 1).toString(16).padStart(2, "0").repeat(16);

const sentResult = (seq: number): RoomResult<RoomPostAck> => ({
  ok: true,
  value: { seq, time: 1_791_000_000 + seq, aiCall: null, refusal: null },
});
const errorResult = (
  code: RoomErrorCode,
  message = "the door's sentence",
): RoomResult<RoomPostAck> => ({ ok: false, error: { code, message } });

/** The queue chain runs deep: every step is a lock plus a write plus
 *  an announce, so drain generously. */
async function settle(): Promise<void> {
  for (let i = 0; i < 300; i += 1) await Promise.resolve();
}

async function shelf(localId = LOCAL): Promise<RoomQueueItem[]> {
  return getRoomQueue(localId);
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  mintSequence.counter = 0;
  for (const key of Object.keys(stored)) delete stored[key];
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockReset();
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue({
    localId: LOCAL,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
  });
});

afterEach(() => {
  randomSpy.mockRestore();
  jest.useRealTimers();
});
test("no secure source means a typed refusal: nothing stored, nothing thrown", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  (getRandomBytes as unknown as jest.Mock).mockImplementationOnce(() => {
    throw new Error("entropy gone");
  });

  try {
    const result = await enqueueRoomMessage(LOCAL, { text: "cannot be identified" });

    expect(result).toMatchObject({ ok: false, error: { code: "client_msg_id_unavailable" } });
    await expect(shelf()).resolves.toEqual([]); // the text was NOT stored — the caller still owns it
  } finally {
    if (cryptoDescriptor !== undefined) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else delete (globalThis as { crypto?: unknown }).crypto;
  }
  leave();
});

test("the shelf caps at 200 items with a typed refusal and no mint", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  // A held door so the seeded shelf never posts while we compose.
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValue(
    errorResult("removed"),
  );
  stored[roomQueueKey(LOCAL)] = JSON.stringify({
    items: Array.from({ length: 200 }, (_, at) => ({
      clientMsgId: `seed-${at}`,
      text: `waiting ${at}`,
      callAi: false,
      createdAt: at,
      state: "queued",
    })),
  });
  const mint = getRandomBytes as unknown as jest.Mock;
  mint.mockClear();

  const result = await enqueueRoomMessage(LOCAL, { text: "one too many" });

  expect(result).toMatchObject({ ok: false, error: { code: "queue_full" } });
  expect(mint).not.toHaveBeenCalled(); // the cap refuses before an id exists
  await expect(shelf()).resolves.toHaveLength(200);
  leave();
});

test("400 NotAMember holds like removed — the door's sentence on the item, the id not burned", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("bad_request", "that member cannot post in this room"))
    .mockResolvedValueOnce(sentResult(44));

  await enqueueRoomMessage(LOCAL, { text: "as a re-earned member" });
  await settle();

  // routes.rs:260 wires NotAMember as 400 with its siblings; the queue
  // reads the sentence (room.rs:53) and holds instead of burning the id.
  await expect(shelf()).resolves.toEqual([
    expect.objectContaining({
      state: "queued",
      error: { code: "bad_request", message: "that member cannot post in this room" },
    }),
  ]);
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // hold: no timer

  await flushRoomQueue(LOCAL); // a fresh trigger: enrollment re-earned
  await settle();
  const attempts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string },
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0].clientMsgId).toBe(attempts[1].clientMsgId); // SAME id, never a new one
  await expect(shelf()).resolves.toEqual([]);
  leave();
});

test("discard removes one message; the emptied shelf writes back empty", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValue(
    errorResult("removed"),
  );

  const enqueued = await enqueueRoomMessage(LOCAL, { text: "change of mind" });
  expect(enqueued.ok).toBe(true);
  const clientMsgId = (enqueued as { value: { clientMsgId: string } }).value.clientMsgId;
  await settle();

  const { discardRoomQueueItem } = await import("./roomQueue");
  await discardRoomQueueItem(LOCAL, clientMsgId);

  await expect(shelf()).resolves.toEqual([]);
  leave();
});

test("a pairing that no longer exists takes its shelf with it", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValue(
    errorResult("removed"),
  );
  await enqueueRoomMessage(LOCAL, { text: "for a superseded pairing" });
  await settle();
  await expect(shelf()).resolves.toHaveLength(1);

  // The pairing is gone: a newer one took the room.
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue(null);
  await flushRoomQueue(LOCAL);

  await expect(shelf()).resolves.toEqual([]);
  expect(stored[roomQueueKey(LOCAL)]).toBeUndefined(); // key deleted, not emptied in place
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // the orphan check precedes any POST
  leave();
});

test("an enqueue during an owed backoff waits its turn — no extra POST now", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("unreachable", "remote_brain_network"))
    .mockResolvedValueOnce(sentResult(41))
    .mockResolvedValueOnce(sentResult(42));

  await enqueueRoomMessage(LOCAL, { text: "first" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // failed → a backoff is owed

  await enqueueRoomMessage(LOCAL, { text: "second" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // the enqueue respected the timer

  await jest.advanceTimersByTimeAsync(500);
  await settle();
  const texts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { text: string },
  );
  // Two attempts at "first" (the failed one, then the retried one — same
  // id) and then "second": FIFO order, nothing stranded by the enqueue.
  expect(texts.map((entry) => entry.text)).toEqual(["first", "first", "second"]);
  await expect(shelf()).resolves.toEqual([]);
  leave();
});

test("the last unsubscribe takes the session — timer included — and the next subscribe probes", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("unreachable", "remote_brain_network"))
    .mockResolvedValueOnce(sentResult(41));

  await enqueueRoomMessage(LOCAL, { text: "waiting" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // failed → retry pending

  leave(); // nobody watches this room anymore
  await jest.advanceTimersByTimeAsync(120_000);
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1); // its timer died with the session

  const leaveAgain = subscribeRoomQueue(LOCAL, () => undefined); // next subscribe probes
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  await expect(shelf()).resolves.toEqual([]);
  leaveAgain();
});
