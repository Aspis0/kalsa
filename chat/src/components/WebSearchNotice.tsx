import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
// The gate's own stylesheet: this is that dialog with the same shape and a
// shorter question, and a second set of rules for the same banner is how two
// dialogs stop looking like each other.
import "./WebGateDialog.css";

/**
 * The one-time notice, shown before this install's first search would leave:
 * which service receives it, and what that service sees. Drawn as the gate's
 * dialog because it is the same question asked of the same owner — the turn
 * stays visible behind it and Stop stays reachable. "Search" runs this search
 * and keeps the answer; "Not now" skips it and asks again next time.
 */
export function WebSearchNotice({
  id,
  provider,
  waiting = 0,
  onAnswer,
}: {
  /** The ask this notice is showing; the answer names it back, so a click
      settles this ask — or nothing, if it is already gone. */
  id: string;
  /** The active provider's own name, from the code that sends the query. */
  provider: string;
  /** Asks queued behind this one, from other conversations streaming at once. */
  waiting?: number;
  onAnswer: (id: string, allow: boolean) => void;
}) {
  const { table } = useLanguage();
  const t = table.tools;
  return (
    <section
      className="webgate"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="websearch-notice-title"
      data-notice="first-search"
    >
      <span className="webgate-icon" aria-hidden="true">
        <Icon name="globe" size={26} />
      </span>
      <h2 id="websearch-notice-title">{t.noticeTitle}</h2>
      <p className="webgate-why">{t.noticeBody(provider)}</p>
      {waiting > 0 ? (
        <p className="webgate-why">
          {waiting === 1 ? t.oneMoreWaiting : t.moreWaiting(waiting)}
        </p>
      ) : null}
      <div className="webgate-actions">
        <button type="button" className="webgate-refuse" onClick={() => onAnswer(id, false)}>
          {t.noticeNotNow}
        </button>
        {/* No autoFocus, unlike the gate's allow button: the composer still has
            focus, so an Enter the owner is typing lands here — and sends a
            search they never read about. */}
        <button type="button" className="webgate-allow" onClick={() => onAnswer(id, true)}>
          <Icon name="send" size={18} />
          {t.noticeGo}
        </button>
      </div>
    </section>
  );
}