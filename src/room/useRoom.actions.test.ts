/**
 * The hook's actions: naming (the room's yes recolors the rows, its
 * refusal is carried for the form), posting (the queue posts, the ack's row
 * shows once, a local refusal keeps the words unsent), and the two things a
 * waiting message can be told — retry and discard.
 */
jest.mock("./roomApi", () => ({
  fetchRoomInfo: jest.fn(),
  fetchRoomHistory: jest.fn(),
  putRoomName: jest.fn(),
  postRoomMessage: jest.fn(),
}));
jest.mock("./roomSubscriptions", () => ({ subscribeRoomEvents: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({ getPairing: jest.fn() }));
const stored: Record<string, string> = {};
/** The shelf object behind the mock: a test may bend one read and put it back. */
let mockShelf: {
  getItem: (key: string) => Promise<string | null>;
} | null = null;
jest.mock("@react-native-async-storage/async-storage", () => {
  const shelf = {
    getItem: async (key: string) => stored[key] ?? null,
    setItem: async (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: async (key: string) => {
      delete stored[key];
    },
  };
  mockShelf = shelf;
  return shelf;
});
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((length: number) => new Uint8Array(length).fill(0x7e)),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { getPairing } from "../pairing/pairingCredentialStore";
import { fetchRoomHistory, fetchRoomInfo, postRoomMessage, putRoomName } from "./roomApi";
import { subscribeRoomEvents } from "./roomSubscriptions";
import { useRoom, type RoomView } from "./useRoom";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";
import infoFixture from "./fixtures/info.json";

const LOCAL = "p-lid-room-actions";
const INFO: RoomInfo = parseRoomInfo(infoFixture) as RoomInfo;
const YOU = INFO.you;
const MINTED_ID = "7e".repeat(16);

// Save what we replace: a test that mutates the environment must put it back.
const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const realError = console.error;
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("react-test-renderer is deprecated")) {
      return;
    }
    realError(...args);
  });
});

afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    previousActEnvironment;
  jest.restoreAllMocks();
});

function entry(seq: number, text: string, memberId = YOU, name = "Paired phone 2"): RoomHistoryMessage {
  return {
    seq,
    epoch: INFO.epoch,
    memberId,
    name,
    time: 1_791_000_000 + seq,
    text,
    callAi: false,
    former: false,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 300; i += 1) await Promise.resolve();
}

let renderer: ReactTestRenderer;
let hook: { current: RoomView | null };

const now = (): RoomView => {
  if (hook.current === null) throw new Error("probe never rendered");
  return hook.current;
};

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(stored)) delete stored[key];
  (subscribeRoomEvents as jest.Mock).mockImplementation(() => jest.fn());
  (getPairing as jest.Mock).mockResolvedValue({
    localId: LOCAL,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
  });
  (fetchRoomInfo as jest.Mock).mockResolvedValue({ ok: true, value: INFO });
  (fetchRoomHistory as jest.Mock).mockResolvedValue({
    ok: true,
    value: { messages: [entry(1, "the room so far")], hasOlder: false, hasNewer: false },
  });
  const box = (hook = { current: null } as { current: RoomView | null });
  const Probe = () => {
    box.current = useRoom(LOCAL);
    return null;
  };
  await act(async () => {
    renderer = create(React.createElement(Probe));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => {
    try {
      renderer.unmount();
    } catch {
      // already unmounted
    }
  });
});

test("a name the room accepts recolors the member list and the rows held", async () => {
  (putRoomName as jest.Mock).mockResolvedValue({
    ok: true,
    value: { memberId: YOU, name: "Marco" },
  });
  await act(async () => {
    await now().setName("Marco");
  });
  expect(putRoomName).toHaveBeenCalledWith("Marco", { roomLocalId: LOCAL });
  expect(now().nameErrorCode).toBeNull();
  expect(now().feed.info?.members.find((member) => member.memberId === YOU)?.name).toBe("Marco");
  expect(now().rows.map((row) => row.name)).toEqual(["Marco"]);
});

test("a refused name is carried as its code, and the old name stands", async () => {
  (putRoomName as jest.Mock).mockResolvedValue({
    ok: false,
    error: {
      code: "name_taken",
      message: "Someone in this room already uses that name. Pick another.",
    },
  });
  await act(async () => {
    await now().setName("Marco");
  });
  expect(now().nameErrorCode).toBe("name_taken");
  expect(now().feed.info?.members.find((member) => member.memberId === YOU)?.name).toBe(
    "Paired phone 2",
  );
});

