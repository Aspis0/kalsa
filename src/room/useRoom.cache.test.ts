/** A remounted RoomScreen keeps its pairing's feed until a snapshot or removal settles. */
jest.mock("./roomApi", () => ({ fetchRoomInfo: jest.fn(), fetchRoomHistory: jest.fn() }));
jest.mock("./roomSubscriptions", () => ({ subscribeRoomEvents: jest.fn() }));
jest.mock("./roomQueue", () => ({
  discardRoomQueueItem: jest.fn(),
  createRoomClientMsgId: jest.fn(),
  enqueueRoomMessage: jest.fn(),
  getRoomQueue: jest.fn(async () => []),
  retryRoomQueueItem: jest.fn(),
  subscribeRoomQueue: jest.fn(() => () => undefined),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { fetchRoomHistory, fetchRoomInfo } from "./roomApi";
import { subscribeRoomEvents } from "./roomSubscriptions";
import { useRoom, type RoomView } from "./useRoom";
import infoFixture from "./fixtures/info.json";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";

let localId = "p-lid-room-cache";
const INFO = parseRoomInfo(infoFixture) as RoomInfo;

function entry(seq: number, epoch = INFO.epoch, text = `m${seq}`): RoomHistoryMessage {
  return {
    seq,
    epoch,
    memberId: INFO.you,
    name: "Paired phone 2",
    time: 1_791_000_000 + seq,
    text,
    callAi: false,
    former: false,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let listeners: Array<(event: { type: string }) => void>;
let renderer: ReactTestRenderer;
let view: RoomView | null;
let nextLocalId = 0;

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

async function mount(): Promise<void> {
  const Probe = () => {
    view = useRoom(localId);
    return null;
  };
  await act(async () => {
    renderer = create(React.createElement(Probe));
    await settle();
  });
}

async function unmount(): Promise<void> {
  await act(async () => renderer.unmount());
}

beforeEach(() => {
  localId = `p-lid-room-cache-${nextLocalId++}`;
  listeners = [];
  view = null;
  (fetchRoomInfo as jest.Mock).mockReset();
  (fetchRoomHistory as jest.Mock).mockReset();
  (fetchRoomInfo as jest.Mock).mockResolvedValue({ ok: true, value: INFO });
  (fetchRoomHistory as jest.Mock).mockResolvedValue({
    ok: true,
    value: { messages: [entry(1)], hasOlder: false, hasNewer: false },
  });
  (subscribeRoomEvents as jest.Mock).mockImplementation((_id, listener) => {
    listeners.push(listener);
    return () => undefined;
  });
});

afterEach(async () => {
  if (renderer) await unmount();
});

test("a remount keeps the last rows visible until its same-epoch read finishes", async () => {
  await mount();
  expect(view?.rows.map((row) => row.text)).toEqual(["m1"]);
  await unmount();

  const info = deferred<{ ok: true; value: RoomInfo }>();
  const history = deferred<{
    ok: true;
    value: { messages: RoomHistoryMessage[]; hasOlder: boolean; hasNewer: boolean };
  }>();
  (fetchRoomInfo as jest.Mock).mockReturnValueOnce(info.promise);
  (fetchRoomHistory as jest.Mock).mockReturnValueOnce(history.promise);
  await mount();
  expect(view?.rows.map((row) => row.text)).toEqual(["m1"]);

  await act(async () => {
    info.resolve({ ok: true, value: INFO });
    await settle();
    history.resolve({
      ok: true,
      value: { messages: [entry(2, INFO.epoch, "fresh")], hasOlder: false, hasNewer: false },
    });
    await settle();
  });
  expect(view?.rows.map((row) => row.text)).toEqual(["m1", "fresh"]);
});

test("a new-epoch snapshot replaces cached rows after it arrives", async () => {
  await mount();
  await unmount();

  const nextInfo = { ...INFO, epoch: "e-next" };
  const info = deferred<{ ok: true; value: RoomInfo }>();
  const history = deferred<{
    ok: true;
    value: { messages: RoomHistoryMessage[]; hasOlder: boolean; hasNewer: boolean };
  }>();
  (fetchRoomInfo as jest.Mock).mockReturnValueOnce(info.promise);
  (fetchRoomHistory as jest.Mock).mockReturnValueOnce(history.promise);
  await mount();
  expect(view?.rows.map((row) => row.text)).toEqual(["m1"]);

  await act(async () => {
    info.resolve({ ok: true, value: nextInfo });
    await settle();
    history.resolve({
      ok: true,
      value: { messages: [entry(1, "e-next", "new epoch")], hasOlder: false, hasNewer: false },
    });
    await settle();
  });
  expect(view?.feed.epoch).toBe("e-next");
  expect(view?.rows.map((row) => row.text)).toEqual(["new epoch"]);
});

test("a removed pairing clears its cached rows", async () => {
  await mount();
  await act(async () => {
    listeners[0]({ type: "removed" });
  });
  await unmount();

  const info = deferred<{ ok: true; value: RoomInfo }>();
  (fetchRoomInfo as jest.Mock).mockReturnValueOnce(info.promise);
  await mount();
  expect(view?.rows).toEqual([]);
});
