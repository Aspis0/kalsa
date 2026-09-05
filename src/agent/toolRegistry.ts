/**
 * Contributor checklist for a new tool:
 * 1. Add the name to toolNames.ts and keep ALL_TOOL_NAMES in wire order.
 * 2. Add the EngineTool export and TOOL_ENTRIES row: toggleKey/defaultOn and
 *    gateTable belong on the row.
 * 3. Add the explicit AppShell executeTool branch; keep the unknown-tool else.
 * 4. If gated by a toggle, add the AppShell defense-in-depth guard and any
 *    state/prewarm dependencies required by that toggle.
 * 5. If user-visible, add the Settings UI read/write path and storage key.
 * 6. Add required i18n strings.
 * 7. For privacy gates, add the RuleTable and set TOOL_ENTRIES.gateTable;
 *    toolGateRegistry derives its lookup from those rows. web_fetch is gated
 *    for sensitive patterns on url + query.
 */

import type { EngineTool } from "../engine/LlamaService";
import { DOCUMENT_CHAT_TOOL } from "../documents/documentChatTool";
import { CALENDAR_GATE_TABLE } from "../rules/calendarGate";
import { TOOL_GATE_TABLE } from "../rules/toolGate";
import { WEB_FETCH_GATE_TABLE } from "../rules/webFetchGate";
import type { RuleTable } from "../rules/evaluate";
import {
  CALENDAR_TOOLS_KEY,
  DEVICE_TOOLS_KEY,
  type ToolToggleKey,
  WEB_TOOLS_ENABLED_KEY,
} from "./toolToggles";
import { CALENDAR_AGENDA_TOOL } from "./calendarTool";
import { DEVICE_CALC_TOOL, DEVICE_INFO_TOOL } from "./deviceTools";
import { ALL_TOOL_NAMES, type ToolName } from "./toolNames";
import { WEB_FETCH_TOOL } from "./webFetchTool";
import { WEB_SEARCH_TOOL } from "./webSearchTool";
import { WRITE_NOTE_TOOL } from "./writeNoteTool";

export { ALL_TOOL_NAMES, type ToolName } from "./toolNames";

export type ToolEntry = {
  name: ToolName;
  def: EngineTool;
  toggleKey: ToolToggleKey | null;
  defaultOn: boolean;
  gateTable: RuleTable | null;
};

type RegistryInvariantEntry = {
  name: string;
  def: Pick<EngineTool, "function">;
};

export function assertRegistryInvariants(
  entries: readonly RegistryInvariantEntry[],
  names: readonly string[],
): void {
  if (entries.length !== names.length) {
    throw new Error(
      `[toolRegistry] length mismatch: entries=${entries.length}, names=${names.length}`,
    );
  }

  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const listedName = names[index];
    if (entry.name !== listedName) {
      throw new Error(
        `[toolRegistry] name mismatch at index ${index}: entry=${JSON.stringify(
          entry.name,
        )}, names=${JSON.stringify(listedName)}`,
      );
    }
    if (entry.def.function.name !== entry.name) {
      throw new Error(
        `[toolRegistry] definition mismatch at index ${index}: entry=${JSON.stringify(
          entry.name,
        )}, def=${JSON.stringify(entry.def.function.name)}`,
      );
    }
    if (seen.has(entry.name)) {
      throw new Error(`[toolRegistry] duplicate entry name: ${JSON.stringify(entry.name)}`);
    }
    seen.add(entry.name);
  });
}

export const TOOL_ENTRIES = [
  {
    name: "web_search",
    def: WEB_SEARCH_TOOL,
    toggleKey: WEB_TOOLS_ENABLED_KEY,
    defaultOn: true,
    gateTable: TOOL_GATE_TABLE,
  },
  {
    name: "web_fetch",
    def: WEB_FETCH_TOOL,
    toggleKey: WEB_TOOLS_ENABLED_KEY,
    defaultOn: true,
    gateTable: WEB_FETCH_GATE_TABLE,
  },
  {
    name: "document_chat",
    def: DOCUMENT_CHAT_TOOL,
    toggleKey: null,
    defaultOn: true,
    gateTable: null,
  },
  {
    name: "write_note",
    def: WRITE_NOTE_TOOL,
    toggleKey: null,
    defaultOn: true,
    gateTable: null,
  },
  {
    name: "device_info",
    def: DEVICE_INFO_TOOL,
    toggleKey: DEVICE_TOOLS_KEY,
    defaultOn: true,
    gateTable: null,
  },
  {
    name: "device_calc",
    def: DEVICE_CALC_TOOL,
    toggleKey: DEVICE_TOOLS_KEY,
    defaultOn: true,
    gateTable: null,
  },
  {
    name: "calendar_agenda",
    def: CALENDAR_AGENDA_TOOL,
    toggleKey: CALENDAR_TOOLS_KEY,
    defaultOn: false,
    gateTable: CALENDAR_GATE_TABLE,
  },
] as const satisfies readonly ToolEntry[];

export function assembleTools(flags: {
  web: boolean;
  device: boolean;
  calendar: boolean;
}): EngineTool[] {
  const enabledByToggle: Record<ToolToggleKey, boolean> = {
    [WEB_TOOLS_ENABLED_KEY]: flags.web,
    [DEVICE_TOOLS_KEY]: flags.device,
    [CALENDAR_TOOLS_KEY]: flags.calendar,
  };

  return TOOL_ENTRIES.filter((entry) =>
    entry.toggleKey === null
      ? entry.defaultOn
      : enabledByToggle[entry.toggleKey],
  ).map((entry) => entry.def);
}

assertRegistryInvariants(TOOL_ENTRIES, ALL_TOOL_NAMES);
