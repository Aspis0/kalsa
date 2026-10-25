jest.mock("../engine/engineBackend", () => ({
  getActiveModelId: () => null,
  markKvNonReproducible: jest.fn(),
  saveEngineSession: jest.fn(),
}));
jest.mock("../engine/sessionPersistence", () => ({
  computeHistoryHashFromMessages: jest.fn(() => "hash"),
}));

import type { Message } from "./hostMessage";
import { finalizeAssistantTurn } from "./sendFinalize";
import { createTurnFence } from "./turnGuards";
import type { EmissionSource } from "../engine/modelEmittedText";

function finalize(emitted: string, source: EmissionSource) {
  const fence = createTurnFence();
  const token = fence.beginRun();
  let messages: Message[] = [
    { id: "assistant-1", role: "assistant", text: "visible answer", createdAt: 1 },
  ];
  const messagesRef = { current: messages };

  finalizeAssistantTurn(
    {
      fence,
      token,
      assistantId: "assistant-1",
      messagesRef,
      setMessages: (update) => {
        messages = update(messages);
      },
      persist: () => null,
      getEpoch: () => 0,
    },
    {
      modelEmittedText: emitted,
      emissionSource: source,
      thinkingText: undefined,
    },
    { interrupted: false },
  );
  return messages[0];
}

describe("turn finalization preserves emission provenance", () => {
  it.each(["parsed", "raw"] as const)(
    "persists model text with its %s provenance",
    (source: EmissionSource) => {
      expect(finalize("<think>emission", source)).toMatchObject({
        modelEmittedText: "<think>emission",
        emissionSource: source,
      });
    },
  );

  it("omits provenance when normalization drops an empty emission", () => {
    const message = finalize("", "raw");
    expect(message).not.toHaveProperty("modelEmittedText");
    expect(message).not.toHaveProperty("emissionSource");
  });
});

describe("the failure's source lands on the message", () => {
  function finalizeWithFailure(failure: { remote?: boolean }) {
    const fence = createTurnFence();
    const token = fence.beginRun();
    let messages: Message[] = [
      { id: "assistant-1", role: "assistant", text: "", streaming: true, createdAt: 1 },
    ];
    finalizeAssistantTurn(
      {
        fence,
        token,
        assistantId: "assistant-1",
        messagesRef: { current: messages },
        setMessages: (update) => {
          messages = update(messages);
        },
        persist: () => null,
        getEpoch: () => 0,
      },
      { thinkingText: undefined },
      { interrupted: false, failure: { reason: "remote_brain_http_401", ...failure } },
    );
    return messages[0];
  }

  it("a remote failure stamps failureSource remote", () => {
    expect(finalizeWithFailure({ remote: true })).toMatchObject({
      failed: true,
      failureSource: "remote",
    });
  });

  it("a local failure carries no source", () => {
    const message = finalizeWithFailure({});
    expect(message.failed).toBe(true);
    expect(message.failureSource).toBeUndefined();
  });
});
