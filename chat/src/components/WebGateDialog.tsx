import type { GateCheck } from "../lib/tools/registry";
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
  const search = check.tool === "web_search";
  const docs = check.documents.length === 1 ? "One document is attached" : `${check.documents.length} documents are attached`;
  return (
    <section className="webgate" role="alertdialog" aria-modal="false" aria-labelledby="webgate-title">
      <h2 id="webgate-title">{search ? "A search is waiting to leave the app." : "A page request is waiting to leave the app."}</h2>
      <p className="webgate-why">
        {docs} to this conversation, so every web call is shown here first, before anything is sent.
      </p>
      <p className="webgate-label">
        The exact text that would be sent {search ? "as the search" : "as the address"}:
      </p>
      <pre className="webgate-outgoing">{check.outgoing}</pre>
      {check.findings.length > 0 ? (
        <ul className="webgate-findings">
          {check.findings.map((finding, at) => (
            <li key={at}>
              <strong>{finding.kind}</strong>
              {finding.source ? <span> from {finding.source}</span> : null}: <span className="webgate-matched">“{finding.matched}”</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="webgate-clean">Nothing recognisable was found in it.</p>
      )}
      {waiting > 0 ? (
        <p className="webgate-why">
          {waiting === 1 ? "Another call is waiting behind this one." : `${waiting} more calls are waiting behind this one.`}
        </p>
      ) : null}
      <div className="webgate-actions">
        <button type="button" className="webgate-allow" onClick={() => onAnswer(id, true)} autoFocus>
          Send it
        </button>
        <button type="button" className="webgate-refuse" onClick={() => onAnswer(id, false)}>
          Refuse
        </button>
      </div>
    </section>
  );
}
