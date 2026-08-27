/** AsyncStorage keys for optional local tools. */

export const DEVICE_TOOLS_KEY = "kalsa.tools.device";
export const CALENDAR_TOOLS_KEY = "kalsa.tools.calendar";

/** Device tools default ON. Calendar default OFF. */
export function parseToolToggle(raw: string | null | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw === "") return defaultOn;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return defaultOn;
}
