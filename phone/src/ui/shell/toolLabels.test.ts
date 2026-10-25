/**
 * The tool-row table (DESIGN.md §2.4) — the test the module exists for: a
 * name-to-label table rots silently. A ninth tool would arrive as an unknown
 * name and be drawn as "Tool: web_find" — honest, but wrong, and nothing would
 * fail to say so. The table is checked against the registry's OWN list,
 * `ALL_TOOL_NAMES`, in the registry's own order, and the unknown case is
 * checked on its own because it is the case the interface is most likely to
 * get wrong.
 */
import { ALL_TOOL_NAMES } from "../../agent/toolNames";
// `it` is the Italian catalogue; the alias keeps jest's global `it` intact.
import { en, it as italian } from "../../i18n";
import {
  KNOWN_TOOL_NAMES,
  UNKNOWN_TOOL_LABEL_KEY,
  isKnownToolName,
  toolRowLabel,
} from "./toolLabels";

/** One string leaf of a catalogue by its dotted key, or undefined. */
function leaf(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

describe("the tool-row label table", () => {
  it("covers every tool the registry ships, in the registry's own order", () => {
    // Equal as lists, not as sets: a tool added to `toolNames.ts` and forgotten
    // here, or one removed there and left here, both fail on this line.
    expect([...KNOWN_TOOL_NAMES]).toEqual([...ALL_TOOL_NAMES]);
  });

  it("does not invent a tool the registry does not have", () => {
    for (const name of KNOWN_TOOL_NAMES) {
      expect(ALL_TOOL_NAMES).toContain(name);
    }
  });

  it("reuses the desktop's own labels instead of writing a second wording", () => {
    // These three already exist in both catalogues and are what the old UI
    // shows; a parallel `shell.tools.webSearch` would be a second wording for
    // the same call.
    expect(toolRowLabel("web_search")).toEqual({ key: "chat.searching" });
    expect(toolRowLabel("web_fetch")).toEqual({ key: "chat.fetching" });
    expect(toolRowLabel("document_chat")).toEqual({ key: "chat.readingDocument" });
  });

  it("resolves every known key in BOTH catalogues, and takes no parameters", () => {
    for (const name of KNOWN_TOOL_NAMES) {
      const { key, params } = toolRowLabel(name);
      expect(params).toBeUndefined();
      for (const catalog of [en, italian]) {
        const text = leaf(catalog, key);
        expect(typeof text).toBe("string");
        expect(text).not.toBe("");
        // `translate` returns the key itself when it cannot resolve, so a label
        // that equals its own key is a missing label, not a translation.
        expect(text).not.toBe(key);
        // No interpolation: the row passes no parameters to a known label.
        expect(String(text)).not.toMatch(/\{/);
      }
    }
  });

  it("keeps an unknown name, with the engine's own spelling, instead of dropping it", () => {
    expect(toolRowLabel("web_find")).toEqual({
      key: UNKNOWN_TOOL_LABEL_KEY,
      params: { name: "web_find" },
    });
    expect(isKnownToolName("web_find")).toBe(false);
    // The unknown row is a real label in both catalogues, and it is the only
    // one that interpolates anything.
    for (const catalog of [en, italian]) {
      const text = leaf(catalog, UNKNOWN_TOOL_LABEL_KEY);
      expect(typeof text).toBe("string");
      expect(String(text)).toContain("{name}");
    }
  });

  it("does not read an inherited object member as a label", () => {
    // A wire value can literally be `constructor`; a bare lookup would find
    // `Object.prototype`'s member and draw a label built from a function.
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(isKnownToolName(name)).toBe(false);
      expect(toolRowLabel(name)).toEqual({
        key: UNKNOWN_TOOL_LABEL_KEY,
        params: { name },
      });
    }
  });

  it("matches the wire name exactly, case and whitespace included", () => {
    expect(isKnownToolName("web_search")).toBe(true);
    expect(isKnownToolName("WEB_SEARCH")).toBe(false);
    expect(isKnownToolName(" web_search")).toBe(false);
    expect(isKnownToolName("web_search ")).toBe(false);
    expect(isKnownToolName("")).toBe(false);
    expect(toolRowLabel("WEB_SEARCH").params).toEqual({ name: "WEB_SEARCH" });
  });
});
