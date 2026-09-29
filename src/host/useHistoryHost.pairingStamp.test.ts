/**
 * The live half of the stale-pairing rule: when a pairing completes, the
 * OPEN conversation's message list is re-marked without any reload —
 * returning from the pairing screen never re-runs the history load (the
 * conversation did not change). This mounts the real hook over mocked
 * storage and drives the same notification PairingScreen fires.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));

jest.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

jest.mock("expo-secure-store", () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: async (key: string) => store[key] ?? null,
    setItemAsync: async (key: string, value: string) => {
      store[key] = value;
    },
  };
});

import { markPairingCompleted } from "../pairing/pairingCompletedAt";
import { useHistoryHost } from "./useHistoryHost";
import type { Message } from "./hostMessage";

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

  beforeEach(async () => {
    hook = { current: null };
    const box = hook;
    const Probe = () => {
      box.current = useHistoryHost({
        t: (key) => key,
        locale: "en",
        conversationId: undefined,
        onConversationEnter: () => undefined,
        onConversationTouched: () => undefined,
      });
      return null;
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
  });

  const now = () => {
    if (hook.current === null) throw new Error("probe never rendered");
    return hook.current;
  };

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

  test("a completion event marks the open conversation's old remote failure", async () => {
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
});
