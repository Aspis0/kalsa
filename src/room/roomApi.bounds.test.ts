/**
 * The §9 bounds checked before any request exists: a refusal here never
 * reaches the door, so the door is asserted silent every time.
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../engine/remote/remoteDoorConfig", () => ({
  getRemoteDoorConfig: jest.fn(),
  getRemoteDoorToken: jest.fn(),
}));
jest.mock("../pairing/roomPairingStore", () => ({ adoptActivePairing: jest.fn() }));

import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { fetchRoomHistory, postRoomMessage, putRoomName } from "./roomApi";
import historyFixture from "./fixtures/history.json";
import nameFixture from "./fixtures/name.json";
import postQueuedFixture from "./fixtures/postQueued.json";

const CREDENTIAL = "ab".repeat(32);

function installDoor(body: unknown) {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<DoorFetch>[1]) => ({
    ok: true,
    status: 200,
    isBodyEmpty: async () => false,
    json: async () => body,
  }));
  (getRemoteDoorConfig as jest.MockedFunction<typeof getRemoteDoorConfig>).mockResolvedValue({
    url: "https://desk.example",
    pairedCredential: CREDENTIAL,
    node: null,
    pairedVia: null,
    source: "pairing",
  });
  (getRemoteDoorToken as jest.MockedFunction<typeof getRemoteDoorToken>).mockResolvedValue(
    CREDENTIAL,
  );
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(fetcher);
  return fetcher;
}

beforeEach(() => {
  jest.resetAllMocks();
});

/** A local bound refuses: the door was never configured, let alone dialled. */
async function expectRefusedWithoutRequest(result: Promise<{ ok: boolean }>): Promise<void> {
  const settled = await result;
  expect(settled.ok).toBe(false);
  expect(getRemoteDoorConfig).not.toHaveBeenCalled();
  expect(doorFetchFor).not.toHaveBeenCalled();
}

describe("message text: 1-8000 UTF-8 bytes", () => {
  test.each([[""], ["a".repeat(8001)], ["é".repeat(4001)]])(
    "refuses %j before any request",
    async (text) => {
      installDoor(postQueuedFixture);
      await expectRefusedWithoutRequest(postRoomMessage({ clientMsgId: "b3f1c2", text }));
    },
  );

  test.each([
    ["a single byte", "a"],
    ["exactly 8000 ASCII bytes", "a".repeat(8000)],
    ["exactly 8000 bytes of two-byte characters", "é".repeat(4000)],
  ])("%s passes", async (_label, text) => {
    installDoor(postQueuedFixture);
    const result = await postRoomMessage({ clientMsgId: "b3f1c2", text });
    expect(result.ok).toBe(true);
  });
});

describe("display name: 1-40 UTF-8 bytes after trimming", () => {
  test.each([["   "], ["a".repeat(41)], ["é".repeat(21)]])(
    "refuses %j before any request",
    async (name) => {
      installDoor(nameFixture);
      await expectRefusedWithoutRequest(putRoomName(name));
    },
  );

  test.each([
    ["exactly 40 bytes", "a".repeat(40)],
    ["spaces the computer will trim away", `  ${"n".repeat(40)}  `],
    ["a name in one script", "Nicolò"],
  ])("%s passes", async (_label, name) => {
    installDoor(nameFixture);
    const result = await putRoomName(name);
    expect(result.ok).toBe(true);
  });
});

describe("client_msg_id: 1-64 characters of ASCII 0x21-0x7E", () => {
  test.each([[""], ["a".repeat(65)], ["has a space"], ["tab\there"], ["é"], ["~".repeat(64) + "!"]])(
    "refuses %j before any request",
    async (clientMsgId) => {
      installDoor(postQueuedFixture);
      await expectRefusedWithoutRequest(postRoomMessage({ clientMsgId, text: "hello" }));
    },
  );

  test.each([
    ["one character", "!"],
    ["exactly 64 characters", "a".repeat(64)],
    ["the edges of the ASCII range", "!~"],
  ])("%s passes", async (_label, clientMsgId) => {
    installDoor(postQueuedFixture);
    const result = await postRoomMessage({ clientMsgId, text: "hello" });
    expect(result.ok).toBe(true);
  });
});

describe("history limit: an integer 1-200", () => {
  test.each([[0], [201], [-1], [1.5]])("refuses %i before any request", async (limit) => {
    installDoor(historyFixture);
    await expectRefusedWithoutRequest(fetchRoomHistory({ limit }));
  });

  test.each([[1], [100], [200]])("%i passes", async (limit) => {
    installDoor(historyFixture);
    const result = await fetchRoomHistory({ limit });
    expect(result.ok).toBe(true);
  });
});
