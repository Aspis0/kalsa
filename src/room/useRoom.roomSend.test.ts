/**
 * The FIRST send after the room opens, through the real hook, queue,
 * subscriptions, stream and pairing store: the room reads, the wire
 * opens, the reader sends one message — and the row is visible while it
 * posts, the POST leaves once, and the ack's row replaces the shelf.
 * Only the network (the door's request fetch, the SSE wire) and the
 * storage (AsyncStorage, SecureStore) stand in; everything between them
 * is the app's own code.
 */
jest.mock("../remote/doorRoad", () => ({
  ...jest.requireActual("../remote/doorRoad"),
  establishDoorRoad: jest.fn(),
  doorFetchFor: jest.fn(),
}));
const stored: Record<string, string> = {};
let failNextQueueWriteAfterPersist = false;
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async (key: string) => stored[key] ?? null,
  setItem: async (key: string, value: string) => {
    stored[key] = value;
    if (failNextQueueWriteAfterPersist && key.startsWith("kalsa.roomqueue.")) {
      failNextQueueWriteAfterPersist = false;
      throw new Error("write acknowledgement lost");
    }
  },
  removeItem: async (key: string) => {
    delete stored[key];
  },
}));
const keystore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => keystore[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    keystore[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    delete keystore[key];
  },
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn(),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { getRandomBytes } from "expo-crypto";
import { doorFetchFor, establishDoorRoad, type DoorFetch } from "../remote/doorRoad";
import { savePairingCredential, listPairings } from "../pairing/pairingCredentialStore";
import { FakeRoomXhr, installFakeRoomXhr } from "../../test-support/fakeRoomXhr";
import { resetRoomEpochs } from "./roomEpochs";
import { roomQueueKey } from "./roomQueueStore";
import { useRoom, type RoomView } from "./useRoom";
import infoFixture from "./fixtures/info.json";
import historyFixture from "./fixtures/history.json";

const EPOCH = infoFixture.epoch;
const MINTED = "01".repeat(16);
/** One POST held in flight, released by the test: the sending state's window. */
let holdPost: ((ack: unknown) => void) | null = null;
const postBodies: Array<Record<string, unknown>> = [];

async function settle(): Promise<void> {
  // The lock → write → announce chains (queue and pairing alike) run deep.
  for (let i = 0; i < 500; i += 1) await Promise.resolve();
}

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

let minted = 0;

beforeEach(() => {
  jest.resetAllMocks();
  resetRoomEpochs();
  installFakeRoomXhr();
  minted = 0;
  failNextQueueWriteAfterPersist = false;
  holdPost = null;
  postBodies.length = 0;
  for (const key of Object.keys(stored)) delete stored[key];
  for (const key of Object.keys(keystore)) delete keystore[key];
  (getRandomBytes as unknown as jest.Mock).mockImplementation((length: number) => {
    const byte = (minted++ % 250) + 1;
    return new Uint8Array(length).fill(byte);
  });
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (doorFetchFor as jest.MockedFunction<typeof doorFetchFor>).mockReturnValue(
    jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.endsWith("/kalsa/room/messages")) {
        postBodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
        return await new Promise((resolve) => {
          holdPost = (ack: unknown) =>
            resolve({
              ok: true,
              status: 200,
              isBodyEmpty: async () => false,
              json: async () => ack,
            });
        });
      }
      return {
        ok: true,
        status: 200,
        isBodyEmpty: async () => false,
        json: async () => (url.endsWith("/kalsa/room/info") ? infoFixture : historyFixture),
      };
    }) as unknown as DoorFetch,
  );
});

let renderer: ReactTestRenderer | null = null;
let box: { current: RoomView | null };

const view = (): RoomView => {
  if (box.current === null) throw new Error("probe never rendered");
  return box.current;
};

/** The pairing saved as the ceremony does, the room open, the wire live. */
async function openRoom(): Promise<string> {
  await savePairingCredential(new Uint8Array(32).fill(0xab), "https://desk.example");
  const records = await listPairings();
  const localId = records[records.length - 1].localId;
  box = { current: null };
  const Probe = () => {
    box.current = useRoom(localId);
    return null;
  };
  await act(async () => {
    renderer = create(React.createElement(Probe));
  });
  await act(async () => {
    await settle();
  });
  // The wire the subscription dialed opens: the epoch answers, the stream
  // is live (its open is what flushes the shelf).
  FakeRoomXhr.latest().head(200, { "Kalsa-Room-Epoch": EPOCH });
  await act(async () => {
    await settle();
  });
  return localId;
}

afterEach(async () => {
  await act(async () => {
    try {
      renderer?.unmount();
    } catch {
      // already unmounted
    }
  });
  renderer = null;
});

test("the first send: a visible sending row at once, one POST, then the sent row", async () => {
  const localId = await openRoom();
  expect(view().feed.status).toBe("ready");
  expect(view().rows.map((row) => row.text)).toEqual(["dinner at eight?", "@Kalsa hi"]);
  expect(view().pending).toEqual([]);

  let accepted = false;
  await act(async () => {
    accepted = await view().send("ciao dalla Jelly", false);
  });
  await act(async () => {
    await settle();
  });

  // The words left the composer for the shelf: visible on their way out,
  // persisted under the room's key, and on the wire exactly once.
  expect(accepted).toBe(true);
  expect(view().pending.map((item) => [item.text, item.state])).toEqual([
    ["ciao dalla Jelly", "sending"],
  ]);
  expect(JSON.parse(stored[roomQueueKey(localId)])).toMatchObject({
    items: [expect.objectContaining({ clientMsgId: MINTED, state: "sending" })],
  });
  expect(postBodies).toEqual([
    { client_msg_id: MINTED, text: "ciao dalla Jelly", call_ai: false },
  ]);

  holdPost?.({ seq: 43, time: 1_791_000_043, ai_call: null, refusal: null });
  await act(async () => {
    await settle();
  });

  // The ack's row stands in the transcript; the shelf is empty.
  expect(view().pending).toEqual([]);
  expect(view().rows.at(-1)).toMatchObject({ seq: 43, text: "ciao dalla Jelly", own: true });
});

test("a write that lands before its rejection reuses the draft id on retry", async () => {
  const localId = await openRoom();
  failNextQueueWriteAfterPersist = true;

  let accepted = true;
  await act(async () => {
    accepted = await view().send("persist once despite the lost write ack", false);
  });
  expect(accepted).toBe(false);
  expect(view().sendErrorCode).toBe("unexpected");
  expect(JSON.parse(stored[roomQueueKey(localId)]).items).toHaveLength(1);

  await act(async () => {
    accepted = await view().send("persist once despite the lost write ack", false);
    await settle();
  });

  expect(accepted).toBe(true);
  expect(minted).toBe(1);
  expect(postBodies).toEqual([
    { client_msg_id: MINTED, text: "persist once despite the lost write ack", call_ai: false },
  ]);
  holdPost?.({ seq: 44, time: 1_791_000_044, ai_call: null, refusal: null });
  await act(async () => settle());
  expect(view().pending).toEqual([]);
});
