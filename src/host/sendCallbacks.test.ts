import { createRichCallbacks } from "./sendCallbacks";
import { createTurnFence } from "./turnGuards";
import type { RichCallbackCtx } from "./sendCallbacks";
import type { EmissionSource } from "../engine/modelEmittedText";

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
