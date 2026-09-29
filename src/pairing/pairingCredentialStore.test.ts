/**
 * The pairing store's own API: a save is the active record chat reads,
 * the v3 key migrates once and never loses its credential, a keystore
 * read failure still REJECTS (SettingsScreen keeps its last answer on a
 * rejection, not on a silent null), and a damaged map is backed up once
 * and refused rather than overwritten.
 */
const stored: Record<string, string> = {};
const failingReads = { keys: new Set<string>() };

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => {
    if (failingReads.keys.has(key)) throw new Error("keystore read failed");
    return stored[key] ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    stored[key] = value;
  }),
}));

import * as SecureStore from "expo-secure-store";
import {
  getPairingCredential,
  listPairings,
  savePairingCredential,
} from "./pairingCredentialStore";

const MAP_KEY = "kalsa.pairing.rooms.v2";
const DAMAGED_KEY = "kalsa.pairing.rooms.v2.damaged";
const LEGACY_KEY = "kalsa.pairing.credential.v3";
const DOOR = "https://desktop.example";

const setItem = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  failingReads.keys.clear();
  jest.clearAllMocks();
});

async function pair(fill: number, options?: { node?: string; pairedVia?: "iroh" | "https" }) {
  await savePairingCredential(new Uint8Array(32).fill(fill), DOOR, options);
}

describe("the active record", () => {
  test("a saved pairing is what get returns, in full", async () => {
    await pair(0xab, { node: "cd".repeat(32), pairedVia: "iroh" });

    await expect(getPairingCredential()).resolves.toEqual({
      localId: expect.any(String),
      credential: "ab".repeat(32),
      doorUrl: DOOR,
      node: "cd".repeat(32),
      pairedVia: "iroh",
      roomId: null,
    });
  });

  test("a node that is not 64 lowercase hex is dropped at save time, pairedVia with it", async () => {
    await pair(0xab, { node: "AB".repeat(32), pairedVia: "iroh" });

    await expect(getPairingCredential()).resolves.toMatchObject({
      node: null,
      pairedVia: null,
    });
  });

  test("a malformed credential is rejected before any store write", async () => {
    await expect(
      savePairingCredential(new Uint8Array(31), DOOR),
    ).rejects.toThrow("invalid pairing credential");
    expect(setItem).not.toHaveBeenCalled();
  });

  test("a steady read writes nothing — migration already happened or is not due", async () => {
    await pair(0xab);
    setItem.mockClear();

    await getPairingCredential();

    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("unreadable versus unpaired", () => {
  test("a keystore read failure rejects — the map's, and the legacy record's during migration", async () => {
    await pair(0xab);
    failingReads.keys.add(MAP_KEY);
    await expect(getPairingCredential()).rejects.toThrow("keystore read failed");

    failingReads.keys.clear();
    for (const key of Object.keys(stored)) delete stored[key];
    stored[LEGACY_KEY] = JSON.stringify({
      credential: "ab".repeat(32),
      doorUrl: DOOR,
    });
    failingReads.keys.add(LEGACY_KEY);
    await expect(getPairingCredential()).rejects.toThrow("keystore read failed");
  });

  test("an unparseable record reads as unpaired; an unreadable v3 writes no map", async () => {
    stored[MAP_KEY] = JSON.stringify({
      active: "p1",
      records: [{ localId: "p1", credential: "not-hex", doorUrl: DOOR, roomId: null }],
    });
    await expect(getPairingCredential()).resolves.toBeNull();

    for (const key of Object.keys(stored)) delete stored[key];
    stored[LEGACY_KEY] = "{not json";
    await expect(getPairingCredential()).resolves.toBeNull();
    expect(stored[MAP_KEY]).toBeUndefined();
    expect(stored[LEGACY_KEY]).toBe("{not json");
  });
});

describe("the one-time v3 migration", () => {
  test("the legacy record lands in the map with its credential intact and stays there", async () => {
    const legacy = JSON.stringify({
      credential: "12".repeat(32),
      doorUrl: DOOR,
      node: "cd".repeat(32),
      pairedVia: "iroh",
    });
    stored[LEGACY_KEY] = legacy;

    const migrated = await getPairingCredential();

    expect(migrated).toEqual({
      localId: expect.any(String),
      credential: "12".repeat(32),
      doorUrl: DOOR,
      node: "cd".repeat(32),
      pairedVia: "iroh",
      roomId: null,
    });
    expect(stored[LEGACY_KEY]).toBe(legacy);
    expect(JSON.parse(stored[MAP_KEY]).records[0].credential).toBe("12".repeat(32));

    // Migrated once: the v3 key disappears and the map still answers.
    delete stored[LEGACY_KEY];
    await expect(getPairingCredential()).resolves.toMatchObject({
      credential: "12".repeat(32),
    });
  });
});

describe("pairing a second computer", () => {
  test("appends beside the first instead of overwriting it", async () => {
    await pair(0xab);
    const first = (await listPairings())[0];
    await pair(0xcd);

    const all = await listPairings();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({ ...first, roomId: null });
    await expect(getPairingCredential()).resolves.toMatchObject({
      credential: "cd".repeat(32),
      localId: all[1].localId,
    });
  });
});

describe("a map that will not parse", () => {
  const SECRET_HEX = "a1b2c3d4".repeat(8); // 64 hex, as a credential would be
  const RAW = `{"credential":"${SECRET_HEX}", "doorUrl":`; // deliberately broken JSON

  test("keeps the raw bytes once, refuses every write, and quotes nothing", async () => {
    stored[MAP_KEY] = RAW;

    await expect(
      savePairingCredential(new Uint8Array(32).fill(0xab), DOOR),
    ).rejects.toThrow("pairing map damaged");
    expect(stored[MAP_KEY]).toBe(RAW);
    expect(stored[DAMAGED_KEY]).toBe(RAW);
    await expect(getPairingCredential()).rejects.toThrow("pairing map damaged");
    await expect(
      savePairingCredential(new Uint8Array(32).fill(0xcd), DOOR),
    ).rejects.toThrow("pairing map damaged");
    // Backed up once across all three failures: the kept copy is never rewritten.
    const backupWrites = setItem.mock.calls.filter(([key]) => key === DAMAGED_KEY);
    expect(backupWrites).toHaveLength(1);
    expect(stored[MAP_KEY]).toBe(RAW);
    expect(stored[MAP_KEY]).toContain(SECRET_HEX);
    expect(JSON.stringify({ message: "pairing map damaged" })).not.toContain(SECRET_HEX);
  });

  test("an envelope of the wrong shape is damage too, not an empty map", async () => {
    const wrongShape = '{"active":"p1"}'; // no records array
    stored[MAP_KEY] = wrongShape;

    await expect(getPairingCredential()).rejects.toThrow("pairing map damaged");
    expect(stored[MAP_KEY]).toBe(wrongShape);
    expect(stored[DAMAGED_KEY]).toBe(wrongShape);
  });
});
