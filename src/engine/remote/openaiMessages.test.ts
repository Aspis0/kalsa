import { toOpenAiMessages } from "./openaiMessages";
import type { EngineMessage } from "../LlamaService";

describe("toOpenAiMessages", () => {
  test("maps user and assistant, prefers modelEmittedText", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "cleaned", modelEmittedText: "raw" },
    ];
    expect(toOpenAiMessages(messages, "sys")).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "raw" },
    ]);
  });

  test("drops empty system and unknown roles", () => {
    const messages = [
      { role: "user", content: "q" },
    ] as EngineMessage[];
    expect(toOpenAiMessages(messages, "  ")).toEqual([
      { role: "user", content: "q" },
    ]);
  });
});
