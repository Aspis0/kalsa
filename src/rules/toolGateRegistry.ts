/**
 * Per-tool rule tables are declared on TOOL_ENTRIES and read here. Adding a
 * row with a gateTable is therefore enough to make it resolvable; unregistered
 * names (miniapps, document_chat, …) remain exempt by construction.
 *
 * Flag OFF (expand=false): web_search and web_fetch resolve for privacy.
 * Flag ON: the rest of the TOOL_ENTRIES gate rows are visible.
 */

import { TOOL_ENTRIES } from "../agent/toolRegistry";
import type { RuleTable } from "./evaluate";

const gateRegistry: Record<string, RuleTable> = {};
for (const entry of TOOL_ENTRIES) {
  if (entry.gateTable) gateRegistry[entry.name] = entry.gateTable;
}

export const TOOL_GATE_REGISTRY: Readonly<Record<string, RuleTable>> =
  Object.freeze(gateRegistry);

/**
 * Resolve the rule table for a tool. `expand` is the toolhelp flag.
 * Returns undefined when the tool is ungated.
 */
export function resolveToolGateTable(
  toolName: string,
  expand: boolean,
): RuleTable | undefined {
  if (!expand && toolName !== "web_search" && toolName !== "web_fetch") {
    return undefined;
  }
  return TOOL_GATE_REGISTRY[toolName];
}
