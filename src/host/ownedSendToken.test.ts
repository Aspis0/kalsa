import { hostComposerPhase, type ComposerPhaseInput } from "./composerPhase";
import { createTurnFence, handleOwnedSendToken } from "./turnGuards";

const phaseFor = (hasTokens: boolean) =>
  hostComposerPhase({
    historyLoaded: true,
    thermalGated: false,
    sending: true,
    stopping: false,
    hasTokens,
    thinkingStatus: "Thinking",
    modelState: "ready",
    engineResident: true,
  } satisfies ComposerPhaseInput);

describe("owned send token callbacks", () => {
  test("a retired send cannot mark the new send as having emitted text", () => {
    const fence = createTurnFence();
    const retiredSend = fence.beginRun();
    fence.beginRun();
    const hasTokensRef = { current: false };
    const push = jest.fn();

    handleOwnedSendToken(fence, retiredSend, "stale answer", hasTokensRef, push);

    expect(hasTokensRef.current).toBe(false);
    expect(phaseFor(hasTokensRef.current)).toBe("prefill");
    expect(push).not.toHaveBeenCalled();
  });

  test("an owned empty retry delta clears text without leaving prefill", () => {
    const fence = createTurnFence();
    const retryingSend = fence.beginRun();
    const hasTokensRef = { current: false };
    const push = jest.fn();

    handleOwnedSendToken(fence, retryingSend, "", hasTokensRef, push);

    expect(push).toHaveBeenCalledWith("");
    expect(hasTokensRef.current).toBe(false);
    expect(phaseFor(hasTokensRef.current)).toBe("prefill");
    expect(fence.owns(retryingSend)).toBe(true);
  });

  test("a non-empty owned delta advances the composer out of prefill", () => {
    const fence = createTurnFence();
    const activeSend = fence.beginRun();
    const hasTokensRef = { current: false };

    handleOwnedSendToken(fence, activeSend, "answer", hasTokensRef, jest.fn());

    expect(hasTokensRef.current).toBe(true);
    expect(phaseFor(hasTokensRef.current)).toBe("writing");
  });
});
