/**
 * The room client against the REAL pairing store — no module mock for
 * remoteDoorConfig or the store, only the road and the wire replaced:
 * an info answers and the record whose credential read it is bound in
 * the map; a401 marks that record; and from then on the client refuses
 * to send its bearer anywhere before a road is even chosen.
 *
 * info.json/history.json provenance: ROOM-PROTOCOL.md §3/§4 examples
 * with the door's entry keys (answers.rs:26-33, routes.rs:61-66; HEAD
 * c40c6a12).
 */
// The establishment is mocked; the road decision (`pairedIrohRoad`)
// stays real — doorRequestBase and establishDoorRoad must read one verdict.
jest.mock("../remote/doorRoad", () => ({
  ...jest.requireActual("../remote/doorRoad"),
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));

const stored: Record<string, string> = {};

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => stored[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    stored[key] = value;
  }),
}));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { listPairings, savePairingCredential } from "../pairing/pairingCredentialStore";
import { fetchRoomHistory, fetchRoomInfo } from "./roomApi";
import historyFixture from "./fixtures/history.json";
import infoFixture from "./fixtures/info.json";

const DOOR = "https://desk.example";
const MAP_KEY = "kalsa.pairing.rooms.v2";

function installDoor(responses: Array<{ match: string; body: unknown; status?: number }>) {
  const fetcher = jest.fn(async (url: string, _init: Parameters<DoorFetch>[1]) => {
    const hit = responses.find((entry) => url.includes(entry.match));
    const status = hit?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      isBodyEmpty: async () => hit?.status === 401,
      json: async () => {
        if (hit === undefined || hit.status === 401) throw new Error("body is empty");
        return hit.body;
      },
    };
  });
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

beforeEach(() => {
  // mockClear, not reset: the in-memory SecureStore IS the store here.
  jest.clearAllMocks();
  for (const key of Object.keys(stored)) delete stored[key];
});

test("an info answers and the REAL store binds the record whose credential read it", async () => {
  await savePairingCredential(new Uint8Array(32).fill(0xab), DOOR);
  const fetcher = installDoor([{ match: "/info", body: infoFixture }]);

  const result = await fetchRoomInfo();

  expect(result).toMatchObject({ ok: true, value: { roomId: infoFixture.room_id } });
  const [url, init] = fetcher.mock.calls[0];
  // The door config was read from the real map: its URL and bearer are the record's.
  expect(url).toBe(`${DOOR}/kalsa/room/info`);
  expect(init.headers.Authorization).toBe(`Bearer ${"ab".repeat(32)}`);
  const [record] = await listPairings();
  expect(record.roomId).toBe("1f0a3b9c2d4e5f60718293a4b5c6d7e8");

  // The epoch the info cached now rides every later route, same record.
  const historyFetcher = installDoor([{ match: "/history", body: historyFixture }]);
  await fetchRoomHistory({});
  const [historyUrl, historyInit] = historyFetcher.mock.calls[0];
  expect(historyUrl).toBe(`${DOOR}/kalsa/room/history`);
  expect(historyInit.headers["Kalsa-Room-Epoch"]).toBe(infoFixture.epoch);
});

test("a 401 marks the REAL record, and the next call sends no bearer at all", async () => {
  await savePairingCredential(new Uint8Array(32).fill(0xcd), DOOR);
  const fetcher = installDoor([
    { match: "/info", body: infoFixture, status: 401 },
  ]);

  const refused = await fetchRoomInfo();

  expect(refused).toMatchObject({ ok: false, error: { code: "removed" } });
  const [record] = await listPairings();
  expect(record).toMatchObject({ removed: true, credential: "cd".repeat(32), roomId: null });

  const callsAfter401 = fetcher.mock.calls.length;
  const refusedAgain = await fetchRoomInfo();
  expect(refusedAgain).toMatchObject({ ok: false, error: { code: "removed" } });
  // The door config itself now says removed: no road, no request, no bearer.
  expect(fetcher.mock.calls.length).toBe(callsAfter401);
  expect(establishDoorRoad).toHaveBeenCalledTimes(1);
});

test("a damaged pairing store is its own typed outcome, and quotes nothing from the blob", async () => {
  await savePairingCredential(new Uint8Array(32).fill(0xef), DOOR);
  const leaked = "deadbeef".repeat(8);
  stored[MAP_KEY] = `{"credential":"${leaked}", "records":`; // broken JSON holding a secret-looking string
  const fetcher = installDoor([{ match: "/info", body: infoFixture }]);

  const result = await fetchRoomInfo();

  expect(result).toMatchObject({ ok: false, error: { code: "pairing_store_damaged" } });
  expect(JSON.stringify(result)).not.toContain(leaked);
  expect(fetcher).not.toHaveBeenCalled();
});
