/**
 * The recap line lands on the answer of the turn that made it (PHONE-CHAT-PROTOCOL
 * §3.2), and a line from a turn that is no longer this one's is dropped.
 */
import { createRichCallbacks, type RichCallbackCtx } from "./sendCallbacks";
import { createTurnFence } from "./turnGuards";
import type { Message } from "./hostMessage";

function harness() {
  const fence = createTurnFence();
  const token = fence.beginRun();
  const messages: Message[] = [{ id: "assistant-1", role: "assistant", text: "fatto", createdAt: 0 }];
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    messages.splice(0, messages.length, ...updater(messages));
  };
  const ctx: RichCallbackCtx = {
    fence,
    token,
    assistantId: "assistant-1",
    setMessages,
    onToolCapture: jest.fn(),
    t: (key) => key,
  };
  return { rich: createRichCallbacks(ctx), message: () => messages[0], fence };
}

describe("the recap line lands on its own answer", () => {
  test("the turn's line is stored on the answer it belongs to", () => {
    const { rich, message } = harness();
    rich.callbacks.onRecap?.("Kalsa ha: aperto httpbin.org · scritto in 3 campi");
    expect(message().recap).toBe("Kalsa ha: aperto httpbin.org · scritto in 3 campi");
  });

  test("a line from a turn that is no longer this one's is dropped", () => {
    const { rich, message, fence } = harness();
    fence.beginRun();
    rich.callbacks.onRecap?.("Kalsa ha: niente");
    expect(message().recap).toBeUndefined();
  });
});
