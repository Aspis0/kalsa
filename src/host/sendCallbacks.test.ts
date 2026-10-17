import { createRichCallbacks } from "./sendCallbacks";
import { createTurnFence } from "./turnGuards";
import type { RichCallbackCtx } from "./sendCallbacks";
import type { EmissionSource } from "../engine/modelEmittedText";
import type { Message } from "./hostMessage";

describe("send callback provenance capture", () => {
  it.each(["parsed", "raw"] as const)(
    "carries the %s source with the captured model emission",
    (source: EmissionSource) => {
      const fence = createTurnFence();
      const ctx: RichCallbackCtx = {
        fence,
        token: fence.beginRun(),
        assistantId: "assistant-1",
        setMessages: jest.fn(),
        onToolCapture: jest.fn(),
        t: (key) => key,
      };
      const rich = createRichCallbacks(ctx);

      rich.callbacks.onModelEmittedText?.("<think>emission", source);

      expect(rich.captured()).toMatchObject({
        modelEmittedText: "<think>emission",
        emissionSource: source,
      });
    },
  );
});

describe("the thinking card while the model reasons", () => {
  function setup() {
    const fence = createTurnFence();
    let messages: Message[] = [
      { id: "assistant-1", role: "assistant", text: "", streaming: true, createdAt: 1 },
    ];
    const setMessages = jest.fn((updater: (prev: typeof messages) => typeof messages) => {
      messages = updater(messages);
    });
    const ctx: RichCallbackCtx = {
      fence,
      token: fence.beginRun(),
      assistantId: "assistant-1",
      setMessages,
      onToolCapture: jest.fn(),
      t: (key) => key,
    };
    return { rich: createRichCallbacks(ctx), fence, messages: () => messages };
  }

  it("paints each streamed span on the streaming message", () => {
    const { rich, messages } = setup();

    rich.callbacks.onThinkingText?.("thinking…");
    rich.callbacks.onThinkingText?.("thinking… more");

    expect(messages()[0].thinkingText).toBe("thinking… more");
    // A stream update is display only: nothing is captured for the turn end.
    expect(rich.captured().thinkingText).toBeUndefined();
  });

  it("the final span clears the card when the engine reconciled it away", () => {
    const { rich, messages } = setup();

    rich.callbacks.onThinkingText?.("thinking…");
    expect(messages()[0].thinkingText).toBe("thinking…");

    // finalize kept none of it: an empty final span must WIN, not be dropped
    // as blank, or the card keeps reasoning the engine threw away.
    rich.callbacks.onThinkingText?.("", { final: true });

    expect(messages()[0].thinkingText).toBe("");
    expect(rich.captured().thinkingText).toBeUndefined();
  });

  it("the final span is what the turn persists", () => {
    const { rich, messages } = setup();

    rich.callbacks.onThinkingText?.("thinking…");
    rich.callbacks.onThinkingText?.("the real span", { final: true });

    expect(messages()[0].thinkingText).toBe("the real span");
    expect(rich.captured().thinkingText).toBe("the real span");
  });

  it("drops a final span that arrives after the fence moved on", () => {
    const { rich, fence, messages } = setup();

    rich.callbacks.onThinkingText?.("kept");
    fence.beginRun(); // a new send owns the turn now; this run's writes are stale

    rich.callbacks.onThinkingText?.("dropped", { final: true });

    expect(messages()[0].thinkingText).toBe("kept");
    expect(rich.captured().thinkingText).toBeUndefined();
  });
});
