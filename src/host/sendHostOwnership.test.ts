jest.mock("./sendEngineAdapter", () => ({ createSendEngine: jest.fn() }));
jest.mock("../engine/engineBackend", () => ({ isRemoteEngineBackend: jest.fn(() => false) }));
jest.mock("./sendOutcomes", () => ({ applySendOutcome: jest.fn() }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTurnFence } from "./turnGuards";
import { useSendHost, type SendHost, type SendHostParams } from "./sendHost";
import { createSendEngine } from "./sendEngineAdapter";
import type { SendEngine } from "./sendStream";
import { hostComposerPhase } from "./composerPhase";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { LocalAttachment, Message } from "./hostMessage";

describe("sendHost binds engine ownership to the token it issued", () => {
  let renderer: ReactTestRenderer | undefined;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.mocked(createSendEngine).mockReset();
    console.error = (...args: unknown[]) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    console.error = originalConsoleError;
  });

  test("the adapter's predicate follows the send token through retirement", async () => {
    const fence = createTurnFence();
    const messagesRef = { current: [] as Message[] };
    const stagedRows: LocalAttachment[] = [
      { id: "image-1", kind: "image", name: "photo.png", uri: "file:///photo.png" },
    ];
    let finishEngine!: () => void;
    let emitLateDelta!: () => void;
    const pendingEngine: SendEngine = (_request, emit) => new Promise<void>((resolve) => {
      finishEngine = resolve;
      emitLateDelta = () => emit.onDelta("stale answer", "stale answer");
    });
    let adapter: Parameters<typeof createSendEngine>[0] | undefined;
    jest.mocked(createSendEngine).mockImplementation((input) => {
      adapter = input;
      return pendingEngine;
    });
    const params: SendHostParams = {
      t: ((key: string) => key) as SendHostParams["t"],
      fence,
      engineDeps: {} as EngineTurnDeps,
      messagesRef,
      setMessages: (update) => { messagesRef.current = update(messagesRef.current); },
      historyLoadedRef: { current: true },
      persist: () => null,
      getEpoch: () => 1,
      onSendingChange: jest.fn(),
      onToolCapture: jest.fn(),
      clearDraft: jest.fn(),
      draft: "hello",
      showNoticeKey: jest.fn(),
      arms: {
        researchRef: { current: false },
        notesRef: { current: false },
        clear: jest.fn(),
      },
      attachments: { itemsRef: { current: stagedRows }, clear: jest.fn() },
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
    let send!: Promise<void>;
    await act(async () => {
      send = host.send("hello");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    expect(adapter).toBeDefined();
    expect(adapter!.attachments).toEqual([
      { id: "image-1", kind: "image", name: "photo.png", uri: "file:///photo.png" },
    ]);
    expect(adapter!.attachments).not.toBe(stagedRows);
    stagedRows.splice(0);
    expect(adapter!.attachments).toHaveLength(1);
    expect(adapter!.isTurnOwner()).toBe(true);
    fence.invalidate();
    expect(adapter!.isTurnOwner()).toBe(false);
    emitLateDelta();
    expect(host.hasTokensRef.current).toBe(false);
    expect(
      hostComposerPhase({
        historyLoaded: true,
        thermalGated: false,
        sending: host.sendingRef.current,
        stopping: false,
        hasTokens: host.hasTokensRef.current,
        thinkingStatus: "Thinking",
        modelState: "ready",
        engineResident: true,
      }),
    ).toBe("prefill");

    await act(async () => {
      finishEngine();
      await send;
    });
  });
});
