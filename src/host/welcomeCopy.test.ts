/**
 * The welcome block's decisions, which are the controller's own lifted ones:
 * the hour table (`AiChatPage:505-509`), the four suggestions (`:423-453`) and
 * the history gate (`:4015-4016`). The block's JSX cannot be rendered in this
 * stack (DESIGN.md, "proof regime"), so what is proven here is everything the
 * JSX is required to obey: the same catalogue keys in BOTH locales, the same
 * order and two-tone pattern, and the gate's truth table — the row that says
 * the block does not exist before history is known.
 */
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import type { TranslationKey, TranslateFn } from "../i18n";
import { buildSuggestions, greetingForHour, welcomeVisible } from "./welcomeCopy";

/** A real `t` over a catalogue object, built without importing `i18n/index`
 *  (its runtime pulls AsyncStorage, which the node stack does not load). A key
 *  the catalogue does not carry THROWS rather than returning the key, so a typo
 *  fails here instead of shipping a raw key to the user. */
function tOf(catalog: object): TranslateFn {
  return ((key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
    if (typeof value !== "string") throw new Error(`missing catalogue key: ${key}`);
    return value;
  }) as TranslateFn;
}

const tEn = tOf(en);
const tIt = tOf(italian);

describe("the hour greeting (Chat:505-509)", () => {
  it("picks morning before 12, afternoon before 18, evening after", () => {
    // Boundaries inclusive exactly where the controller's `if`s put them.
    expect(greetingForHour(0, tEn)).toBe(en.chat.greetingMorning);
    expect(greetingForHour(11, tEn)).toBe(en.chat.greetingMorning);
    expect(greetingForHour(12, tEn)).toBe(en.chat.greetingAfternoon);
    expect(greetingForHour(17, tEn)).toBe(en.chat.greetingAfternoon);
    expect(greetingForHour(18, tEn)).toBe(en.chat.greetingEvening);
    expect(greetingForHour(23, tEn)).toBe(en.chat.greetingEvening);
  });

  it("is translated: the Italian table is not the English one", () => {
    expect(greetingForHour(9, tIt)).toBe(italian.chat.greetingMorning);
    expect(greetingForHour(15, tIt)).toBe(italian.chat.greetingAfternoon);
    expect(greetingForHour(20, tIt)).toBe(italian.chat.greetingEvening);
    expect(greetingForHour(9, tIt)).not.toBe(greetingForHour(9, tEn));
  });

  it("would fail on a key the catalogue lost", () => {
    expect(() => tEn("chat.greetingNope" as TranslationKey)).toThrow(/missing catalogue key/);
  });
});

describe("the four suggestion cards (Chat:423-453)", () => {
  it("are four, in the controller's order and two-tone pattern", () => {
    const suggestions = buildSuggestions(tEn);
    expect(suggestions.map((s) => s.colorKey)).toEqual([
      "compute",
      "accent",
      "accent",
      "compute",
    ]);
  });

  it("carry non-empty text and sub from BOTH catalogues", () => {
    for (const [name, t] of [
      ["en", tEn],
      ["it", tIt],
    ] as const) {
      const suggestions = buildSuggestions(t);
      expect(suggestions).toHaveLength(4);
      for (const suggestion of suggestions) {
        expect([name, suggestion.text.trim().length > 0]).toEqual([name, true]);
        expect([name, suggestion.sub.trim().length > 0]).toEqual([name, true]);
      }
    }
    // The Italian cards are actually Italian, not English fallbacks.
    expect(buildSuggestions(tIt)[0].text).toBe(italian.chat.suggestion1);
    expect(buildSuggestions(tEn)[1].text).toBe(en.chat.suggestion2);
  });

  it("draws each card from the catalogue key the controller used", () => {
    expect(buildSuggestions(tEn)[3]).toEqual({
      text: en.chat.suggestion4,
      sub: en.chat.suggestion4Sub,
      colorKey: "compute",
    });
  });
});

describe("the gate (Chat:4015-4016): the block never flashes before history is known", () => {
  it("is false while the history load has NOT settled, empty chat or not", () => {
    expect(welcomeVisible(false, 0)).toBe(false);
    expect(welcomeVisible(false, 3)).toBe(false);
  });

  it("is true only on a settled, empty conversation", () => {
    expect(welcomeVisible(true, 0)).toBe(true);
    expect(welcomeVisible(true, 1)).toBe(false);
    expect(welcomeVisible(true, 42)).toBe(false);
  });

  it("can fail: a gate that returned true for (false, 0) would flash", () => {
    expect(welcomeVisible(false, 0)).not.toBe(true);
  });
});
