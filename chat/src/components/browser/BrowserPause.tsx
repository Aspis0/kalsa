import { useState } from "react";

import { useLanguage } from "../../i18n/useLanguage";
import { useConfirm } from "../../lib/browser/useConfirm";
import { pressPause } from "../../lib/browser/confirm";
import "./BrowserConfirm.css";

/**
 * Pausa: Kalsa stops driving the browser until the person says otherwise.
 *
 * **It stops the next action and nothing else.** A click already sent, a request
 * already confirmed, a page already moving: none of it is recalled, and a
 * control that implied it would be is worse than no control. So the sentence
 * that says so sits next to the button rather than being left to be discovered,
 * and a card still waiting is still answered — pausing is not declining.
 *
 * **It is drawn only while a window is open**, because it is the window's
 * control and not a setting of the app. On a fresh launch there is no browser
 * anywhere, and a pause button over nothing is a promise about a window nobody
 * has: the app said its messages stayed on this computer, and this was the one
 * control on the screen speaking for something else.
 */
export function BrowserPause() {
  const { table } = useLanguage();
  const t = table.confirm;
  // Pausing is about the window, which every chat shares, so this reads nothing
  // of any conversation's cards — it is the one control here that is not.
  const { paused, windowOpen } = useConfirm("");
  const [asking, setAsking] = useState(false);

  // **The sidecar is told first, and the button shows what it said.** A control
  // that says "paused" while the browser is still being driven is worse than no
  // control: the person would be trusting a promise nobody kept. A pause that
  // cannot be delivered leaves the button as it was.
  async function press(): Promise<void> {
    if (asking) return;
    setAsking(true);
    await pressPause(!paused);
    setAsking(false);
  }

  if (!windowOpen) return null;

  return <div className="browser-pause">
    <button
      type="button"
      className={`browser-pause-button${paused ? " is-paused" : ""}`}
      aria-pressed={paused}
      disabled={asking}
      title={t.pauseHint}
      onClick={() => void press()}
    >
      {paused ? t.resume : t.paused}
    </button>
    <span>{paused ? t.runningHint : t.pauseHint}</span>
  </div>;
}