/**
 * The lifecycle hook: background closes every room stream (RN would stop
 * its timers anyway — the stream clears its own rather than relying on
 * them) and active reopens each with the Last-Event-ID it kept. The
 * AppState source injects, so no test — and no import — ever loads
 * react-native.
 */
jest.mock("../remote/doorRoad", () => ({ establishDoorRoad: jest.fn(), doorFetchFor: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
  getPairing: jest.fn(),
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));
jest.mock("../engine/remote/remoteSecret", () => ({ getRemoteBrainToken: jest.fn() }));

import { establishDoorRoad } from "../remote/doorRoad";
import {
  bindPairingRoom,
  getPairing,
  getPairingCredential,
  markPairingRemoved,
} from "../pairing/pairingCredentialStore";
import { bindRoomStreamsToAppState, type AppStateSource } from "./roomAppState";
import { FakeRoomXhr, installFakeRoomXhr } from "./fakeRoomXhr";
import { subscribeRoomEvents } from "./roomSubscriptions";

const EPOCH = "e-life-1";

function entryFrame(seq: number): string {
  const entry = {
    seq,
    epoch: EPOCH,
    member_id: 3,
    name: "Marco",
    time: 1791000000 + seq,
    text: `m${seq}`,
    call_ai: false,
  };
  return `id: ${seq}\nevent: message\ndata: ${JSON.stringify(entry)}\n\n`;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function fakeAppState(): { source: AppStateSource; listener: (state: string) => void; remove: jest.Mock } {
  let captured: ((state: string) => void) | null = null;
  const remove = jest.fn();
  const source: AppStateSource = {
    addEventListener: (_type, handler) => {
      captured = handler;
      return { remove };
    },
  };
  return {
    source,
    listener: (state: string) => captured?.(state),
    remove,
  };
}

let randomSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  installFakeRoomXhr();
  jest.resetAllMocks();
  randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
  (establishDoorRoad as jest.MockedFunction<typeof establishDoorRoad>).mockResolvedValue({
    road: "https",
  });
  (getPairing as jest.MockedFunction<typeof getPairing>).mockResolvedValue({
    localId: "p-lid-life",
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
  });
  (getPairingCredential as jest.MockedFunction<typeof getPairingCredential>).mockResolvedValue(null);
  (bindPairingRoom as jest.MockedFunction<typeof bindPairingRoom>).mockResolvedValue([]);
  (markPairingRemoved as jest.MockedFunction<typeof markPairingRemoved>).mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  randomSpy.mockRestore();
  jest.useRealTimers();
});

test("background pauses the stream, active reopens it with its cursor, unhooking removes the listener", async () => {
  const app = fakeAppState();
  const unbind = bindRoomStreamsToAppState(app.source);
  const leave = subscribeRoomEvents("p-lid-life", () => undefined);
  await settle();
  const wire = FakeRoomXhr.latest();
  wire.head(200, { "Kalsa-Room-Epoch": EPOCH });
  wire.chunk(entryFrame(7));

  app.listener("inactive"); // iOS's transition: nothing moves
  expect(wire.aborted).toBe(false);

  app.listener("background");
  expect(wire.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(FakeRoomXhr.instances).toHaveLength(1);

  app.listener("active");
  await settle();
  const redial = FakeRoomXhr.latest();
  expect(redial).not.toBe(wire);
  expect(redial.requestHeaders["Last-Event-ID"]).toBe("7");
  expect(redial.requestHeaders["Kalsa-Room-Epoch"]).toBe(EPOCH);

  unbind();
  expect(app.remove).toHaveBeenCalledTimes(1);
  leave();
});
