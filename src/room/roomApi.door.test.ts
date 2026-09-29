/**
 * The failures that happen BEFORE a request exists: a door that may not
 * carry a room call, a record this room already refused, and a
 * transport that never delivered one — each a typed result, never a
 * thrown message a credential could hide in.
 *
 * info.json used as a 200 body: ROOM-PROTOCOL.md §3's example, verbatim
 * (keys at crates/kalsa-door/src/room/routes.rs:58-63).
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../engine/remote/remoteDoorConfig", () => ({
  getRemoteDoorConfig: jest.fn(),
  getRemoteDoorToken: jest.fn(),
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { fetchRoomInfo } from "./roomApi";
import infoFixture from "./fixtures/info.json";

const CREDENTIAL = "ab".repeat(32);

type DoorSetup = { url: string; token?: string | null; removed?: boolean; roadError?: Error; fetchError?: Error };

function installDoor(setup: DoorSetup) {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => {
    if (setup.fetchError !== undefined) throw setup.fetchError;
    return {
      ok: true,
      status: 200,
      isBodyEmpty: async () => false,
      json: async () => infoFixture,
    };
  });
  (getRemoteDoorConfig as jest.MockedFunction<typeof getRemoteDoorConfig>).mockResolvedValue({
    url: setup.url,
    pairedCredential: CREDENTIAL,
    node: null,
    pairedVia: null,
    source: "pairing",
    pairing: { localId: "p-lid-door", removed: setup.removed === true },
  });
  (getRemoteDoorToken as jest.MockedFunction<typeof getRemoteDoorToken>).mockResolvedValue(
    setup.token === undefined ? CREDENTIAL : setup.token,
  );
  const road = establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>;
  if (setup.roadError !== undefined) road.mockRejectedValue(setup.roadError);
  else road.mockResolvedValue({ road: "https" });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

beforeEach(() => {
  jest.resetAllMocks();
});

test("a door this build may not talk to is unusable: no road is even decided", async () => {
  const fetcher = installDoor({ url: "http://desk.example" });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "door_unusable", message: "remote_brain_https_required" },
  });
  expect(establishDoorRoad).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

test("a remote door with no bearer is unusable rather than a 401 in disguise", async () => {
  const fetcher = installDoor({ url: "https://desk.example", token: null });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "door_unusable", message: "remote_brain_token_required" },
  });
  expect(establishDoorRoad).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

test("a record this room already refused is refused here, before the road or a byte", async () => {
  const fetcher = installDoor({ url: "https://desk.example", removed: true });

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "removed", message: "This phone is no longer a member of the room." },
  });
  expect(establishDoorRoad).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

test("a dial that never connected reads as unreachable, thrown details and all", async () => {
  installDoor({ url: "https://desk.example", roadError: new Error("dial exploded: full text") });

  const result = await fetchRoomInfo();

  expect(result).toEqual({
    ok: false,
    error: { code: "unreachable", message: "remote_brain_network" },
  });
});

test("a request that died mid-flight is unreachable and quotes nothing", async () => {
  installDoor({
    url: "https://desk.example",
    fetchError: new Error(`socket closed near ${CREDENTIAL}`),
  });

  const result = await fetchRoomInfo();

  expect(result).toEqual({
    ok: false,
    error: { code: "unreachable", message: "remote_brain_network" },
  });
  expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
});
