import { useState } from "react";

import { useLanguage } from "../../i18n/useLanguage";
import { rustSentence } from "../../lib/rustText";
import { answer, destinationLabel, DOTS, type Card, type CardField, type Outcome, type Settled } from "../../lib/browser/confirm";
import { isCardAlreadyResolved, isPressThatNeverLeft } from "../../lib/browser/codes";
import { useConfirm } from "../../lib/browser/useConfirm";
import "./BrowserConfirm.css";

type ConfirmTable = ReturnType<typeof useLanguage>["table"]["confirm"];

/**
 * The card a person is asked about: who it goes to, what it carries, and the two
 * answers.
 *
 * **Host, and what the page calls each field.** The header names the host the
 * request would reach, and nothing else of its address — no method, no path, no
 * query. Each non-empty field is one line, `label: value`, with the words the page
 * puts beside it; a field the page gave no words to is drawn with its name.
 *
 * **Fields as sent, and what the person typed not repeated.** The value the site
 * wrote into the form is what the card shows — not a summary of it. The one
 * exception is a value the *person* typed into a password field while they had
 * the browser: that was taken out where the request was read, and the card says
 * so instead of showing it. A secret field is dots until its Show button is
 * pressed, and nothing else is masked.
 *
 * **One press is one request, and an answered card is one line.** The card
 * collapses to what became of it the moment it is answered, and its fields leave
 * the window with it; the id is spent inside the sidecar before anything is
 * dispatched, so a second press cannot send a second request.
 */
export function BrowserConfirm({ conversation }: { conversation: string }) {
  const { cards, settled } = useConfirm(conversation);
  const { table } = useLanguage();
  if (cards.length === 0 && settled.length === 0) return null;
  return (
    <div className="browser-confirms">
      {settled.map((one) => <Answered key={one.id} settled={one} t={table.confirm} />)}
      {cards.map((card) => <Card key={card.id} card={card} conversation={conversation} />)}
    </div>
  );
}

/**
 * An answered card: one line, in the person's language, out of a code and a host.
 *
 * **Nothing the page wrote is on it.** The words are this app's, and the only thing
 * that came from the other side is which of the six outcomes this was. Until the
 * sidecar has said which, the line says the request is on its way.
 */
function Answered({ settled, t }: { settled: Settled; t: ConfirmTable }) {
  const { table, tag } = useLanguage();
  // **A card closed without an outcome says so in the app's own words.** The press
  // found the request already resolved somewhere else, so there is no outcome to
  // draw — and the line is the fixed sentence for that code, never the prose the
  // refusal carried.
  const words = settled.outcome !== null
    ? outcomeWords(t)(settled.outcome)
    : settled.closed !== null ? rustSentence(table.rust, { code: settled.closed }, tag) : t.asking;
  return <p className="browser-confirm-outcome" data-card={settled.id}>{words}</p>;
}

/** The line itself, from the language table. A host is named only where a
 * request actually went. */
function outcomeWords(t: ConfirmTable): (outcome: Outcome) => string {
  return ({ code, host }) => {
    switch (code) {
      case "sent":
        return host ? t.sentTo(host) : t.notSentHidden;
      case "declined":
        return t.notSentNo;
      case "expired":
        return t.notSentLate;
      case "gone":
        return t.notSentGone;
      case "unsendable":
        return t.notSentHidden;
      default:
        return t.unclear;
    }
  };
}

/**
 * One field, as the card lists it: `label: value`.
 *
 * **Revealed is local state and nothing else.** It is not lifted, not stored, not
 * carried on the card: the value is already in `field`, and it is in exactly one
 * place — this component, for as long as this card is drawn. Pressing Show for
 * one field does not reveal the others.
 */
function Field({ field, label }: { field: CardField; label: ConfirmWords }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="browser-confirm-field">
      <span className="browser-confirm-name">{field.label ?? field.name}:</span>
      <span className={`browser-confirm-value${field.secret && !shown ? " is-secret" : ""}`}>
        {field.secret && !shown ? DOTS : field.value}
      </span>
      {field.secret
        ? <button
          type="button"
          className="browser-confirm-show"
          aria-expanded={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? label.hide : label.show}
        </button>
        : null}
    </div>
  );
}

/** The two words the toggle needs, out of the language table. */
type ConfirmWords = { show: string; hide: string };

function Card({ card, conversation }: { card: Card; conversation: string }) {
  const { table, tag } = useLanguage();
  const t = table.confirm;
  const [asking, setAsking] = useState(false);
  // **What the person is told when a press never went.** The browser was busy, or
  // the request was not waiting for an answer any more: nothing was sent either
  // way, so the card is still waiting — and a press that leaves no word behind
  // is a press the person cannot tell from one that worked.
  const [notice, setNotice] = useState<string | null>(null);
  // A field with no value is not something the person is asked to read.
  const filled = card.fields.filter((field) => field.value !== "");
  // **The host is what the sidecar's parser said, never what this window works
  // out**: two parsers of one address are two answers, and this one shows the
  // person where their data goes.
  const destination = card.destination;
  // **No destination, no send.** There is nothing here for a person to be
  // agreeing to, and the sidecar refuses the press as well — the button is gone so
  // the decision is never offered, not so a refusal can catch it.
  const sendable = destination !== null;

  async function press(allow: boolean): Promise<void> {
    if (asking) return;
    setAsking(true);
    setNotice(null);
    const pressed = await answer(allow, card.id, conversation);
    // **A press that never went leaves the card as it was.** The buttons come
    // back with it, and the person is told why in their own words: the card is
    // still waiting, and nothing was sent.
    //
    // **A card that was already resolved elsewhere is closed**, and its buttons
    // do not come back: there is nothing left to press about it, and a button
    // that could only be refused again is not a decision.
    if (pressed.code !== null && isPressThatNeverLeft(pressed.code) && !isCardAlreadyResolved(pressed.code)) {
      setAsking(false);
      setNotice(rustSentence(table.rust, { code: pressed.code }, tag));
    }
  }

  return <div className="browser-confirm" data-card={card.id}>
    <div className="browser-confirm-head">
      <span className="browser-confirm-title">
        {sendable ? t.wantsToSend(destinationLabel(destination)) : t.nowhere}
      </span>
      <span className="browser-confirm-waiting">{t.waiting}</span>
    </div>
    {notice !== null ? <p className="browser-confirm-notice">{notice}</p> : null}
    {destination !== null && !destination.secure ? <p className="browser-confirm-insecure">{t.insecure}</p> : null}
    {destination === null ? <p className="browser-confirm-nowhere">{t.nowhereWhy}</p> : null}
    {filled.length === 0
      ? <div className="browser-confirm-fields"><div className="browser-confirm-none">{t.none}</div></div>
      : <div className="browser-confirm-fields">
        {filled.map((field, index) => <Field key={`${card.id}:${index}`} field={field} label={t} />)}
      </div>}
    <div className="browser-confirm-answers">
      {sendable
        ? <button
          type="button"
          className="browser-confirm-answer is-allow"
          disabled={asking}
          onClick={() => void press(true)}
        >
          {t.allow}
        </button>
        : null}
      <button
        type="button"
        className="browser-confirm-answer"
        disabled={asking}
        onClick={() => void press(false)}
      >
        {t.decline}
      </button>
    </div>
  </div>;
}
