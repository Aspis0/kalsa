/**
 * Where a picture may ride, and where it may not. The remote door is
 * stateless, so it is shown the pictures the window still remembers; the
 * phone's own engine keeps replaying text only, takes pictures from the
 * current user turn alone, and must never be handed a part for an older one.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { toOpenAiMessages } from "../engine/remote/openaiMessages";
import type { EngineMessage } from "../engine/LlamaService";

const ENGINE_TURN = readFileSync(join(__dirname, "engineTurnStream.ts"), "utf8");
const LLAMA_SERVICE = readFileSync(join(__dirname, "../engine/LlamaService.ts"), "utf8");

describe("history pictures ride the remote wire only", () => {
  test("the engine turn attaches them behind the remote guard, from one URI rule", () => {
    // Local mode must not grow pictures on history messages: `hasImages`
    // would flip and the phone's KV replay would stop being text-only.
    expect(ENGINE_TURN).toContain('if (remoteBackend && m.role === "user" && m.images?.length)');
    // The current turn's pictures, whichever backend is answering, come from
    // the one rule that turns stored rows into URIs.
    expect(ENGINE_TURN).toContain("const images = attachmentImageUris(attachments)");
  });

  test("the local engine takes parts from the current user message alone", () => {
    expect(LLAMA_SERVICE).toContain("if (index === userIndex) return buildUserMessage(message);");
  });

  test("the mapping a text-only turn uses never builds a part", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: "older", images: ["file:///old.jpg"] },
      { role: "user", content: "look", images: ["file:///now.jpg"] },
    ];
    for (const message of toOpenAiMessages(messages)) {
      expect(typeof message.content).toBe("string");
    }
  });
});
