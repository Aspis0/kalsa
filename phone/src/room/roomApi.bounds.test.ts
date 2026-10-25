/**
 * The §9 bounds checked before any request exists: a refusal here never
 * reaches the door, so the door is asserted silent every time. The
 * encoded-body cap sits beside the text limit (§5: a legal text can
 * escape past 16 KiB) and is its own local code, never the server's
 * too_large. Fixture source lines are documented in roomApi.routes.test.ts.
 */
// The establishment is mocked; the road decision (`pairedIrohRoad`)
// stays real — doorRequestBase and establishDoorRoad must read one verdict.
jest.mock("../remote/doorRoad", () => ({
  ...jest.requireActual("../remote/doorRoad"),
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));
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
import { fetchRoomHistory, postRoomMessage, putRoomName } from "./roomApi";
import historyFixture from "./fixtures/history.json";
import nameFixture from "./fixtures/name.json";
import postFixture from "./fixtures/post.json";

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
    pairing: { localId: "p-lid-bounds", removed: false },
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
      installDoor(postFixture);
      await expectRefusedWithoutRequest(postRoomMessage({ clientMsgId: "b3f1c2", text }));
    },
  );

  test.each([
    ["a single byte", "a"],
    ["exactly 8000 ASCII bytes", "a".repeat(8000)],
    ["exactly 8000 bytes of two-byte characters", "é".repeat(4000)],
  ])("%s passes", async (_label, text) => {
    installDoor(postFixture);
    const result = await postRoomMessage({ clientMsgId: "b3f1c2", text });
    expect(result.ok).toBe(true);
  });
});

describe("the encoded body: 16 KiB whole (§5, answers.rs MAX_BODY)", () => {
  test("a legal 4000-byte text whose escaping multiplies past the cap is refused locally", async () => {
    installDoor(postFixture);
    // Each NUL escapes to \u0000 — six bytes — so the text is 4000 bytes
    // and the body over 24 KiB: legal text, body the door would refuse.
    await expectRefusedWithoutRequest(
      postRoomMessage({ clientMsgId: "b3f1c2", text: "\u0000".repeat(4000) }),
    );
  });

  test("a multibyte text well inside the cap goes out", async () => {
    installDoor(postFixture);
    const result = await postRoomMessage({
      clientMsgId: "b3f1c2",
      text: "ciao, ".repeat(500),
    });
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
      installDoor(postFixture);
      await expectRefusedWithoutRequest(postRoomMessage({ clientMsgId, text: "hello" }));
    },
  );

  test.each([
    ["one character", "!"],
    ["exactly 64 characters", "a".repeat(64)],
    ["the edges of the ASCII range", "!~"],
  ])("%s passes", async (_label, clientMsgId) => {
    installDoor(postFixture);
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
