/**
 * The one-time alpha telemetry notice: spoken through the host's single notice
 * slot (`useNotice` / `noticePort`) on the first launch where telemetry is on
 * and the notice has not been seen — every install, whatever the chat holds.
 * Seen is written only on the launch AFTER the slot took the text, so a killed
 * first launch does not swallow the notice.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { en, it } from "../i18n";
import { getTelemetryEnabled } from "../telemetry/telemetry";
import { noticePort } from "./useNotice";

/** Last launch handed the text to the slot; this launch may mark it seen. */
const SHOWN_KEY = "kalsa.notice.alphaTelemetry.shown";
const SEEN_KEY = "kalsa.notice.alphaTelemetry.seen";

export async function maybeShowAlphaTelemetryNotice(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(SEEN_KEY)) return;
    if (await AsyncStorage.getItem(SHOWN_KEY)) {
      await AsyncStorage.setItem(SEEN_KEY, "1");
      return;
    }
    if (!(await getTelemetryEnabled())) return;
    const port = noticePort.current;
    // No slot yet (notice hook not mounted) → nothing was shown; next launch retries.
    if (!port) return;
    port(`${en.settings.alphaTelemetryNotice}\n${it.settings.alphaTelemetryNotice}`);
    await AsyncStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // The notice never breaks the host.
  }
}
