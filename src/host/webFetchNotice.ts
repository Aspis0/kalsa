/**
 * The host half of the one-time first-fetch notice: the confirm dialog.
 * Split from the gate (src/search/firstFetchNotice.ts) for the same reason as
 * webSearchNotice.ts — the gate stays UI-free and testable, and nothing under
 * src/agent or src/search has to reach a dialog.
 */
import { Alert } from "react-native";

import { getStrings, type Locale } from "../i18n";

/**
 * Show the notice once and resolve the user's answer. False covers "Not now",
 * a dismiss and any buttonless dismissal: only an explicit "Open" is consent.
 *
 * Neither button is focused — "Not now" leads and is cancel-styled — so a
 * stray Enter cannot open a page.
 */
export function showFirstWebFetchNotice(locale: Locale): Promise<boolean> {
  const notice = getStrings(locale).fetchNotice;
  return new Promise((resolve) => {
    Alert.alert(
      notice.title,
      notice.body,
      [
        { text: notice.notNow, style: "cancel", onPress: () => resolve(false) },
        { text: notice.open, onPress: () => resolve(true) },
      ],
      // A dialog dismissed with the back gesture or the hardware button is a
      // "no": it resolves false and the notice comes back next fetch.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}