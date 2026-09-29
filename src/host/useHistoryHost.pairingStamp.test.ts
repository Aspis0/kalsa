/**
 * The live half of the stale-pairing rule: when a pairing completes, the
 * OPEN conversation's message list is re-marked without any reload —
 * returning from the pairing screen never re-runs the history load (the
 * conversation did not change) — and a completion that lands WHILE a
 * load is still in flight is folded into the install, not lost to it.
 * This mounts the real hook over mocked storage and drives the same
 * notification PairingScreen fires.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: async (key: string) => store[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      store[key] = value;
    },
    __reset: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { markPairingCompleted } from "../pairing/pairingCompletedAt";
import { useHistoryHost } from "./useHistoryHost";
import type { Message } from "./hostMessage";

const secureStore = jest.requireMock("expo-secure-store") as {
  __reset: () => void;
};
const storage = (
  jest.requireMock("@react-native-async-storage/async-storage") as {
    default: jest.Mocked<typeof AsyncStorage>;
  }
).default;

const STAMP = 1_700_000_100_000;

function liveMessages(): { messages: Message[] } {
  return {
    messages: [
      // An old remote failure: must flip to stale when the pairing lands.
      {
        id: "a1",
        role: "assistant",
        text: "⚠️ Could not reach your computer.",
        createdAt: STAMP - 1,
        failed: true,
        failureSource: "remote",
        failureReason: "Could not reach your computer.",
      },
      // A failure the phone itself produced: a re-pair says nothing about it.
      {
        id: "a2",
        role: "assistant",
        text: "⚠️ decode halted",
        createdAt: STAMP - 1,
        failed: true,
        failureReason: "decode halted",
      },
    ],
  };
}

describe("useHistoryHost re-marks the open list when a pairing completes", () => {
  let renderer: ReactTestRenderer;
  // Re-written on every render: hook results are snapshots, not live views.
  let hook: { current: ReturnType<typeof useHistoryHost> | null };

  beforeEach(() => {
    jest.clearAllMocks();
    secureStore.__reset();
    storage.getItem.mockImplementation(async () => null);
  });

  afterEach(async () => {
    // A case may have unmounted already; a second unmount is not an error.
    await act(async () => {
      try {
        renderer.unmount();
      } catch {
        // already unmounted
      }
    });
  });

  const mount = async (conversationId?: string) => {
    hook = { current: null };
    const box = hook;
    const Probe = () => {
      box.current = useHistoryHost({
        t: (key) => key,
        locale: "en",
        conversationId,
        onConversationEnter: () => undefined,
        onConversationTouched: () => undefined,
      });
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
  };

  const now = () => {
    if (hook.current === null) throw new Error("probe never rendered");
    return hook.current;
  };

  test("a completion event marks the open conversation's old remote failure", async () => {
    await mount();
    await act(async () => {
      now().setMessages(() => liveMessages().messages);
    });
    expect(now().messages[0].failureStale).toBeUndefined();

    await act(async () => {
      await markPairingCompleted(STAMP);
    });

    expect(now().messages[0].failureStale).toBe(true);
    expect(now().messages[1].failureStale).toBeUndefined();
    // The failure itself is untouched: past framing, not deletion.
    expect(now().messages[0].failed).toBe(true);
    expect(now().messages[0].failureSource).toBe("remote");
  });

  test("an unmounted host no longer reacts", async () => {
    await mount();
    await act(async () => {
      now().setMessages(() => liveMessages().messages);
    });
    const held = now().messages;
    await act(async () => renderer.unmount());
    await act(async () => {
      await markPairingCompleted(STAMP);
    });
    // No throw, and the list React last held was never mutated behind it.
    expect(held).toBe(now().messages);
    expect(held[0].failureStale).toBeUndefined();
  });

  test("a completion landing mid-load is folded into the install, not lost", async () => {
    // The stored raw holds the same old remote failure; the load's own
    // stamp read happens BEFORE the pairing completes.
    const raw = JSON.stringify(liveMessages().messages);
    let releaseStorage!: (value: string | null) => void;
    storage.getItem.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          releaseStorage = resolve;
        }),
    );
    await mount("conv-1700000000000-abcdef12");

    // The load is parked on storage; the pairing completes in between.
    await act(async () => {
      await markPairingCompleted(STAMP);
    });
    expect(now().messages).toEqual([]);

    // The raw lands after the completion: the install must carry the
    // LATEST stamp, or the old failure would read as current again.
    await act(async () => {
      releaseStorage(raw);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(now().messages.length).toBe(2);
    expect(now().messages[0].failureStale).toBe(true);
    expect(now().messages[1].failureStale).toBeUndefined();
  });
});
