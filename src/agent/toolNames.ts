/** Shared, dependency-free tool-name surface for registries and telemetry. */

export type ToolName =
  | "web_search"
  | "web_fetch"
  | "document_chat"
  | "device_info"
  | "device_calc"
  | "calendar_agenda";

export const ALL_TOOL_NAMES = Object.freeze([
  "web_search",
  "web_fetch",
  "document_chat",
  "device_info",
  "device_calc",
  "calendar_agenda",
] as const satisfies readonly ToolName[]);
