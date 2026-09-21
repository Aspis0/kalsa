/**
 * The engine's tool names, and the catalogue key each one's row is drawn with
 * (DESIGN.md §2.4).
 *
 * Pure and in its own module because a name-to-label table is exactly the kind
 * of thing that rots silently: a tool added to the engine arrives here as an
 * unknown name, and a row that disappears is worse than a row that admits it
 * does not know the name. `toolLabels.test.ts` cross-checks the table against
 * `src/agent/toolNames.ts` — the registry's own list — so adding a ninth tool
 * without a label fails here rather than in a screenshot.
 *
 * Three of the six known labels are the DESKTOP's own and are reused rather than
 * duplicated: the old UI already ships "Searching the web…", "Fetching page…"
 * and "Reading document…" under `chat.*` in both catalogues, and inventing a
 * second wording for the same tool call is how two products start disagreeing.
 * The remaining five names, and the unknown case, are the shell's own strings
 * under `shell.tools`.
 */
import type { TranslationKey } from "../../i18n";

/**
 * The row drawn for a tool name the catalogue does not know.
 *
 * Named here rather than written inline in the component, because the honest
 * case is a decision: an unknown name is NOT dropped, and it does NOT get an
 * invented friendly label either — the row keeps the engine's own spelling, so
 * the interface says what happened instead of guessing at it.
 */
export const UNKNOWN_TOOL_LABEL_KEY: TranslationKey = "shell.tools.unknown";

/**
 * Wire name -> catalogue key, in `src/agent/toolNames.ts`'s order. The match is
 * exact and case-sensitive, because the engine's names are: `web_search` is
 * known, `WEB_SEARCH` and `web_search ` are not, and treating them as known
 * would hide a wire change behind a friendly label.
 */
const TOOL_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
  web_search: "chat.searching",
  web_fetch: "chat.fetching",
  document_chat: "chat.readingDocument",
  write_note: "shell.tools.writeNote",
  device_info: "shell.tools.deviceInfo",
  device_calc: "shell.tools.deviceCalc",
  calendar_agenda: "shell.tools.calendarAgenda",
  create_miniapp: "shell.tools.createMiniapp",
});

/** The known wire names, in the order they are written above. */
export const KNOWN_TOOL_NAMES: readonly string[] = Object.freeze(Object.keys(TOOL_LABEL_KEYS));

/**
 * What one row draws: the key, and the raw name the unknown case has to carry.
 * `params` is present only for an unknown name — the known labels take none.
 */
export type ToolRowLabel = {
  key: TranslationKey;
  params?: { name: string };
};

/**
 * The label for one tool name.
 *
 * `hasOwnProperty` rather than a bare lookup: a name like `constructor` or
 * `toString` would otherwise find `Object.prototype`'s member and draw a label
 * built from a function, which is the sort of thing a wire value can actually
 * be. Those names land in the unknown case, where they belong.
 */
export function toolRowLabel(name: string): ToolRowLabel {
  if (Object.prototype.hasOwnProperty.call(TOOL_LABEL_KEYS, name)) {
    return { key: TOOL_LABEL_KEYS[name] };
  }
  return { key: UNKNOWN_TOOL_LABEL_KEY, params: { name } };
}

/** True when the catalogue has a label for this exact wire name. */
export function isKnownToolName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_LABEL_KEYS, name);
}
