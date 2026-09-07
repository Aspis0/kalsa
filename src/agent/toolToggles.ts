/** AsyncStorage keys for optional local tools. */

export const WEB_TOOLS_ENABLED_KEY = "kalsa.web.enabled";
export const DEVICE_TOOLS_KEY = "kalsa.tools.device";
export const CALENDAR_TOOLS_KEY = "kalsa.tools.calendar";

export type ToolToggleKey =
  | typeof WEB_TOOLS_ENABLED_KEY
  | typeof DEVICE_TOOLS_KEY
  | typeof CALENDAR_TOOLS_KEY;

/** Device tools default ON. Calendar default OFF. */
export function parseToolToggle(raw: string | null | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw === "") return defaultOn;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return defaultOn;
}
