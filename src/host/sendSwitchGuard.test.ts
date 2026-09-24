/**
 * A send must refuse while a model switch is in flight (luna): the switch
 * changes the ref and awaits marker removal before any visible state, so a
 * send slipping into that window finds the old model resident
 * (`engineEnsure` early return) and is then interrupted by the dispose.
 * The refusal happens before the claim — nothing runs, nothing is cleared.
 */
jest.mock("./sendEngineAdapter", () => ({ createSendEngine: jest.fn() }));
jest.mock("../engine/engineBackend", () => ({ isRemoteEngineBackend: jest.fn(() => false) }));
jest.mock("./sendOutcomes", () => ({ applySendOutcome: jest.fn() }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTurnFence } from "./turnGuards";
import { useSendHost, type SendHost, type SendHostParams } from "./sendHost";
import { createSendEngine } from "./sendEngineAdapter";
import { modelSwitchInFlightRef } from "./modelSwitchState";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { Message } from "./hostMessage";

describe("send refuses while a model switch is in flight", () => {
  let renderer: ReactTestRenderer | undefined;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.mocked(createSendEngine).mockReset();
    modelSwitchInFlightRef.current = false;
    console.error = (...args: unknown[]) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    modelSwitchInFlightRef.current = false;
    console.error = originalConsoleError;
  });

  test("the refused send never claims, never clears the draft, never touches a message", async () => {
    const fence = createTurnFence();
    const messagesRef: { current: Message[] } = { current: [] };
    const onSendingChange = jest.fn();
    const clearDraft = jest.fn();
    const params: SendHostParams = {
      t: ((key: string) => key) as SendHostParams["t"],
      fence,
      engineDeps: {} as EngineTurnDeps,
      messagesRef,
      setMessages: (update) => { messagesRef.current = update(messagesRef.current); },
      historyLoadedRef: { current: true },
      persist: () => null,
      getEpoch: () => 1,
      onSendingChange,
      onToolCapture: jest.fn(),
      clearDraft,
      draft: "hello",
      showNoticeKey: jest.fn(),
      arms: {
        researchRef: { current: false },
        notesRef: { current: false },
        clear: jest.fn(),
      },
      attachments: { itemsRef: { current: [] }, clear: jest.fn() },
      visionCapable: false,
    };
    let host!: SendHost;
    function Harness() {
      host = useSendHost(params);
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    modelSwitchInFlightRef.current = true;
    await act(async () => {
      void host.send("hello");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(onSendingChange).not.toHaveBeenCalled();
    expect(jest.mocked(createSendEngine)).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
    expect(messagesRef.current).toEqual([]);
    expect(host.sendingRef.current).toBe(false);
  });
});
