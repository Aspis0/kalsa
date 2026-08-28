/**
 * Per-tool rule tables. Resolution is the only extension point: add an entry
 * to register a new gated tool. Unregistered names (miniapps, document_chat,
 * …) are exempt by construction.
 *
 * Flag OFF (expand=false): only web_search resolves — today's behavior.
 * Flag ON: the rest of the map is visible (calendar_agenda today).
 */

import { CALENDAR_GATE_TABLE } from "./calendarGate";
import type { RuleTable } from "./evaluate";
import { TOOL_GATE_TABLE } from "./toolGate";

export const TOOL_GATE_REGISTRY: Readonly<Record<string, RuleTable>> = {
  web_search: TOOL_GATE_TABLE,
  calendar_agenda: CALENDAR_GATE_TABLE,
};

/**
 * Resolve the rule table for a tool. `expand` is the toolhelp flag.
 * Returns undefined when the tool is ungated.
 */
export function resolveToolGateTable(
  toolName: string,
  expand: boolean,
): RuleTable | undefined {
  if (toolName === "web_search") return TOOL_GATE_REGISTRY.web_search;
  if (!expand) return undefined;
  return TOOL_GATE_REGISTRY[toolName];
}
