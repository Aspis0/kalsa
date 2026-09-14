import { getStrings } from "../../i18n";
import { buildRemoteSystemPrompt } from "./remotePrompt";

describe("buildRemoteSystemPrompt", () => {
  test("includes the locale system prompt", () => {
    const prompt = buildRemoteSystemPrompt({ locale: "en" });
    expect(prompt.startsWith(getStrings("en").systemPrompt)).toBe(true);
    expect(prompt).not.toContain(getStrings("en").systemPromptWithSearch);
  });

  test("appends memory facts into the system slot", () => {
    const prompt = buildRemoteSystemPrompt({
      locale: "en",
      memoryFacts: [{ text: "The cat is named Nino" }],
    });
    expect(prompt).toContain("Nino");
    expect(prompt.length).toBeGreaterThan(getStrings("en").systemPrompt.length);
  });

  test("appends operative digest when present", () => {
    const prompt = buildRemoteSystemPrompt({
      locale: "en",
      operativeContext: { digest: "User asked about taxes", summary: null },
    });
    expect(prompt).toContain("taxes");
  });
});
