/** Shared, dependency-free tool-name surface for registries and telemetry. */

export type ToolName =
  | "web_search"
  | "web_fetch"
  | "document_chat"
  | "write_note"
  | "device_info"
  | "device_calc"
  | "calendar_agenda"
  | "create_miniapp";

export const ALL_TOOL_NAMES = Object.freeze([
  "web_search",
  "web_fetch",
  "document_chat",
  "write_note",
  "device_info",
  "device_calc",
  "calendar_agenda",
  "create_miniapp",
] as const satisfies readonly ToolName[]);
