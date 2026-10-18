/**
 * The one thing a browser card needs from the host: the moment it stops being
 * answerable, its values have to go — and the values live in the message, not
 * in the card.
 *
 * A context rather than props for the reason `mailActions` gives: the card is
 * four levels below the surface that owns the messages, and every frame
 * between them has its own props and nothing to say about browsers. Absent (a
 * preview, a local turn) `useBrowserActions` returns null and the card draws a
 * dead card whose values stay until the turn is gone — which is still §6, only
 * later.
 */
import { createContext, useContext } from "react";

import type { MessageActions } from "../../host/messageActions";

export const BrowserActionsContext = createContext<Pick<
  MessageActions,
  "spentBrowserCard"
> | null>(null);

export function useBrowserActions(): Pick<MessageActions, "spentBrowserCard"> | null {
  return useContext(BrowserActionsContext);
}