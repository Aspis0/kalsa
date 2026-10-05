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
  getRandomBytes: jest.fn((length: number) => new Uint8Array(length).fill(0x7e)),
}));
jest.mock("./roomApi", () => ({ postRoomMessage: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({ getPairing: jest.fn() }));

import { getRandomBytes } from "expo-crypto";
import { getPairing } from "../pairing/pairingCredentialStore";
import { postRoomMessage } from "./roomApi";
import { resetRoomEpochs } from "./roomEpochs";
import {
  enqueueRoomMessage,
  flushRoomQueue,
  getRoomQueue,
  retryRoomQueueItem,
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

test("the user's retry revives a failed item with the SAME id (§5)", async () => {
  const events: RoomQueueEvent[] = [];
  const leave = subscribeRoomQueue(LOCAL, (event) => events.push(event));
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(
      errorResult("too_large", "The room reads a JSON body of the shape its route defines."),
    )
    .mockResolvedValueOnce(sentResult(46));

  await enqueueRoomMessage(LOCAL, { text: "one word too many" });
  await settle();
  await expect(getRoomQueue(LOCAL)).resolves.toMatchObject([
    { state: "failed", error: { code: "too_large" } },
  ]);
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  await retryRoomQueueItem(LOCAL, "7e".repeat(16));
  await settle();

  const attempts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string },
  );
  expect(attempts).toHaveLength(2); // a terminal refusal burns the id; this tap un-burns it
  expect(attempts[0].clientMsgId).toBe(attempts[1].clientMsgId);
  expect(events.filter((event) => event.type === "sent")).toHaveLength(1);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
  leave();
});

test("the user's retry drops an owed backoff and goes at once", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("unreachable", "remote_brain_network"))
    .mockResolvedValueOnce(sentResult(47));

  await enqueueRoomMessage(LOCAL, { text: "the host is asleep" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  await retryRoomQueueItem(LOCAL, "7e".repeat(16));
  await settle(); // no timer advanced: the tap is the trigger
  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
  leave();
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

test("a thrown POST requeues the item and retries it with the same id", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockRejectedValueOnce(new Error("private response text"))
    .mockResolvedValueOnce(sentResult(51));

  await enqueueRoomMessage(LOCAL, { text: "survive a thrown request" });
  await settle();

  await expect(getRoomQueue(LOCAL)).resolves.toMatchObject([
    { state: "queued", clientMsgId: "7e".repeat(16), error: { code: "unreachable" } },
  ]);
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(500);
  await settle();

  const sentIds = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string },
  );
  expect(sentIds.map(({ clientMsgId }) => clientMsgId)).toEqual(["7e".repeat(16), "7e".repeat(16)]);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
  leave();
});

test("409 epoch_changed posts the same id again (§5)", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(
      errorResult("epoch_changed", "The room's transcript restarted; drop what was cached and read it again."),
    )
    .mockResolvedValueOnce(sentResult(43));

  await enqueueRoomMessage(LOCAL, { text: "written while the recovery ran" });
  await settle();

  // The epoch drop itself is roomApi's on the 409 (roomApi.ts's
  // epoch_changed branch) — the queue only owes the SAME id after it.
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
  leave();
});

test("503 read_only keeps the message queued — with the door's sentence — and backs off", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("read_only", "the room's transcript needs repair; posts are refused until it is reopened"))
    .mockResolvedValueOnce(sentResult(44));

  await enqueueRoomMessage(LOCAL, { text: "retry later" });
  await settle();

  // Not failed — still waiting, and the reason rides the item for P5.
  await expect(getRoomQueue(LOCAL)).resolves.toMatchObject([
    {
      state: "queued",
      text: "retry later",
      error: { code: "read_only" },
    },
  ]);
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(500);
  await settle();

  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  await expect(getRoomQueue(LOCAL)).resolves.toEqual([]);
  leave();
});

test("kill and restart: the shelf restores as queued and sends with its stored id", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
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
  leave();
});
