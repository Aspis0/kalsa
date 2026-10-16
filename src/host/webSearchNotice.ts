/**
 * The host half of the one-time first-search notice: the confirm dialog.
 * Split from the gate (src/search/firstSearchNotice.ts) so that gate stays
 * UI-free and testable, and so nothing under src/agent or src/search has to
 * reach a dialog.
 */
import { Alert } from "react-native";

import { getStrings, type Locale } from "../i18n";

/**
 * Show the notice once and resolve the user's answer. False covers "Not now",
 * a dismiss and any buttonless dismissal: only an explicit "Search" is consent.
 *
 * The provider name arrives from the registry and is interpolated into the
 * copy here, never hardcoded in the catalog strings. Neither button is
 * focused — "Not now" leads and is cancel-styled — so a stray Enter cannot
 * accept the search.
 */
export function showFirstWebSearchNotice(
  providerName: string,
  locale: Locale,
): Promise<boolean> {
  const notice = getStrings(locale).searchNotice;
  const body = notice.body.replace(/\{provider\}/g, providerName);
  return new Promise((resolve) => {
    Alert.alert(
      notice.title,
      body,
      [
        { text: notice.notNow, style: "cancel", onPress: () => resolve(false) },
        { text: notice.search, onPress: () => resolve(true) },
      ],
      // A dialog dismissed with the back gesture or the hardware button is a
      // "no": it resolves false and the notice comes back next search.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}