/**
 * How the pairing map changes: a room info files its room under the
 * record whose LOCAL id made the call (never under whatever pairing is
 * active by the time the answer lands), the newer pairing wins a room
 * contested by a re-pair, a 401 marks instead of deletes — and tells the
 * subscribers once, so an entry offering that computer can go — and two
 * mutations racing still leave one consistent map with one write each.
 */
const stored: Record<string, string> = {};

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => stored[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    stored[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete stored[key];
  }),
}));

import * as SecureStore from "expo-secure-store";
import {
  bindPairingRoom,
  getPairingCredential,
  listPairings,
  markPairingRemoved,
  savePairingCredential,
  subscribePairingRemoved,
} from "./pairingCredentialStore";

const DOOR_A = "https://desk-a.example";
const DOOR_B = "https://desk-b.example";
const setItem = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;

async function pair(fill: number, doorUrl: string): Promise<string> {
  await savePairingCredential(new Uint8Array(32).fill(fill), doorUrl);
  const all = await listPairings();
  return all[all.length - 1].localId;
}

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  jest.clearAllMocks();
});

test("an info binds the record whose credential made the call, not the current active", async () => {
  const localA = await pair(0xab, DOOR_A);
  await pair(0xcd, DOOR_B);

  await bindPairingRoom(localA, "room-1");

  const all = await listPairings();
  expect(all).toHaveLength(2);
  expect(all[0]).toMatchObject({ credential: "ab".repeat(32), roomId: "room-1" });
  expect(all[1]).toMatchObject({ credential: "cd".repeat(32), roomId: null });
});

test("binding the room a record already owns writes nothing and drops nothing", async () => {
  const localA = await pair(0xab, DOOR_A);
  await bindPairingRoom(localA, "room-1");
  setItem.mockClear();

  await expect(bindPairingRoom(localA, "room-1")).resolves.toEqual([]);

  expect(setItem).not.toHaveBeenCalled();
});

test("a local id with no record left binds nothing, writes nothing, drops nothing", async () => {
  await pair(0xab, DOOR_A);
  setItem.mockClear();

  await expect(bindPairingRoom("p-ghost", "room-1")).resolves.toEqual([]);

  expect(setItem).not.toHaveBeenCalled();
  expect((await listPairings())[0].roomId).toBeNull();
});

describe("one room, contested by a re-pair", () => {
  test("the newer pairing wins the room and the older record is dropped", async () => {
    const localA = await pair(0xab, DOOR_A);
    await bindPairingRoom(localA, "room-1");
    const localB = await pair(0xcd, DOOR_B);

    await expect(bindPairingRoom(localB, "room-1")).resolves.toEqual([localA]);

    const all = await listPairings();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ localId: localB, credential: "cd".repeat(32), roomId: "room-1" });
  });

  test("a stale bind from the older pairing never steals the room back", async () => {
    await pair(0xab, DOOR_A);
    const localB = await pair(0xcd, DOOR_B);
    await bindPairingRoom(localB, "room-1");
    const localA = (await listPairings())[0].localId;

    await expect(bindPairingRoom(localA, "room-1")).resolves.toEqual([localA]);

    const all = await listPairings();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ localId: localB, roomId: "room-1" });
    await expect(getPairingCredential()).resolves.toMatchObject({ localId: localB });
  });
});

test("a room id of __proto__ compares as itself and never vanishes", async () => {
  const localA = await pair(0xab, DOOR_A);
  const localB = await pair(0xcd, DOOR_B);

  await bindPairingRoom(localA, "__proto__");
  expect((await listPairings())[0].roomId).toBe("__proto__");

  // The contested-room scan must find it too: the newer pairing takes it over.
  await expect(bindPairingRoom(localB, "__proto__")).resolves.toEqual([localA]);
  const all = await listPairings();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ localId: localB, roomId: "__proto__" });
});

describe("the 401 mark", () => {
  test("marks the record, keeps it and its credential, and a second mark writes nothing", async () => {
    const localA = await pair(0xab, DOOR_A);

    await markPairingRemoved(localA);

    expect((await listPairings())[0]).toMatchObject({
      localId: localA,
      removed: true,
      credential: "ab".repeat(32),
    });
    setItem.mockClear();
    await markPairingRemoved(localA);
    await markPairingRemoved("p-ghost");
    expect(setItem).not.toHaveBeenCalled();
  });

  test("a mark tells the subscribers once, and leaving stops it", async () => {
    const localA = await pair(0xab, DOOR_A);
    const heard: string[] = [];
    const leave = subscribePairingRemoved((localId) => heard.push(localId));

    await markPairingRemoved(localA);
    await markPairingRemoved(localA); // already marked: no second event

    expect(heard).toEqual([localA]);
    leave();
    await markPairingRemoved("p-ghost");
    expect(heard).toEqual([localA]);
  });
});

test("two contested binds and a save interleaved settle into one consistent map", async () => {
  const localA = await pair(0xab, DOOR_A);
  const localB = await pair(0xcd, DOOR_B);
  setItem.mockClear();

  await Promise.all([
    bindPairingRoom(localA, "room-1"),
    bindPairingRoom(localB, "room-1"),
    savePairingCredential(new Uint8Array(32).fill(0x5a), "https://desk-c.example"),
  ]);

  const all = await listPairings();
  // The lock ran them in call order: B's bind found the room taken by the
  // older A and won it; the save appended and is active. One write each.
  expect(all).toHaveLength(2);
  expect(all[0]).toMatchObject({ localId: localB, roomId: "room-1" });
  expect(all[1]).toMatchObject({ credential: "5a".repeat(32), roomId: null });
  await expect(getPairingCredential()).resolves.toMatchObject({
    credential: "5a".repeat(32),
  });
  expect(setItem).toHaveBeenCalledTimes(3);
});
