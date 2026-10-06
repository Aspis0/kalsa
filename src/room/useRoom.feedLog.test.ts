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
import { act, create } from "react-test-renderer";
import { fetchRoomHistory, fetchRoomInfo } from "./roomApi";
import { subscribeRoomEvents } from "./roomSubscriptions";
import { useRoom } from "./useRoom";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";
import type { RoomStreamEvent } from "./roomStream";
import infoFixture from "./fixtures/info.json";

const INFO = parseRoomInfo(infoFixture) as RoomInfo;
const events: Array<(event: RoomStreamEvent) => void> = [];
const lines: string[] = [];

class CatchBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? React.createElement("caught") : this.props.children;
  }
}

function entry(seq: number, text: string): RoomHistoryMessage {
  return {
    seq,
    epoch: INFO.epoch,
    memberId: INFO.you,
    name: "Private name",
    time: 1_791_000_000 + seq,
    text,
    callAi: false,
    former: false,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

beforeEach(() => {
  events.length = 0;
  lines.length = 0;
  jest.clearAllMocks();
  (fetchRoomInfo as jest.Mock).mockResolvedValue({ ok: true, value: INFO });
  (fetchRoomHistory as jest.Mock).mockResolvedValue({
    ok: true,
    value: { messages: [entry(1, "secret body")], hasOlder: false, hasNewer: false },
  });
  (subscribeRoomEvents as jest.Mock).mockImplementation((_id, listener) => {
    events.push(listener as (event: RoomStreamEvent) => void);
    return () => undefined;
  });
  jest.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
});

afterEach(() => jest.restoreAllMocks());

test("logs count and epoch transitions without message text or names", async () => {
  const Probe = () => {
    useRoom("p-lid-feed-log");
    return null;
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(Probe));
    await settle();
  });

  const beforeInfo = lines.length;
  await act(async () => {
    events[0]({ type: "refetched", info: INFO });
  });
  expect(lines).toHaveLength(beforeInfo);

  await act(async () => {
    events[0]({
      type: "resynced",
      info: INFO,
      history: {
        messages: [entry(9, "secret replacement")],
        hasOlder: false,
        hasNewer: false,
      },
    });
  });
  await act(async () => {
    events[0]({ type: "message", entry: entry(10, "another secret body") });
  });
  const records = lines
    .filter((line) => line.startsWith("KALSA_ROOM_FEED "))
    .map((line) => JSON.parse(line.slice("KALSA_ROOM_FEED ".length)) as Record<string, unknown>);
  expect(records.map((record) => [record.op, record.entries])).toEqual([
    ["mount", 0],
    ["read", 1],
    ["resync", 1],
    ["entry", 2],
  ]);
  expect(records.map((record) => [record.seqFirst, record.seqLast])).toEqual([
    [-1, -1],
    [1, 1],
    [9, 9],
    [9, 10],
  ]);
  expect(records[1]).toMatchObject({ epoch8: INFO.epoch.slice(0, 8), status: "ready" });
  expect(lines.join("\n")).not.toContain("secret");
  expect(lines.join("\n")).not.toContain("Private name");
  await act(async () => renderer.unmount());
});

test("a fold error is diagnosed without details and reaches the React boundary", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const Probe = () => {
    useRoom("p-lid-feed-log-error");
    return null;
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      React.createElement(CatchBoundary, null, React.createElement(Probe)),
    );
    await settle();
  });

  await act(async () => {
    events[0]({
      type: "resynced",
      info: INFO,
      history: { hasOlder: false, hasNewer: false },
    } as unknown as RoomStreamEvent);
  });
  expect(renderer.toJSON()).toMatchObject({ type: "caught" });
  const failure = lines.find((line) => line.startsWith("KALSA_ROOM_FEED ") && line.includes('"op":"error"'));
  expect(failure).toBeDefined();
  expect(failure).not.toContain("messages");
  expect(failure).not.toContain("Private name");
  await act(async () => renderer.unmount());
});
