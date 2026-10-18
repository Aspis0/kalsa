import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { clearBrowserData } from "../../lib/driver";
import { refreshBrowserStatus } from "../../lib/browser/useStatus";
import { Icon } from "../Icon";

/** The one control over what the browser kept: the logins, the cookies and
    the history, in a profile that is Kalsa's own folder and never a copy of
    the person's.

    It asks once, because clearing is not undoable — and the ask is a press on
    a second button rather than a dialog, so a person who came here to read the
    version number does not have to dismiss anything on the way.

    A clear that did not happen says so and stays in place. Saying "cleared"
    over a failure is the worst thing this row could do: the person walks away
    believing their sessions are gone, and they are not. */
export function ClearBrowserData() {
  const { table } = useLanguage();
  const t = table.driver;
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<"done" | "failed" | null>(null);

  if (outcome !== null) return <div className="settings-row">
    <div className="settings-row-text">
      <span className="settings-row-title">{t.clearTitle}</span>
      {outcome === "done" ? <span className="settings-ok"><Icon name="check" size={15} stroke={2.6} />{t.cleared}</span>
        : <span className="settings-update-title">{t.clearFailed}</span>}
    </div>
  </div>;

  return <>
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{t.clearTitle}</span>
        <span className="settings-row-hint">{t.clearHint}</span>
      </div>
      {asking ? <button
        type="button"
        className="settings-btn is-primary"
        onClick={() =>
          clearBrowserData().then(
            () => {
              // A clear leaves the driver in place, so the tools stay offered —
              // and the row must say so from the same read the app started with.
              void refreshBrowserStatus();
              setOutcome("done");
            },
            () => setOutcome("failed"),
          )}
      >
        <Icon name="trash" size={17} />
        {t.clear}
      </button> : <button
        type="button"
        className="settings-more"
        aria-expanded={asking}
        onClick={() => setAsking(true)}
      >
        {t.clearTitle}
        <Icon name="right" size={16} stroke={2.2} />
      </button>}
    </div>
  </>;
}