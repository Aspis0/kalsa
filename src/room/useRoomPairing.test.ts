/**
 * The one Room entry's own question: which pairing it opens. The newest
 * record the room has not refused wins (the map keeps no last-used stamp),
 * a completed pairing is picked up without a restart, and a store that
 * cannot be read holds no room at all.
 */
jest.mock("../pairing/pairingCredentialStore", () => ({ listPairings: jest.fn() }));
jest.mock("../pairing/pairingCompletedAt", () => ({ subscribePairingCompleted: jest.fn() }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import { listPairings } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";
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

  beforeEach(async () => {
    jest.clearAllMocks();
    completions = [];
    (subscribePairingCompleted as jest.Mock).mockImplementation((listener: () => void) => {
      completions.push(listener);
      return jest.fn();
    });
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2")]);
    const box = (hook = { current: null } as { current: { localId: string | null } | null });
    const Probe = () => {
      box.current = useRoomPairing();
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    await act(async () => undefined);
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
    (listPairings as jest.Mock).mockResolvedValue([record("p1"), record("p2"), record("p3")]);
    await act(async () => {
      completions[0]();
    });
    expect(now().localId).toBe("p3");
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
