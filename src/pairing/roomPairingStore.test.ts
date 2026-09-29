const stored: Record<string, string> = {};

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => stored[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    stored[key] = value;
  }),
}));

import * as SecureStore from "expo-secure-store";
import { getPairingCredential, savePairingCredential } from "./pairingCredentialStore";
import {
  adoptActivePairing,
  getRoomPairing,
  listRoomPairings,
  putRoomPairing,
  removeRoomPairing,
} from "./roomPairingStore";

const ACTIVE_KEY = "kalsa.pairing.credential.v3";
const ROOMS_KEY = "kalsa.pairing.rooms.v1";
const DOOR_A = "https://desk-a.example";
const DOOR_B = "https://desk-b.example";

function storedJson(key: string): Record<string, unknown> {
  return JSON.parse(stored[key]) as Record<string, unknown>;
}

async function pairComputer(credentialFill: number, doorUrl: string): Promise<void> {
  await savePairingCredential(new Uint8Array(32).fill(credentialFill), doorUrl);
}

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  jest.clearAllMocks();
});

describe("adopting the active pairing into the room map", () => {
  test("the first successful info migrates the record with no credential loss", async () => {
    await savePairingCredential(new Uint8Array(32).fill(0xab), DOOR_A, {
      node: "ef".repeat(32),
      pairedVia: "iroh",
    });

    await adoptActivePairing("room-a");

    const expected = {
      credential: "ab".repeat(32),
      doorUrl: DOOR_A,
      node: "ef".repeat(32),
      pairedVia: "iroh",
    };
    await expect(getRoomPairing("room-a")).resolves.toEqual(expected);
    // Chat's active record still answers, now stamped with its room.
    await expect(getPairingCredential()).resolves.toEqual({ ...expected, roomId: "room-a" });
    expect(storedJson(ROOMS_KEY)["room-a"]).toEqual({
      credential: "ab".repeat(32),
      doorUrl: DOOR_A,
      node: "ef".repeat(32),
      pairedVia: "iroh",
    });
    expect(storedJson(ACTIVE_KEY).credential).toBe("ab".repeat(32));
  });

  test("a record already bound to the room is not adopted again", async () => {
    await pairComputer(0xab, DOOR_A);
    await adoptActivePairing("room-a");
    const writesAfterFirst = (SecureStore.setItemAsync as jest.Mock).mock.calls.length;

    await adoptActivePairing("room-a");

    expect((SecureStore.setItemAsync as jest.Mock).mock.calls.length).toBe(writesAfterFirst);
  });

  test("nothing active means nothing to adopt and no key is created", async () => {
    await adoptActivePairing("room-a");

    await expect(listRoomPairings()).resolves.toEqual({});
    expect(stored[ROOMS_KEY]).toBeUndefined();
  });
});

describe("several computers side by side", () => {
  test("a second pairing adds its record beside the first", async () => {
    await pairComputer(0xab, DOOR_A);
    await adoptActivePairing("room-a");
    await pairComputer(0xcd, DOOR_B);
    await adoptActivePairing("room-b");

    const all = await listRoomPairings();
    expect(Object.keys(all).sort()).toEqual(["room-a", "room-b"]);
    expect(all["room-a"].credential).toBe("ab".repeat(32));
    expect(all["room-b"].credential).toBe("cd".repeat(32));
    await expect(getPairingCredential()).resolves.toMatchObject({
      credential: "cd".repeat(32),
      roomId: "room-b",
    });
  });

  test("re-pairing the same room replaces only that record", async () => {
    await pairComputer(0xab, DOOR_A);
    await adoptActivePairing("room-a");
    await pairComputer(0xcd, DOOR_B);
    await adoptActivePairing("room-b");

    await pairComputer(0x5a, DOOR_A);
    await adoptActivePairing("room-a");

    await expect(getRoomPairing("room-a")).resolves.toEqual({
      credential: "5a".repeat(32),
      doorUrl: DOOR_A,
      node: null,
      pairedVia: null,
    });
    await expect(getRoomPairing("room-b")).resolves.toMatchObject({ credential: "cd".repeat(32) });
  });
});

describe("the keyed map itself", () => {
  test("put rejects an empty room id before touching the store", async () => {
    await expect(
      putRoomPairing("", {
        credential: "ab".repeat(32),
        doorUrl: DOOR_A,
        node: null,
        pairedVia: null,
      }),
    ).rejects.toThrow("invalid room id");
    expect(stored[ROOMS_KEY]).toBeUndefined();
  });

  test("remove drops one room and leaves its neighbour in place", async () => {
    await pairComputer(0xab, DOOR_A);
    await adoptActivePairing("room-a");
    await pairComputer(0xcd, DOOR_B);
    await adoptActivePairing("room-b");

    await removeRoomPairing("room-a");

    await expect(getRoomPairing("room-a")).resolves.toBeNull();
    await expect(getRoomPairing("room-b")).resolves.toMatchObject({ credential: "cd".repeat(32) });
    await removeRoomPairing("room-a");
  });

  test("a damaged entry hides itself, not its neighbours", async () => {
    await pairComputer(0xab, DOOR_A);
    await adoptActivePairing("room-a");
    await pairComputer(0xcd, DOOR_B);
    await adoptActivePairing("room-b");
    const room = storedJson(ROOMS_KEY);
    room["room-a"] = { credential: "not-hex", doorUrl: DOOR_A };

    stored[ROOMS_KEY] = JSON.stringify(room);

    await expect(getRoomPairing("room-a")).resolves.toBeNull();
    const all = await listRoomPairings();
    expect(Object.keys(all)).toEqual(["room-b"]);
  });
});
