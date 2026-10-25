/**
 * The host half of a browser card's actions: the one network call the card may
 * make, and the one it may never make itself.
 *
 * This is `useMailHost`'s shape and for `useMailHost`'s reason. The route
 * client behind `answerCard` opens the pairing secret store on import, and the
 * card sits inside a transcript that dozens of render tests draw without a
 * computer anywhere near them. Owning the call HERE is what keeps the shell's
 * module graph free of it.
 */
import { useMemo } from "react";

import type { BrowserActions } from "../ui/shell/browserActions";
import { answerBrowserCard } from "../engine/remote/browserApi";
import type { MessageActions } from "./messageActions";

export function useBrowserActions(
  spentBrowserCard: MessageActions["spentBrowserCard"],
): BrowserActions {
  return useMemo(
    () => ({ answerCard: answerBrowserCard, spentBrowserCard }),
    [spentBrowserCard],
  );
}