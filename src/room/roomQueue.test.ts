/**
 * The queue's compose and outcomes: §9's bounds (and the 16 KiB encoded
 * cap) checked before anything is stored or minted, ONE crypto-grade id
 * per message, strict FIFO past terminal failures, 409 reused never
 * posting that id again, 404 failing, 401 holding the shelf with the
 * door's sentence on the item, and exactly one post in flight per room —
 * a flush arriving mid-send earns a rerun, never a stranded message.
 * Door sentences quoted from kalsa-brain: reused (kalsa-room/src/room.rs:51),
 * not_found (mod.rs:72 via mod.rs:195).
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
  type RoomQueueEvent,
} from "./roomQueue";
import { type RoomQueueItem, type RoomQueueSent } from "./roomQueueStore";
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
test("compose validates at §9's bounds, mints once, and the sent verdict retires the item", async () => {
  const events: RoomQueueEvent[] = [];
  const leave = subscribeRoomQueue(LOCAL, (event) => events.push(event));
  const mint = getRandomBytes as unknown as jest.Mock;

  await expect(enqueueRoomMessage(LOCAL, { text: "a".repeat(8001) })).resolves.toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  // Legal text, illegal body: escaping multiplies it past the door's 16 KiB.
  await expect(
    enqueueRoomMessage(LOCAL, { text: "\u0000".repeat(4000) }),
  ).resolves.toMatchObject({ ok: false, error: { code: "body_too_large" } });
  expect(mint).not.toHaveBeenCalled(); // a refused compose owns no id
  await expect(shelf()).resolves.toEqual([]);

  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValueOnce(
    sentResult(41),
  );
  const enqueued = await enqueueRoomMessage(LOCAL, { text: "hello", callAi: true });
  expect(enqueued).toEqual({ ok: true, value: { clientMsgId: idOf(1) } });
  await settle();

  expect(postRoomMessage).toHaveBeenCalledTimes(1);
  expect(postRoomMessage).toHaveBeenCalledWith(
    { clientMsgId: idOf(1), text: "hello", callAi: true },
    { roomLocalId: LOCAL },
  );
  await expect(shelf()).resolves.toEqual([]);
  expect(events).toContainEqual({
    type: "sent",
    item: expect.objectContaining({ clientMsgId: idOf(1), state: "sent", seq: 41, time: 1_791_000_041 }),
  });
  // The waiting list saw queued before sending before gone.
  const changed = events.filter((event) => event.type === "changed");
  expect(changed[0]).toMatchObject({ items: [expect.objectContaining({ state: "queued" })] });
  leave();
});

test("strict FIFO: a terminal failure never blocks the room's later messages", async () => {
  const events: RoomQueueEvent[] = [];
  const leave = subscribeRoomQueue(LOCAL, (event) => events.push(event));
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>)
    .mockResolvedValueOnce(errorResult("bad_request", "refused"))
    .mockResolvedValueOnce(sentResult(41))
    .mockResolvedValueOnce(sentResult(42));

  await enqueueRoomMessage(LOCAL, { text: "first" });
  await enqueueRoomMessage(LOCAL, { text: "second" });
  await enqueueRoomMessage(LOCAL, { text: "third" });
  await settle();

  expect(
    (postRoomMessage as jest.Mock).mock.calls.map((call) => (call as unknown[])[0]),
  ).toEqual([
    { clientMsgId: idOf(1), text: "first", callAi: false },
    { clientMsgId: idOf(2), text: "second", callAi: false },
    { clientMsgId: idOf(3), text: "third", callAi: false },
  ]);
  // The failed head stays visible, typed; the sent two are gone.
  await expect(shelf()).resolves.toEqual([
    expect.objectContaining({ text: "first", state: "failed", error: { code: "bad_request", message: "refused" } }),
  ]);
  const sent = events.filter((event) => event.type === "sent");
  expect(sent.map((event) => (event as { item: RoomQueueSent }).item.seq)).toEqual([41, 42]);
  leave();
});

test.each([["client_msg_id_reused"], ["not_found"], ["too_large"]])(
  "%s is terminal: failed with the typed reason, never posted again",
  async (code) => {
    const leave = subscribeRoomQueue(LOCAL, () => undefined);
    (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValueOnce(
      errorResult(code as RoomErrorCode, "one id, one message"),
    );
    const mint = getRandomBytes as unknown as jest.Mock;

    await enqueueRoomMessage(LOCAL, { text: "doomed" });
    await settle();

    await expect(shelf()).resolves.toEqual([
      expect.objectContaining({ state: "failed", error: { code, message: "one id, one message" } }),
    ]);
    expect(postRoomMessage).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1); // no fresh id was minted to dodge the refusal
    await jest.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(postRoomMessage).toHaveBeenCalledTimes(1); // no timer, no resend
    leave();
  },
);

test("a call the room refused rides the ack: the sent event carries its code", async () => {
  const events: RoomQueueEvent[] = [];
  const leave = subscribeRoomQueue(LOCAL, (event) => events.push(event));
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValueOnce({
    ok: true,
    value: { seq: 48, time: 1_791_000_048, aiCall: "refused", refusal: "already_pending" },
  });

  await enqueueRoomMessage(LOCAL, { text: "@Kalsa again", callAi: true });
  await settle();

  const sent = events.find((event) => event.type === "sent");
  expect(sent).toMatchObject({
    item: { text: "@Kalsa again", callAi: true, refusal: "already_pending" },
  });
  // The message itself posted: the refusal is about the call alone (§5).
  await expect(shelf()).resolves.toEqual([]);
  leave();
});

test("401 holds the whole shelf: items stay waiting, the sentence stored, nothing retries", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockResolvedValue(
    errorResult("removed", "This phone is no longer a member of the room."),
  );

  await enqueueRoomMessage(LOCAL, { text: "one" });
  await enqueueRoomMessage(LOCAL, { text: "two" });
  await settle();

  // The attempted head carries the room's sentence for P5 ("removed
  // from <room>"); both stay queued.
  await expect(shelf()).resolves.toEqual([
    expect.objectContaining({
      text: "one",
      state: "queued",
      error: { code: "removed", message: "This phone is no longer a member of the room." },
    }),
    expect.objectContaining({ text: "two", state: "queued" }),
  ]);
  // Two local attempts: the head's, plus the flush that was already
  // pending mid-send — with the real door that second one pre-refuses
  // on the record's mark before any bearer exists. Then nothing: the
  // hold schedules no timer.
  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(300_000);
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(2);
  leave();
});

test("exactly one post in flight: a flush mid-send waits its turn, an enqueue is never stranded", async () => {
  const leave = subscribeRoomQueue(LOCAL, () => undefined);
  const releases: Array<(result: RoomResult<RoomPostAck>) => void> = [];
  (postRoomMessage as jest.MockedFunction<typeof postRoomMessage>).mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );

  await enqueueRoomMessage(LOCAL, { text: "a" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  // A second flush while the first is flying: queued as a rerun, not run.
  await flushRoomQueue(LOCAL);
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  // An item enqueued mid-send must not be stranded by the running pass.
  await enqueueRoomMessage(LOCAL, { text: "b" });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledTimes(1);

  releases[0](sentResult(41));
  await settle();
  releases[1](sentResult(42)); // the rerun picked b up by itself
  await settle();

  const texts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0],
  );
  expect(texts).toEqual([
    { clientMsgId: idOf(1), text: "a", callAi: false },
    { clientMsgId: idOf(2), text: "b", callAi: false },
  ]);
  await expect(shelf()).resolves.toEqual([]);
  leave();
});

