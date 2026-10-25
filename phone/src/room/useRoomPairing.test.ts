/**
 * The one Room entry's own question: which pairing it opens. The newest
 * record the room has not refused wins (the map keeps no last-used stamp),
 * a completed pairing is picked up without a restart, a room refusing this
 * phone (401) takes its entry away again, and a store that cannot be read
 * holds no room at all.
 */
jest.mock("../pairing/pairingCredentialStore", () => ({
  listPairings: jest.fn(),
  subscribePairingRemoved: jest.fn(),
}));
jest.mock("./roomApi", () => ({ fetchRoomInfo: jest.fn() }));
jest.mock("../pairing/pairingCompletedAt", () => ({ subscribePairingCompleted: jest.fn() }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import { listPairings, subscribePairingRemoved } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";
import { fetchRoomInfo } from "./roomApi";
import { pickRoomPairing, useRoomPairing } from "./useRoomPairing";

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

function record(localId: string, removed = false): PairingRecord {
  return {
    localId,
    credential: "ab".repeat(32),
    doorUrl: "https://desk.example",
    node: null,
    pairedVia: null,
    roomId: null,
    ...(removed ? { removed: true } : {}),
  };
}

describe("pickRoomPairing", () => {
  test("takes the newest record, skips the refused ones, and gives up when none is left", () => {
    expect(pickRoomPairing([])).toBeNull();
    expect(pickRoomPairing([record("p1"), record("p2")])?.localId).toBe("p2");
    expect(pickRoomPairing([record("p1"), record("p2", true)])?.localId).toBe("p1");
    expect(pickRoomPairing([record("p1", true), record("p2", true)])).toBeNull();
  });
});

describe("useRoomPairing", () => {
  let renderer: ReactTestRenderer;
  let hook: { current: { localId: string | null } | null } = { current: null };
  let completions: Array<() => void>;
  let removals: Array<() => void>;

  /** The menu's own open flag: a case may flip it on the same instance. */
  let openFlag = true;
  let box: { current: { localId: string | null } | null } = { current: null };

  const Probe = () => {
    box.current = useRoomPairing(openFlag);
    return null;
  };

  async function mount(open: boolean): Promise<void> {
    // Listeners belong to the mount that made them: the arrays index the
    // live menu, not every mount this file ever ran.
    completions = [];
    removals = [];
    openFlag = open;
    box = { current: null };
    hook = box;
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    await act(async () => undefined);
  }

  /** Close or reopen the SAME instance: the hook must not carry an answer
   *  across the menu's own open/close. */
  async function setOpen(open: boolean): Promise<void> {
    // The effect run that is leaving takes its listeners with it.
    completions = [];
    removals = [];
    openFlag = open;
    await act(async () => {
      renderer.update(React.createElement(Probe));
    });
    await act(async () => undefined);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    completions = [];
    removals = [];
    (subscribePairingCompleted as jest.Mock).mockImplementation((listener: () => void) => {
      completions.push(listener);
      return jest.fn();
    });
    (subscribePairingRemoved as jest.Mock).mockImplementation((listener: () => void) => {
      removals.push(listener);
      return jest.fn();
    });
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2")]);
    (fetchRoomInfo as jest.Mock).mockResolvedValue({
      ok: true,
      value: { roomName: "This computer", roomId: "r1", epoch: "e1", you: 3, members: [], ai: {} },
    });
    await mount(true);
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

  const now = (): { localId: string | null } => {
    if (hook.current === null) throw new Error("probe never rendered");
    return hook.current;
  };

  test("the newest pairing is the room, and a completed pairing takes over", async () => {
    expect(now().localId).toBe("p2");
    expect(fetchRoomInfo).toHaveBeenCalledTimes(1);
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2"), record("p3")]);
    await act(async () => {
      completions[0]();
    });
    expect(now().localId).toBe("p3");
  });

  test("a closed menu asks nothing, and closing drops the entry it showed", async () => {
    expect(now().localId).toBe("p2");

    await setOpen(false);
    expect(now().localId).toBeNull();
    (listPairings as jest.Mock).mockClear();
    (fetchRoomInfo as jest.Mock).mockClear();
    await act(async () => undefined);
    expect(listPairings).not.toHaveBeenCalled();
    expect(fetchRoomInfo).not.toHaveBeenCalled();

    // Reopen with a probe that answers LATER: nothing is offered until it
    // does — never the entry the previous open had verified.
    let release: (value: unknown) => void = () => undefined;
    (fetchRoomInfo as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await setOpen(true);
    expect(now().localId).toBeNull();
    await act(async () => {
      release({
        ok: true,
        value: { roomName: "This computer", roomId: "r1", epoch: "e1", you: 3, members: [], ai: {} },
      });
    });
    expect(now().localId).toBe("p2");
  });

  test("an older probe can never overwrite a newer one", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    (fetchRoomInfo as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    // The open probes p2; the completion's ask supersedes it with p3.
    await setOpen(false);
    await setOpen(true);
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2"), record("p3")]);
    await act(async () => {
      completions[0]();
    });
    expect(resolvers).toHaveLength(2);

    // The newer answer lands…
    await act(async () => {
      resolvers[1]({
        ok: true,
        value: { roomName: "This computer", roomId: "r1", epoch: "e1", you: 3, members: [], ai: {} },
      });
    });
    expect(now().localId).toBe("p3");

    // …and the older one, arriving after it, is ignored — even a refusal
    // from it cannot take the newer answer away.
    await act(async () => {
      resolvers[0]({ ok: false, error: { code: "unreachable", message: "remote_brain_network" } });
    });
    expect(now().localId).toBe("p3");
  });

  test("closing the menu aborts the probe, and its late answer is not accepted", async () => {
    let release: (value: unknown) => void = () => undefined;
    (fetchRoomInfo as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await setOpen(false);
    await setOpen(true);
    const calls = (fetchRoomInfo as jest.Mock).mock.calls;
    const signal = calls[calls.length - 1][0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await setOpen(false);
    expect(signal.aborted).toBe(true);

    // The probe answers after the menu is gone: the hook takes nothing.
    await act(async () => {
      release({
        ok: true,
        value: { roomName: "This computer", roomId: "r1", epoch: "e1", you: 3, members: [], ai: {} },
      });
    });
    expect(now().localId).toBeNull();
  });

  test("a room that does not answer is not offered: one probe, and the entry is gone", async () => {
    expect(now().localId).toBe("p2");
    expect(fetchRoomInfo).toHaveBeenCalledTimes(1);
    expect((fetchRoomInfo as jest.Mock).mock.calls[0][0]).toMatchObject({
      roomLocalId: "p2",
    });

    // The computer is off (or its road is gone): the same open, the same
    // question, and this time the entry stays hidden.
    await act(async () => renderer.unmount());
    (fetchRoomInfo as jest.Mock).mockResolvedValue({
      ok: false,
      error: { code: "unreachable", message: "remote_brain_network" },
    });
    await mount(true);
    expect(now().localId).toBeNull();
  });

  test("the room's own 401 hides the entry — the mark then hides it for good", async () => {
    await act(async () => renderer.unmount());
    // Only the newest computer refuses this phone: its own 401, and the one
    // the door answers for the older record is fine.
    (fetchRoomInfo as jest.Mock).mockImplementation((options: { roomLocalId: string }) =>
      Promise.resolve(
        options.roomLocalId === "p2"
          ? {
              ok: false,
              error: { code: "removed", message: "This phone is no longer a member of the room." },
            }
          : { ok: true, value: { roomName: "This computer", roomId: "r1", epoch: "e1", you: 3, members: [], ai: {} } },
      ),
    );
    await mount(true);
    expect(now().localId).toBeNull();
    // roomApi marked p2 on that 401; the store's notice re-asks, and the
    // refused computer is not offered again — the older one is.
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2", true)]);
    await act(async () => {
      removals[0]();
    });
    expect(now().localId).toBe("p1");
  });

  test("a room that refused this phone takes its entry away", async () => {
    expect(now().localId).toBe("p2");
    // The room answered 401 and the record was marked: the drawer must stop
    // offering that computer, without a restart.
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2", true)]);
    await act(async () => {
      removals[0]();
    });
    expect(now().localId).toBe("p1");

    (listPairings as jest.Mock).mockResolvedValue([record("p1", true), record("p2", true)]);
    await act(async () => {
      completions[0]();
    });
    expect(now().localId).toBeNull();
  });

  test("a pairing the room refused, or a store that cannot be read, holds no room", async () => {
    (listPairings as jest.Mock).mockResolvedValue([record("p1", true), record("p2", true)]);
    await act(async () => {
      completions[0]();
    });
    expect(now().localId).toBeNull();

    (listPairings as jest.Mock).mockRejectedValue(new Error("pairing map damaged"));
    await act(async () => {
      completions[0]();
    });
    expect(now().localId).toBeNull();
  });
});
