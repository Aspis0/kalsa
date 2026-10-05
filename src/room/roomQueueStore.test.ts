/**
 * The persisted shelf: FIFO order survives save/load, a process that
 * died mid-POST heals to "queued" (the id rides the item, §5), every
 * mutation is one lock-serialized write, and a blob that will not parse
 * is backed up once and never overwritten — the queue holds the only
 * copy of a message nobody has seen.
 */
const stored: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => stored[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      stored[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete stored[key];
    }),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deleteRoomQueue,
  loadRoomQueue,
  mutateRoomQueue,
  roomQueueKey,
  type RoomQueueItem,
} from "./roomQueueStore";

const LOCAL = "p-lid-queue-store";
const KEY = roomQueueKey(LOCAL);

function item(clientMsgId: string, extra: Partial<RoomQueueItem> = {}): RoomQueueItem {
  return {
    clientMsgId,
    text: `t-${clientMsgId}`,
    callAi: false,
    createdAt: 1000,
    state: "queued",
    ...extra,
  };
}

const asyncStore = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  jest.clearAllMocks();
});

test("the shelf round-trips in order, all fields intact", async () => {
  const written = await mutateRoomQueue(LOCAL, (items) => {
    items.push(item("m1"));
    items.push(item("m2", { callAi: true, state: "failed", error: { code: "bad_request", message: "no" } }));
    return true;
  });

  expect(written.map((entry) => entry.clientMsgId)).toEqual(["m1", "m2"]);
  await expect(loadRoomQueue(LOCAL)).resolves.toEqual(written);
  // One mutation, one write.
  expect(asyncStore.setItem).toHaveBeenCalledTimes(1);
});

test("an item a killed process left 'sending' reads back as queued — its id never changes", async () => {
  stored[KEY] = JSON.stringify({
    items: [item("m-id-kept", { state: "sending" })],
  });

  const healed = await loadRoomQueue(LOCAL);

  expect(healed[0]).toMatchObject({ clientMsgId: "m-id-kept", state: "queued" });
  // The heal is a read view; the next mutation persists it as queued.
  await mutateRoomQueue(LOCAL, (items) => {
    items.push(item("m2"));
    return true;
  });
  expect(JSON.parse(stored[KEY]).items[0].state).toBe("queued");
});

test("two mutations queue up per room and neither loses the other", async () => {
  const [first, second] = await Promise.all([
    mutateRoomQueue(LOCAL, (items) => {
      items.push(item("m1"));
      return true;
    }),
    mutateRoomQueue(LOCAL, (items) => {
      items.push(item("m2"));
      return true;
    }),
  ]);

  expect(JSON.parse(stored[KEY]).items.map((entry: RoomQueueItem) => entry.clientMsgId)).toEqual([
    "m1",
    "m2",
  ]);
  expect(first.map((entry) => entry.clientMsgId)).toEqual(["m1"]); // its own draft
  expect(second.map((entry) => entry.clientMsgId)).toEqual(["m1", "m2"]); // ran behind it
  expect(asyncStore.setItem).toHaveBeenCalledTimes(2); // one write per mutation, never interleaved
});

test("rooms keep their own shelves", async () => {
  await mutateRoomQueue(LOCAL, (items) => {
    items.push(item("mine"));
    return true;
  });
  await mutateRoomQueue("p-lid-other", (items) => {
    items.push(item("theirs"));
    return true;
  });

  expect((await loadRoomQueue(LOCAL)).map((entry) => entry.clientMsgId)).toEqual(["mine"]);
  expect((await loadRoomQueue("p-lid-other")).map((entry) => entry.clientMsgId)).toEqual(["theirs"]);
});

test("a blob that will not parse is backed up once and never overwritten", async () => {
  const raw = '{"items": [{"clientMsgId": "lost-but-kept"'; // broken, holding text
  stored[KEY] = raw;

  await expect(loadRoomQueue(LOCAL)).rejects.toThrow("room queue damaged");
  expect(stored[`${KEY}.damaged`]).toBe(raw);
  await expect(
    mutateRoomQueue(LOCAL, (items) => {
      items.push(item("m1"));
      return true;
    }),
  ).rejects.toThrow("room queue damaged");

  expect(stored[KEY]).toBe(raw); // the only copy of its texts still stands
  const backups = Object.keys(stored).filter((key) => key.endsWith(".damaged"));
  expect(backups).toHaveLength(1); // once — the second refusal rewrote nothing
  expect(stored[`${KEY}.damaged`]).toBe(raw);
});

test("a bad element costs only itself: kept in the backup once, the rest survive", async () => {
  const raw = JSON.stringify({
    items: [
      { clientMsgId: "keep-1", text: "one", callAi: false, createdAt: 1, state: "queued" },
      { clientMsgId: 42, text: "lost to corruption", callAi: false, createdAt: 2, state: "queued" },
      { clientMsgId: "keep-2", text: "two", callAi: false, createdAt: 3, state: "sending" },
    ],
  });
  stored[KEY] = raw;

  const items = await loadRoomQueue(LOCAL);

  expect(items.map((entry) => entry.clientMsgId)).toEqual(["keep-1", "keep-2"]);
  expect(items[1].state).toBe("queued"); // the heal rides along
  expect(stored[`${KEY}.damaged`]).toBe(raw); // the dropped element's text, preserved

  // The shelf stays usable: survivors write back, the backup never rewrites.
  await mutateRoomQueue(LOCAL, (draft) => {
    draft.push(item("keep-3"));
    return true;
  });
  expect(JSON.parse(stored[KEY]).items).toHaveLength(3);
  expect(stored[`${KEY}.damaged`]).toBe(raw);
});

test("deleting a pairing removes the shelf and its damaged-text backup", async () => {
  stored[KEY] = JSON.stringify({ items: [item("private-id", { text: "private text" })] });
  stored[`${KEY}.damaged`] = "damaged private text";

  await deleteRoomQueue(LOCAL);

  expect(stored[KEY]).toBeUndefined();
  expect(stored[`${KEY}.damaged`]).toBeUndefined();
});