test("posting rides the queue: the ack's row shows once, and the shelf empties", async () => {
  (postRoomMessage as jest.Mock).mockResolvedValue({
    ok: true,
    value: { seq: 42, time: 1_791_000_042, aiCall: null, refusal: null },
  });
  await act(async () => {
    await now().send("  dinner at eight?  ", false);
  });
  await settle();
  expect(postRoomMessage).toHaveBeenCalledWith(
    { clientMsgId: MINTED_ID, text: "dinner at eight?", callAi: false },
    { roomLocalId: LOCAL },
  );
  expect(now().rows.map((row) => [row.seq, row.text, row.own])).toEqual([
    [1, "the room so far", true],
    [42, "dinner at eight?", true],
  ]);
  expect(now().pending).toEqual([]);
  expect(now().sendErrorCode).toBeNull();
});

test("the Ask Kalsa toggle rides the post as call_ai", async () => {
  (postRoomMessage as jest.Mock).mockResolvedValue({
    ok: true,
    value: { seq: 43, time: 1_791_000_043, aiCall: "queued", refusal: null },
  });
  await act(async () => {
    await now().send("@Kalsa what time is it?", true);
  });
  await settle();
  expect((postRoomMessage as jest.Mock).mock.calls[0][0].callAi).toBe(true);
});

test("a compose the shelf refuses is a code, with nothing stored", async () => {
  let sent = true;
  await act(async () => {
    sent = await now().send("x".repeat(8001), false);
  });
  expect(sent).toBe(false);
  expect(now().sendErrorCode).toBe("invalid_input");
  expect(now().pending).toEqual([]);
  expect(postRoomMessage).not.toHaveBeenCalled();
  // A bare "@" names nobody: nothing to post at all.
  let named = true;
  await act(async () => {
    named = await now().send("@", true);
  });
  expect(named).toBe(false);
  expect(now().pending).toEqual([]);
});

test("a shelf that throws instead of answering is a code, never a silent clear", async () => {
  if (mockShelf === null) throw new Error("shelf mock never built");
  const read = mockShelf.getItem;
  mockShelf.getItem = async () => {
    throw new Error("rkstorage down");
  };
  try {
    let sent = true;
    await act(async () => {
      sent = await now().send("words the shelf cannot hold", false);
    });
    expect(sent).toBe(false);
    expect(now().sendErrorCode).toBe("unexpected");
    expect(now().pending).toEqual([]);
    expect(postRoomMessage).not.toHaveBeenCalled();
  } finally {
    mockShelf.getItem = read;
  }
});

test("a message the room refused terminally waits, and can be retried or dropped", async () => {
  (postRoomMessage as jest.Mock).mockResolvedValueOnce({
    ok: false,
    error: { code: "too_large", message: "The message or name is too long." },
  });
  await act(async () => {
    await now().send("one word too many", false);
  });
  await settle();
  expect(now().pending).toEqual([
    expect.objectContaining({ clientMsgId: MINTED_ID, state: "failed", errorCode: "too_large" }),
  ]);

  (postRoomMessage as jest.Mock).mockResolvedValueOnce({
    ok: true,
    value: { seq: 44, time: 1_791_000_044, aiCall: null, refusal: null },
  });
  await act(async () => {
    await now().retry(MINTED_ID);
  });
  await settle();
  const attempts = (postRoomMessage as jest.Mock).mock.calls.map(
    (call) => (call as unknown[])[0] as { clientMsgId: string },
  );
  expect(attempts.map((attempt) => attempt.clientMsgId)).toEqual([MINTED_ID, MINTED_ID]);
  expect(now().rows.map((row) => row.text)).toEqual(["the room so far", "one word too many"]);
  expect(now().pending).toEqual([]);
});

test("discard drops a waiting message for good", async () => {
  (postRoomMessage as jest.Mock).mockResolvedValue({
    ok: false,
    error: { code: "too_large", message: "The message or name is too long." },
  });
  await act(async () => {
    await now().send("never mind", false);
  });
  await settle();
  expect(now().pending).toHaveLength(1);
  await act(async () => {
    await now().discard(MINTED_ID);
  });
  await settle();
  expect(now().pending).toEqual([]);
  expect(now().rows.map((row) => row.text)).toEqual(["the room so far"]);
});
