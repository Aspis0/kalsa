/**
 * The engine's tool names, and the catalogue key each one's row is drawn with
 * (DESIGN.md §2.4).
 *
 * Pure and in its own module because a name-to-label table rots silently: a
 * tool added to the engine arrives here as an unknown name, and a row that
 * disappears is worse than a row that admits it does not know the name.
 * `toolLabels.test.ts` cross-checks the table against `src/agent/toolNames.ts`,
 * so a ninth tool without a label fails here rather than in a screenshot.
 *
 * Three labels are the DESKTOP's own strings, reused under `chat.*` in both
 * catalogues — a second wording for the same tool call is how two products
 * start disagreeing. The rest, and the unknown case, are `shell.tools`.
 */
import type { TranslationKey } from "../../i18n";

/**
 * The row drawn for a tool name the catalogue does not know. Named here rather
 * than inline, because the honest case is a decision: an unknown name is NOT
 * dropped and gets NO invented friendly label — the row keeps the engine's own
 * spelling, so the interface says what happened instead of guessing.
 */
export const UNKNOWN_TOOL_LABEL_KEY: TranslationKey = "shell.tools.unknown";

/**
 * Wire name -> catalogue key, in `src/agent/toolNames.ts`'s order. Exact and
 * case-sensitive, because the engine's names are: `web_search` is known,
 * `WEB_SEARCH` is not, and treating it as known would hide a wire change
 * behind a friendly label.
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
 * What one row draws: the key, and the raw name the unknown case carries
 * (`params` present only for an unknown name — the known labels take none).
 */
export type ToolRowLabel = {
  key: TranslationKey;
  params?: { name: string };
};

/**
 * The label for one tool name.
 *
 * `hasOwnProperty` rather than a bare lookup: a wire name like `constructor`
 * would otherwise find `Object.prototype`'s member and draw a label built from
 * a function. Such names land in the unknown case, where they belong.
 */
export function toolRowLabel(name: string): ToolRowLabel {
  if (Object.prototype.hasOwnProperty.call(TOOL_LABEL_KEYS, name)) {
    return { key: TOOL_LABEL_KEYS[name] };
  }
  return { key: UNKNOWN_TOOL_LABEL_KEY, params: { name } };
}

export function isKnownToolName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_LABEL_KEYS, name);
}
