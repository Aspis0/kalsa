/**
 * The AppState flush and what it must leave on disk.
 *
 * The bug this pins: backgrounding DURING a send persisted nothing until the
 * answer had text (`sendingRef` was only consulted by the clean branch), so an
 * OS kill before the first token lost the turn AND the user's message. The
 * partial payload is the only projection that can carry both, and the
 * end-of-turn save must still overwrite it.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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

jest.mock("react-native", () => {
  const listeners = new Set<(state: string) => void>();
  return {
    AppState: {
      addEventListener: (_type: string, listener: (state: string) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      __fire: (state: string) => {
        for (const listener of [...listeners]) listener(state);
      },
    },
  };
});

jest.mock("../engine/engineBackend", () => ({
  getActiveModelId: jest.fn(() => "model-1"),
  invalidateEngineSession: jest.fn(async () => undefined),
  saveEngineSession: jest.fn(async () => true),
}));

jest.mock("../engine/sessionPersistence", () => ({
  computeHistoryHashFromMessages: jest.fn(() => "hash"),
}));

import { saveEngineSession } from "../engine/engineBackend";
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";
import type { HistoryWriter } from "./historyWrite";
import { useHistoryFlushes } from "./useHistoryFlushes";
import type { Message } from "./hostMessage";

const appState = (
  jest.requireMock("react-native") as { AppState: { __fire: (s: string) => void } }
).AppState;
const saveSession = saveEngineSession as jest.MockedFunction<typeof saveEngineSession>;

const user = (): Message => ({ id: "u-1", role: "user", text: "hello", createdAt: 1 });
const streamingAnswer = (text: string): Message => ({
  id: "a-2",
  role: "assistant",
  text,
  streaming: true,
  createdAt: 2,
});
const settledAnswer = (text: string): Message => ({
  id: "a-2",
  role: "assistant",
  text,
  createdAt: 2,
});

type HookParams = Parameters<typeof useHistoryFlushes>[0];

describe("useHistoryFlushes writes the turn in flight on background", () => {
  let renderer: ReactTestRenderer;
  let params: HookParams;
  let persistActiveMessages: jest.Mock;
  let notifyConversationTouched: jest.Mock;
  let writer: jest.Mocked<HistoryWriter<Message>>;

  const Probe = () => {
    useHistoryFlushes(params);
    return null;
  };

  function writerReturning(ticket: HistoryWriteTicket | null): jest.Mocked<HistoryWriter<Message>> {
    return {
      epoch: jest.fn(() => 7),
      bumpEpoch: jest.fn(() => 8),
      bindKey: jest.fn(() => "conversation-key"),
      key: jest.fn(() => "conversation-key"),
      persist: jest.fn(() => ticket),
      flushThenBump: jest.fn(() => null),
      bumpThenDeleteKey: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<HistoryWriter<Message>>;
  }

  async function mount(
    messages: Message[],
    sending: boolean,
    opts?: { ticket?: HistoryWriteTicket | null },
  ) {
    persistActiveMessages = jest.fn(() => null);
    notifyConversationTouched = jest.fn();
    writer = writerReturning(opts?.ticket ?? null);
    params = {
      messages,
      messagesRef: { current: messages },
      historyLoaded: true,
      sendingRef: { current: sending },
      writer,
      persistActiveMessages,
      notifyConversationTouched,
    };
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    saveSession.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      previousActEnvironment;
    jest.restoreAllMocks();
  });

  test("a send that has not emitted a token still lands, as an interrupted partial", async () => {
    const messages = [user(), streamingAnswer("")];
    await mount(messages, true);

    await act(async () => appState.__fire("background"));

    expect(persistActiveMessages).toHaveBeenCalledTimes(1);
    expect(persistActiveMessages).toHaveBeenCalledWith(messages, {
      allowStreamingPartial: true,
      epoch: 7,
    });
    // The clean payload and the session hash wait for a background with no
    // turn in flight.
    expect(writer.persist).not.toHaveBeenCalled();
    expect(saveSession).not.toHaveBeenCalled();
  });

  test("so does a send that is interrupted by the app switcher", async () => {
    const messages = [user(), streamingAnswer("")];
    await mount(messages, true);

    await act(async () => appState.__fire("inactive"));

    expect(persistActiveMessages).toHaveBeenCalledTimes(1);
    expect(writer.persist).not.toHaveBeenCalled();
  });

  test("an idle background still writes the clean payload and the session hash", async () => {
    const messages = [user(), settledAnswer("done")];
    await mount(messages, false, { ticket: { issued: true, landed: Promise.resolve(true) } });

    await act(async () => appState.__fire("background"));

    expect(persistActiveMessages).not.toHaveBeenCalled();
    expect(writer.persist).toHaveBeenCalledWith(messages, { epoch: 7 });
    expect(notifyConversationTouched).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledWith("model-1", "hash", 2);
  });

  test("the end-of-turn save overwrites the partial once the turn settles", async () => {
    await mount([user(), streamingAnswer("")], true);
    await act(async () => appState.__fire("background"));
    expect(persistActiveMessages).toHaveBeenCalledTimes(1);

    // The turn ends: the debounced clean write resumes and replaces the
    // partial payload the background flush left behind.
    const finished = [user(), settledAnswer("half an answer")];
    await act(async () => {
      params = {
        ...params,
        messages: finished,
        messagesRef: { current: finished },
        sendingRef: { current: false },
      };
      renderer.update(React.createElement(Probe));
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(persistActiveMessages).toHaveBeenCalledTimes(2);
    expect(persistActiveMessages.mock.calls[1][1]).toEqual({ epoch: 7 });
  });
});
