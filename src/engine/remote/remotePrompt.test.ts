import { getStrings } from "../../i18n";
import type { MemoryFact } from "../../memory/MemoryStore";
import { buildMemoryFactsBlock } from "../memoryFactsTail";
import { buildRemoteSystemPrompt } from "./remotePrompt";

function fact(id: string, text: string, createdAt: number): MemoryFact {
  return { id, text, createdAt };
}

describe("buildRemoteSystemPrompt", () => {
  test("includes the locale system prompt", () => {
    const prompt = buildRemoteSystemPrompt({ locale: "en" });
    expect(prompt).toBe(getStrings("en").systemPrompt);
    expect(prompt).not.toContain(getStrings("en").systemPromptWithSearch);
  });

  test("appends main's fact block into the system slot", () => {
    const facts = [fact("f1", "The cat is named Nino", 1_700_000_000_000)];
    const block = buildMemoryFactsBlock("en", facts);
    expect(block).toContain("Nino");
    const prompt = buildRemoteSystemPrompt({ locale: "en", memoryFacts: facts });
    // Exact composition: system prompt + fact block. Red if facts ever drop.
    expect(prompt).toBe(`${getStrings("en").systemPrompt}\n\n${block}`);
  });

  test("bounds facts with main's policy, not a ten-fact copy", () => {
    const facts = Array.from({ length: 15 }, (_, i) =>
      fact(`f${i}`, `Fact number ${i} stays`, 1_700_000_000_000 + i),
    );
    const prompt = buildRemoteSystemPrompt({ locale: "en", memoryFacts: facts });
    // The removed branch copy kept only the last ten by array position;
    // main's 1200-token budget keeps every one of these.
    for (const item of facts) {
      expect(prompt).toContain(item.text);
    }
  });

  test("appends operative digest when present", () => {
    const prompt = buildRemoteSystemPrompt({
      locale: "en",
      operativeContext: { digest: "User asked about taxes", summary: null },
    });
    expect(prompt).toContain("taxes");
  });
});
