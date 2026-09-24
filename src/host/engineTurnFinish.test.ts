import { handleStop } from "./sendStop";
import { createTurnFence } from "./turnGuards";
import { createEngineTurnFinish } from "./engineTurnFinish";
import type { Message } from "./hostMessage";

function finishDeps(isTurnOwner: () => boolean) {
  return {
    isTurnOwner,
    activeDocumentAttachmentRef: { current: null },
    streamInFlightRef: { current: true },
    setStreaming: jest.fn(),
    onMiniappRef: { current: jest.fn() },
    onFinished: jest.fn(),
  };
}

describe("engine turn completion ownership", () => {
  afterEach(() => jest.useRealTimers());

  test("a watchdog-retired turn cannot clear the next turn's streaming state", () => {
    jest.useFakeTimers();
    const fence = createTurnFence();
    const firstToken = fence.beginRun();
    const firstFinishDeps = finishDeps(() => fence.owns(firstToken));
    const lateCompletion = createEngineTurnFinish(firstFinishDeps);
    const currentTokenRef = { current: firstToken };
    const messagesRef = { current: [] as Message[] };
    const watchdogSetStreaming = jest.fn();

    handleStop({
      fence,
      abortRef: { current: new AbortController() },
      stopWatchdogRef: { current: null },
      currentTokenRef,
      sendingRef: { current: true },
      sendClaimRef: { current: true },
      sendingInFlightRef: { current: true },
      regenInFlightRef: { current: false },
      regenHandleSendPassRef: { current: false },
      stopRequestedRef: { current: false },
      messagesRef,
      setMessages: (update) => { messagesRef.current = update(messagesRef.current); },
      persist: jest.fn(() => null),
      getEpoch: () => 0,
      onSendingChange: watchdogSetStreaming,
    });
    jest.advanceTimersByTime(3000);
    expect(fence.owns(firstToken)).toBe(false);

    const secondToken = fence.beginRun();
    currentTokenRef.current = secondToken;
    const secondTurnSetStreaming = firstFinishDeps.setStreaming;
    firstFinishDeps.streamInFlightRef.current = true;
    secondTurnSetStreaming.mockClear();

    lateCompletion();

    expect(firstFinishDeps.onFinished).toHaveBeenCalledTimes(1);
    expect(firstFinishDeps.streamInFlightRef.current).toBe(true);
    expect(firstFinishDeps.setStreaming).not.toHaveBeenCalled();

    const owningFinishDeps = finishDeps(() => fence.owns(secondToken));
    owningFinishDeps.streamInFlightRef = firstFinishDeps.streamInFlightRef;
    owningFinishDeps.setStreaming = firstFinishDeps.setStreaming;
    createEngineTurnFinish(owningFinishDeps)();

    expect(owningFinishDeps.streamInFlightRef.current).toBe(false);
    expect(secondTurnSetStreaming).toHaveBeenCalledWith(false);
    expect(owningFinishDeps.onFinished).toHaveBeenCalledTimes(1);
  });
});
