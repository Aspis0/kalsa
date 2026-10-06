/**
 * The hook's wiring: the reads fill the page, the stream folds into it
 * while it is up, a read that fails is the error state (a 401 the removed
 * one), a read that lost the race changes nothing, older pages are asked
 * for by cursor, a reload is the way out, and leaving unsubscribes both the
 * stream and the shelf and aborts the read in flight.
 */
jest.mock("./roomApi", () => ({
  fetchRoomInfo: jest.fn(),
  fetchRoomHistory: jest.fn(),
  putRoomName: jest.fn(),
  postRoomMessage: jest.fn(),
}));
jest.mock("./roomSubscriptions", () => ({ subscribeRoomEvents: jest.fn() }));
jest.mock("../pairing/pairingCredentialStore", () => ({ getPairing: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: jest.fn((length: number) => new Uint8Array(length).fill(0x7e)),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPairing } from "../pairing/pairingCredentialStore";
import { fetchRoomHistory, fetchRoomInfo } from "./roomApi";
import type { RoomStreamEvent } from "./roomStream";
import { subscribeRoomEvents } from "./roomSubscriptions";
import { clearRoomFeed } from "./roomFeedCache";
import { useRoom, type RoomView } from "./useRoom";
import { parseRoomInfo, type RoomHistoryMessage, type RoomInfo } from "./roomWire";
import infoFixture from "./fixtures/info.json";

const LOCAL = "p-lid-room";
const INFO: RoomInfo = parseRoomInfo(infoFixture) as RoomInfo;
const YOU = INFO.you;

// Save what we replace: a test that mutates the environment must put it back.
const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// react-test-renderer's own deprecation notice is noise on every run: this
// project ships no RN-flavoured renderer (the hydration test's rule).
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

function entry(seq: number, text = `m${seq}`): RoomHistoryMessage {
  return {
    seq,
    epoch: INFO.epoch,
    memberId: YOU,
    name: "Paired phone 2",
    time: 1_791_000_000 + seq,
    text,
    callAi: false,
    former: false,
  };
}

const infoOk = { ok: true as const, value: INFO };
const historyOk = { ok: true as const, value: { messages: [entry(1)], hasOlder: false, hasNewer: false } };

let listeners: Array<(event: RoomStreamEvent) => void>;
let leaves: jest.Mock[];

beforeEach(() => {
  clearRoomFeed(LOCAL);
  jest.clearAllMocks();
  listeners = [];
  leaves = [];
  (subscribeRoomEvents as jest.Mock).mockImplementation((_localId, listener) => {
    listeners.push(listener as (event: RoomStreamEvent) => void);
    const leave = jest.fn();
    leaves.push(leave);
    return leave;
  });
  (getPairing as jest.Mock).mockResolvedValue({
    localId: LOCAL,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
  });
  // mockReset, not just clearAllMocks: a once-queue a case left unconsumed
  // would otherwise answer the next case's first read.
  (fetchRoomInfo as jest.Mock).mockReset();
  (fetchRoomHistory as jest.Mock).mockReset();
  (fetchRoomInfo as jest.Mock).mockResolvedValue(infoOk);
  (fetchRoomHistory as jest.Mock).mockResolvedValue(historyOk);
});

/** The chain runs deep: the queue's own posts and announces are awaited. */
async function settle(): Promise<void> {
  for (let i = 0; i < 300; i += 1) await Promise.resolve();
}

describe("reading the room", () => {
  let renderer: ReactTestRenderer;
  let hook: { current: RoomView | null };

  const mount = async () => {
    const box = (hook = { current: null } as { current: RoomView | null });
    const Probe = () => {
      box.current = useRoom(LOCAL);
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    await settle();
  };

  const now = (): RoomView => {
    if (hook.current === null) throw new Error("probe never rendered");
    return hook.current;
  };

  afterEach(async () => {
    await act(async () => {
      try {
        renderer.unmount();
      } catch {
        // already unmounted
      }
    });
  });

  test("info and the newest history fill the page, then the stream folds in", async () => {
    await mount();
    expect(now().feed.status).toBe("ready");
    expect(now().feed.reconnecting).toBe(false);
    expect(now().rows.map((row) => row.text)).toEqual(["m1"]);
    expect((AsyncStorage as unknown as { getItem: jest.Mock }).getItem)
      .toHaveBeenCalledWith(`kalsa.roomqueue.${LOCAL}`);

    await act(async () => {
      listeners[0]({
        type: "message",
        entry: { ...entry(2, "on the wire"), memberId: 3, name: "Marco" },
      });
    });
    expect(now().rows.map((row) => row.text)).toEqual(["m1", "on the wire"]);

    // §7's resync is a new floor, not a merge.
    await act(async () => {
      listeners[0]({
        type: "resynced",
        info: INFO,
        history: { messages: [entry(9, "after the recovery")], hasOlder: false, hasNewer: false },
      });
    });
    expect(now().rows.map((row) => row.text)).toEqual(["after the recovery"]);
  });

  test("a cut wire is a reconnect banner, and a delivered entry ends it", async () => {
    await mount();
    await act(async () => {
      listeners[0]({ type: "disconnected" });
    });
    expect(now().feed.reconnecting).toBe(true);
    await act(async () => {
      listeners[0]({ type: "message", entry: entry(2) });
    });
    expect(now().feed.reconnecting).toBe(false);
  });

  test("a dead cached epoch (409) is read again, not shown as a failure", async () => {
    (fetchRoomInfo as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "epoch_changed",
        message: "The room's transcript restarted; drop what was cached and read it again.",
      },
    });
    await mount();
    expect(fetchRoomInfo).toHaveBeenCalledTimes(2);
    expect(now().feed.status).toBe("ready");
    expect(now().feed.error).toBeNull();
    expect(now().rows.map((row) => row.text)).toEqual(["m1"]);
  });

  test("a read that lands after the room removed this phone cannot bring it back", async () => {
    let release: (value: unknown) => void = () => undefined;
    (fetchRoomInfo as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await mount();
    expect(now().feed.info).toBeNull(); // the read is still out

    await act(async () => {
      listeners[0]({ type: "removed" });
    });
    expect(now().feed.status).toBe("removed");

    await act(async () => {
      release(infoOk);
    });
    await settle();
    expect(now().feed.status).toBe("removed");
    expect(now().feed.info).toBeNull();
  });

  test("loadOlder asks for the page before the floor and merges overlapping pages once", async () => {
    (fetchRoomHistory as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [entry(11, "newer"), entry(12)], hasOlder: true, hasNewer: false },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [entry(9, "older"), entry(10)], hasOlder: true, hasNewer: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [entry(8), entry(9, "older")], hasOlder: false, hasNewer: true },
      });
    await mount();
    expect(now().rows.map((row) => row.seq)).toEqual([11, 12]);
    expect(now().feed.hasOlder).toBe(true);

    await act(async () => {
      await now().loadOlder();
    });
    expect(fetchRoomHistory).toHaveBeenLastCalledWith(
      { before: 11, limit: 200 },
      { roomLocalId: LOCAL },
    );
    expect(now().rows.map((row) => row.seq)).toEqual([9, 10, 11, 12]);
    expect(now().loadingOlder).toBe(false);
    expect(now().pageErrorCode).toBeNull();

    // The floor moved down with the page, so the second cursor is the new
    // floor; a page that overlaps what the reader holds adds no row, and
    // the room's oldest page ends the paging.
    await act(async () => {
      await now().loadOlder();
    });
    expect(fetchRoomHistory).toHaveBeenLastCalledWith(
      { before: 9, limit: 200 },
      { roomLocalId: LOCAL },
    );
    expect(now().rows.map((row) => row.seq)).toEqual([8, 9, 10, 11, 12]);
    expect(now().feed.hasOlder).toBe(false);
  });

  test("a page that would not load is a sentence, and the same tap retries", async () => {
    (fetchRoomHistory as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [entry(1)], hasOlder: true, hasNewer: false },
      })
      .mockResolvedValueOnce({ ok: false, error: { code: "unreachable", message: "network" } })
      .mockResolvedValueOnce({
        ok: true,
        value: { messages: [entry(0)], hasOlder: false, hasNewer: true },
      });
    await mount();
    await act(async () => {
      await now().loadOlder();
    });
    expect(now().pageErrorCode).toBe("unreachable");
    expect(now().feed.hasOlder).toBe(true); // nothing was lost

    await act(async () => {
      await now().loadOlder();
    });
    expect(now().pageErrorCode).toBeNull();
    expect(now().rows.map((row) => row.seq)).toEqual([0, 1]);
  });

  test("a read the room keeps refusing with epoch_changed stops after one retry", async () => {
    (fetchRoomInfo as jest.Mock).mockReset();
    (fetchRoomInfo as jest.Mock).mockResolvedValue({
      ok: false,
      error: {
        code: "epoch_changed",
        message: "The room's transcript restarted; drop what was cached and read it again.",
      },
    });
    await mount();
    // roomApi forgets the epoch on the first 409, so the second read goes bare
    // and learns the new one; a third answer of the same kind is the error
    // state's, never another read.
    expect(fetchRoomInfo).toHaveBeenCalledTimes(2);
    expect(now().feed.status).toBe("error");
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchRoomInfo).toHaveBeenCalledTimes(2);
  });

  test("a read that fails is the error state; a reload is the way out", async () => {
    (fetchRoomInfo as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: { code: "unreachable", message: "remote_brain_network" },
    });
    await mount();
    expect(now().feed.status).toBe("error");
    expect(now().feed.error?.code).toBe("unreachable");

    await act(async () => {
      now().reload();
    });
    await settle();
    expect(now().feed.status).toBe("ready");
    expect(now().rows.map((row) => row.text)).toEqual(["m1"]);
  });

  test("the room's 401, on the read or on the wire, is the removed state", async () => {
    (fetchRoomInfo as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: { code: "removed", message: "This phone is no longer a member of the room." },
    });
    await mount();
    expect(now().feed.status).toBe("removed");

    await act(async () => {
      listeners[0]({ type: "removed" });
    });
    expect(now().feed.status).toBe("removed");
  });

  test("leaving unsubscribes both listeners and aborts the read in flight", async () => {
    await mount();
    const signal = (fetchRoomInfo as jest.Mock).mock.calls[0][0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
    expect(leaves[0]).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);

    // A frame that arrives after the screen is gone sets no state: the last
    // view the probe saw is the same object it saw before.
    const before = now();
    await act(async () => {
      listeners[0]({ type: "message", entry: entry(5) });
    });
    expect(now()).toBe(before);
  });
});
