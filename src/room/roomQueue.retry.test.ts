/**
 * The queue's recovery paths: a POST whose response is lost still
 * retries with the same client_msg_id (the door answers the idempotent
 * retry with the same seq — one sent, never two),409 epoch_changed
 * forgets the dead epoch and posts the SAME id again (§5: a post lost
 * to a recovery is accepted as new),503 read_only waits in the backoff
 * with the message still queued, and a shelf restored from a killed
 * process sends with the id it was stored with — expo-crypto never
 * mints twice for one message.
 */
const stored: Record<string, string> = {};

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
  getRandomBytes: jest.fn((length: number) => new Uint8Array(length).fill(0x7e)),
}));
jest.mock("./roomApi", () => ({ postRoomMessage: jest.fn() }));

import { getRandomBytes } from "expo-crypto";
import { postRoomMessage } from "./roomApi";
import { cachedRoomEpoch, noteRoomEpoch, resetRoomEpochs } from "./roomEpochs";
import {
  enqueueRoomMessage,
  flushRoomQueue,
  getRoomQueue,
  subscribeRoomQueue,
  type RoomQueueEvent,
} from "./roomQueue";
import { roomQueueKey, type RoomQueueItem } from "./roomQueueStore";
import type { RoomErrorCode, RoomResult } from "./roomError";
import type { RoomPostAck } from "./roomWire";

const LOCAL = "p-lid-queue-retry";

const sentResult = (seq: number): RoomResult<RoomPostAck> => ({
  ok: true,
  value: { seq, time: 1_791_000_000 + seq, aiCall: null, refusal: null },
});
const errorResult = (code: RoomErrorCode, message = "the door's sentence"): RoomResult<RoomPostAck> => ({
  ok: false,
  error: { code, message },
});

/** See roomQueue.test.ts: the chain runs deep; drain generously. */
async function settle(): Promise<void> {
  for (let i = 0; i < 300; i += 1) await Promise.resolve();
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  resetRoomEpochs();
  for (const key of Object.keys(stored)) delete stored[key];
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockReset();
});

afterEach(() => {
  randomSpy.mockRestore();
  jest.useRealTimers();
});

test("a lost response retries the same id — the door's same seq sends once, not twice", async () => {
  const events: RoomQueueEvent[] = [];
  const leave = subscribeRoomQueue(LOCAL, (event) => events.push(event));
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("unreachable", "remote_brain_network"))
    .mockResolvedValueOnce(sentResult(42));

  await enqueueRoomMessage(LOCAL, { text: "held by the host being asleep" });
  await settle();

  // First attempt failed; the item waits with its id untouched.
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([
    expect.objectContaining({ state: "queued", clientMsgId: "7e".repeat(16) }),
  ]);
  await jest.advanceTimersByTimeAsync(500); // the backoff floor (random pinned)
  await settle();

  const attempts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string; text: string },
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0].clientMsgId).toBe(attempts[1].clientMsgId); // one id, every retry (§5)
  // The idempotent retry answers with the same seq: ONE sent event, an empty shelf.
  expect(events.filter((event) => event.type === "sent")).toHaveLength(1);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
  leave();
});

test("409 epoch_changed forgets the epoch and posts the same id again (§5)", async () => {
  noteRoomEpoch(LOCAL, "epoch-died");
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(
      errorResult("epoch_changed", "The room's transcript restarted; drop what was cached and read it again."),
    )
    .mockResolvedValueOnce(sentResult(43));

  await enqueueRoomMessage(LOCAL, { text: "written while the recovery ran" });
  await settle();

  expect(cachedRoomEpoch(LOCAL)).toBeNull(); // the dead epoch went first
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([
    expect.objectContaining({ state: "queued" }),
  ]);

  await jest.advanceTimersByTimeAsync(500);
  await settle();

  const attempts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string; text: string },
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0].clientMsgId).toBe(attempts[1].clientMsgId); // the SAME id lands as new
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
});

test("503 read_only keeps the message queued and comes back through the backoff", async () => {
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("read_only", "the room's transcript needs repair; posts are refused until it is reopened"))
    .mockResolvedValueOnce(sentResult(44));

  await enqueueRoomMessage(LOCAL, { text: "retry later" });
  await settle();

  // Not failed — still waiting, with the reason nowhere near it.
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([
    expect.objectContaining({ state: "queued", text: "retry later" }),
  ]);
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(500);
  await settle();

  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
});

test("kill and restart: the shelf restores as queued and sends with its stored id", async () => {
  const KEY = roomQueueKey(LOCAL);
  stored[KEY] = JSON.stringify({
    items: [
      {
        clientMsgId: "stored-id-not-reminted",
        text: "written before the crash",
        callAi: false,
        createdAt: 1_791_000_000,
        state: "sending", // as a mid-POST kill leaves it
      },
    ],
  });
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValueOnce(
    sentResult(45),
  );
  const mint = getRandomBytes as unknown as jest.Mock;

  await expect(getRoomQueue(LOCAL)).resolves.toEqual([
    expect.objectContaining({ state: "queued", clientMsgId: "stored-id-not-reminted" }),
  ]);
  await flushRoomQueue(LOCAL);
  await settle();

  expect(postRoomMessage).toHaveBeenCalledWith(
    { clientMsgId: "stored-id-not-reminted", text: "written before the crash", callAi: false },
    { roomLocalId: LOCAL },
  );
  expect(mint).not.toHaveBeenCalled(); // the id was already owned by the message
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
});
