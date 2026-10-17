/**
 * The fallback's system message: the no-tools prompt plus the results note, and
 * nothing else about the turn's transcript moved.
 *
 * The cases that matter are the ones a mutation would break silently — the
 * other messages must arrive as the SAME objects (the tool results are the only
 * reason the fallback can answer at all), the turn's own array must survive
 * (the rounds after it and the persisted history read it), and the operative
 * block / memory facts must ride along (they live outside this message).
 *
 * One deliberate limit on the "no tool names" check: the BASE no-tools prompt
 * still says "do not translate the tool name web_search" in its language rules
 * (it.ts / en.ts, rule (c)), which is a rule about names, not a call. So the
 * check is on the NOTE — the text this change adds — not on the composed
 * prompt, which would be asserting something untrue about the catalogue.
 */
import { buildFallbackMessages, type SystemChatMessage } from "./fallbackMessages";
import { en } from "../i18n/en";
import { it as itStrings } from "../i18n/it";

const WITH_TOOLS = "Hai uno strumento web_search: usalo SEMPRE quando l'utente chiede notizie.";
const NO_TOOLS = "Sei Kalsa, un assistente AI privato.";
const NOTE =
  "Basa la risposta sui risultati degli strumenti qui sopra; se non contengono la risposta, dillo. " +
  "Cita le fonti usate facendo riferimento ai titoli.";

type Msg = SystemChatMessage | { role: "user"; content: string };

describe("buildFallbackMessages", () => {
  it("keeps the note the no-tools prompt drops, and drops the tool rules", () => {
    const swapped = buildFallbackMessages(
      [{ role: "system", content: WITH_TOOLS }, { role: "user", content: "notizie?" }],
      { systemText: NO_TOOLS, resultsNote: NOTE },
    );
    expect(swapped[0]).toEqual({ role: "system", content: `${NO_TOOLS}\n\n${NOTE}` });
    expect(swapped[0]!.content).not.toContain("usalo SEMPRE");
    expect(swapped[0]!.content).toContain("risultati degli strumenti");
  });

  it("gives the note no tool to call", () => {
    const swapped = buildFallbackMessages([{ role: "system", content: WITH_TOOLS }], {
      systemText: NO_TOOLS,
      resultsNote: NOTE,
    });
    const text = swapped[0]!.content;
    expect(text).not.toContain("web_search");
    expect(text).not.toContain("web_fetch");
    // An invitation, not just a name: "call/use the tool" phrasing is out too.
    expect(text).not.toMatch(/\b(call|calling|use|invoke)\b[^\n]*\btool\b/i);
  });

  it("puts the note after buildSystemPrompt's own output, facts block included", () => {
    // Legacy path: buildSystemPrompt returns prompt + "\n\n" + factsBlock. The
    // note goes after THAT, so the facts keep the position they were given.
    const withFacts = `${NO_TOOLS}\n\nMEMORY: prefero risposte brevi.`;
    const swapped = buildFallbackMessages([{ role: "system", content: WITH_TOOLS }], {
      systemText: withFacts,
      resultsNote: NOTE,
    });
    expect(swapped[0]!.content).toBe(`${withFacts}\n\n${NOTE}`);
    expect(swapped[0]!.content!.indexOf("MEMORY:")).toBeLessThan(
      swapped[0]!.content!.indexOf(NOTE),
    );
  });

  it("keeps the other messages as the same objects, in the same order", () => {
    const history: Msg = { role: "user", content: "notizie?" };
    const call = { role: "assistant", content: "", tool_calls: [] } as unknown as Msg;
    const result = { role: "tool", content: "Samsung: ..." } as unknown as Msg;
    const swapped = buildFallbackMessages(
      [{ role: "system", content: WITH_TOOLS }, history, call, result],
      { systemText: NO_TOOLS, resultsNote: NOTE },
    );
    expect(swapped).toHaveLength(4);
    expect(swapped[1]).toBe(history);
    expect(swapped[2]).toBe(call);
    expect(swapped[3]).toBe(result);
  });

  it("leaves the turn's own array and its system message untouched", () => {
    const system: SystemChatMessage = { role: "system", content: WITH_TOOLS };
    const messages: Msg[] = [system, { role: "user", content: "notizie?" }];
    const swapped = buildFallbackMessages(messages, {
      systemText: NO_TOOLS,
      resultsNote: NOTE,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(system);
    expect(system.content).toBe(WITH_TOOLS);
    expect(swapped).not.toBe(messages);
    expect(swapped[0]).not.toBe(system);
  });

  it("carries the operative block that lives outside this message", () => {
    // Format B: the block is prefixed into the last user message. Format C: it is
    // a second system message. Neither is the head this function rewrites.
    const lastUser: Msg = { role: "user", content: "[SYSTEM NOTE] MEMORY: prefero...\nnotizie?" };
    const operativeSystem: SystemChatMessage = { role: "system", content: "[operative]" };
    const swapped = buildFallbackMessages(
      [{ role: "system", content: WITH_TOOLS }, lastUser, operativeSystem],
      { systemText: NO_TOOLS, resultsNote: NOTE },
    );
    expect(swapped[1]).toBe(lastUser);
    expect(swapped[2]).toBe(operativeSystem);
  });

  it("copies rather than passing through when there is no system head", () => {
    const messages: Msg[] = [{ role: "user", content: "notizie?" }];
    const swapped = buildFallbackMessages(messages, {
      systemText: NO_TOOLS,
      resultsNote: NOTE,
    });
    expect(swapped).toEqual(messages);
    expect(swapped).not.toBe(messages);
  });

  it("handles the empty list", () => {
    expect(buildFallbackMessages([], { systemText: NO_TOOLS, resultsNote: NOTE })).toEqual([]);
  });

  // The real catalogue, not a fixture copy of it: the note is the sentence that
  // has to keep the fallback answering from the results, and a tool name in it
  // would re-open the exact hole this round exists to close.
  it("ships the note in both locales, naming no tool", () => {
    for (const catalog of [en, itStrings]) {
      const note = catalog.toolResultsAnswerNote;
      expect(note).toBeTruthy();
      expect(note).not.toMatch(/web_search|web_fetch|document_chat|create_miniapp/);
      expect(note).not.toMatch(/\b(call|calling|invoke|use)\b[^\n]*\btool\b/i);
      // The two rules the no-tools prompt dropped.
      expect(note.toLowerCase()).toMatch(/risultat|result/);
      expect(note.toLowerCase()).toMatch(/titoli|titles/);
    }
    expect(itStrings.toolResultsAnswerNote).not.toBe(en.toolResultsAnswerNote);
  });

  it("composes the shipped note onto the no-tools prompt", () => {
    const swapped = buildFallbackMessages([{ role: "system", content: WITH_TOOLS }], {
      systemText: en.systemPrompt,
      resultsNote: en.toolResultsAnswerNote,
    });
    expect(swapped[0]!.content).toBe(`${en.systemPrompt}\n\n${en.toolResultsAnswerNote}`);
    expect(swapped[0]!.content).toContain(en.toolResultsAnswerNote);
  });
});