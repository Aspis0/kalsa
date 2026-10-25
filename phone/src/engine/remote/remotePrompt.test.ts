import { getStrings } from "../../i18n";
import { buildRemoteSystemPrompt } from "./remotePrompt";

describe("buildRemoteSystemPrompt", () => {
  test("is exactly the locale system prompt", () => {
    const prompt = buildRemoteSystemPrompt({ locale: "en" });
    expect(prompt).toBe(getStrings("en").systemPrompt);
    expect(prompt).not.toContain(getStrings("en").systemPromptWithSearch);
  });

  test("appends the operative block when present", () => {
    const prompt = buildRemoteSystemPrompt({
      locale: "en",
      operativeContext: { digest: "User asked about taxes", summary: null },
    });
    expect(prompt.startsWith(getStrings("en").systemPrompt)).toBe(true);
    expect(prompt).toContain("taxes");
  });
});
