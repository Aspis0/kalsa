import type { GateCheck } from "../lib/tools/registry";
import { useLanguage } from "../i18n/useLanguage";
import "./WebGateDialog.css";

/**
 * The ask itself, shown before a web call leaves an app with documents
 * attached: which tool, the exact string that would leave, what the detector
 * saw, and the two choices. It sits in the page like the other banners rather
 * than as a modal — the turn stays visible behind it, and Stop stays
 * reachable while the owner thinks. Refusing answers the turn as a tool
 * result; nothing here throws and nothing here says "blocked".
 */
export function WebGateDialog({
  id,
  check,
  waiting = 0,
  onAnswer,
}: {
  /** The ask this dialog is showing; the answer names it back, so a click
      settles this ask — or nothing, if it is already gone. */
  id: string;
  check: GateCheck;
  /** Asks queued behind this one, from other conversations streaming at once. */
  waiting?: number;
  onAnswer: (id: string, allow: boolean) => void;
}) {
  const { table } = useLanguage();
  const t = table.tools;
  const search = check.tool === "web_search";
  const docs = check.documents.length === 1 ? t.oneDocument : t.documentsAttached(check.documents.length);
  return (
    <section className="webgate" role="alertdialog" aria-modal="false" aria-labelledby="webgate-title">
      <h2 id="webgate-title">{search ? t.searchWaitingTitle : t.pageWaitingTitle}</h2>
      <p className="webgate-why">{t.gateWhy(docs)}</p>
      <p className="webgate-label">
        {search ? t.exactTextSearch : t.exactTextPage}
      </p>
      <pre className="webgate-outgoing">{check.outgoing}</pre>
      {check.findings.length > 0 ? (
        <ul className="webgate-findings">
          {check.findings.map((finding, at) => (
            <li key={at}>
              <strong>{t.findings[finding.kind] ?? finding.kind}</strong>
              {finding.source ? <span>{t.findingFrom(finding.source)}</span> : null}: <span className="webgate-matched">“{finding.matched}”</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="webgate-clean">{t.nothingRecognisable}</p>
      )}
      {waiting > 0 ? (
        <p className="webgate-why">
          {waiting === 1 ? t.oneMoreWaiting : t.moreWaiting(waiting)}
        </p>
      ) : null}
      <div className="webgate-actions">
        <button type="button" className="webgate-allow" onClick={() => onAnswer(id, true)} autoFocus>
          {t.sendIt}
        </button>
        <button type="button" className="webgate-refuse" onClick={() => onAnswer(id, false)}>
          {t.refuse}
        </button>
      </div>
    </section>
  );
}
