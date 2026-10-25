/**
 * The mail actions a transcript card offers, reachable from the answer they
 * hang under.
 *
 * A context rather than props: the actions belong to the conversation, not to
 * a row, and they are read by a card that is four levels below the host's
 * entry point — while every frame between them is a component that already
 * passes its own props and has nothing to say about mail. Absent (a preview,
 * or a local turn with no cards) `useMailActions` returns null and the cards
 * draw their words without buttons.
 */
import { createContext, useContext } from "react";

import type { MailActions } from "../../host/useMailHost";

export const MailActionsContext = createContext<MailActions | null>(null);

export function useMailActions(): MailActions | null {
  return useContext(MailActionsContext);
}