/**
 * What a browser card may ask the host to do, and nothing else.
 *
 * The card's answer is a **network call to the computer**, and the network
 * client drags the pairing secret store in with it. So the card never imports
 * it: the card asks through here, the host owns the client, and the
 * transcript's module graph stops at a context — which is why the mail card is
 * built this way and why this one is too. A shell render test that never opens
 * a door must not have to load a secret store to draw a card.
 *
 * A context rather than props, for `mailActions`' reason: the actions belong to
 * the conversation, not to a row, and the card that reads them is four levels
 * below the surface that owns the messages.
 *
 * Absent (a preview, a local turn with no computer) `useBrowserActions`
 * returns null and the card draws its words without buttons — a card that
 * cannot reach the computer must not offer a press that goes nowhere.
 */
import { createContext, useContext } from "react";

import type { BrowserAnswer } from "../../domain/browserCardPayload";
import type { MessageActions } from "../../host/messageActions";
import type { BrowserAnswerVerb } from "../../engine/remote/browserApi";

export type BrowserActions = Pick<MessageActions, "spentBrowserCard"> & {
  /** The one answer a card may ever send (§3.1). */
  answerCard: (cardId: string, verb: BrowserAnswerVerb) => Promise<BrowserAnswer>;
};

export const BrowserActionsContext = createContext<BrowserActions | null>(null);

export function useBrowserActions(): BrowserActions | null {
  return useContext(BrowserActionsContext);
}