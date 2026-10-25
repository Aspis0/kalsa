import { WEB_TOOLS_ENABLED_KEY } from "../agent/toolToggles";

export type SetToolToggleItem = (
  key: typeof WEB_TOOLS_ENABLED_KEY,
  value: "1" | "0",
) => Promise<unknown>;

/** Persist the Web flag using its established storage key and encoding. */
export async function persistWebToolsEnabled(
  enabled: boolean,
  setItem: SetToolToggleItem,
): Promise<void> {
  try {
    await setItem(WEB_TOOLS_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // The in-memory choice remains active for this process if storage fails.
  }
}
