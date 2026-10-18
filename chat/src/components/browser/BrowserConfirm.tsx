import { useState } from "react";

import { useLanguage } from "../../i18n/useLanguage";
import { answer, DOTS, type Card, type CardField, type Outcome } from "../../lib/browser/confirm";
import { useConfirm } from "../../lib/browser/useConfirm";
import "./BrowserConfirm.css";

/**
 * The card a person is asked about: what would be sent, to where, and the two
 * answers.
 *
 * **Everything on it is the request, not Kalsa.** A person is being asked to
 * decide whether a stranger's site may receive this, so the card is about that
 * request and never about what a model was trying to achieve.
 *
 * **Fields as sent, and what the person typed not repeated.** The value the site
 * wrote into the form is what the card shows — not a summary of it. The one
 * exception is a value the *person* typed into a password field while they had
 * the browser: that was taken out where the request was read, and the card says
 * so instead of showing it. A field the model filled is shown in full, however
 * much its name reads like a secret — the person typed that one and can see it.
 *
 * **One press is one request.** The card comes off before the answer is sent, so
 * a second press finds nothing to press about; and the id is spent inside the
 * sidecar before anything is dispatched, so even a press that got this far
 * twice cannot send one request twice.
 */
export function BrowserConfirm({ conversation }: { conversation: string }) {
  const { cards, outcome } = useConfirm(conversation);
  const { table } = useLanguage();
  if (cards.length === 0 && outcome === null) return null;
  return (
    <div className="browser-confirms">
      {outcome === null ? null : <Outcome outcome={outcome} words={outcomeWords(table.confirm)} />}
      {cards.map((card) => <Card key={card.id} card={card} conversation={conversation} />)}
    </div>
  );
}

/**
 * What became of the last request a person answered here.
 *
 * **One line, in their own language, out of a code and a host.** The words are
 * this app's, and the only thing that came from the other side is which of the
 * six outcomes this was — so what a stranger's site wrote is not on the screen
 * and cannot be phrased as ours. It is drawn above the cards rather than on one,
 * because the card it belongs to is gone: it was answered, and that is the news.
 */
function Outcome({ outcome, words }: { outcome: Outcome; words: (outcome: Outcome) => string }) {
  return <p className="browser-confirm-outcome">{words(outcome)}</p>;
}

/** The line itself, from the language table. A host is named only where a
 * request actually went. */
function outcomeWords(t: { sentTo: (host: string) => string; notSentNo: string; notSentLate: string; notSentGone: string; notSentHidden: string; unclear: string }): (outcome: Outcome) => string {
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
 * One field, and the Show button that reads it.
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
      <span className="browser-confirm-name">{field.name}</span>
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

/**
 * Where it goes — **with the values it carries drawn as dots**, like a field.
 *
 * A GET held for carrying a secret has the value in its address, and printing
 * the address in the clear would put it on screen twice: once in the query and
 * once as a field below. So the values of the card's own secret fields are
 * replaced in the address shown, and one Show button reads the whole line.
 */
function Where({ card, label }: { card: Card; label: ConfirmWords }) {
  const [shown, setShown] = useState(false);
  const secrets = card.fields.filter((field) => field.secret);
  const address = shown ? card.url : hideQueryValues(card.url, secrets);
  return (
    <p className="browser-confirm-where">
      <b>{card.method}</b> {address}
      {secrets.length === 0
        ? null
        : <button type="button" className="browser-confirm-show" aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? label.hide : label.show}
        </button>}
    </p>
  );
}

/** The address as it will be sent, with each secret field's value as dots. The
 * card's fields are the same pairs the address carries, so they are what says
 * which values to replace — and a value the person typed is flagged by value, so
 * a page cannot rename its way out of this either. */
function hideQueryValues(url: string, secrets: CardField[]): string {
  if (secrets.length === 0) return url;
  const at = url.indexOf("?");
  if (at < 0) return url;
  const query = url
    .slice(at + 1)
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const name = equals < 0 ? pair : pair.slice(0, equals);
      return secrets.some((field) => field.name === name) ? `${name}=${DOTS}` : pair;
    })
    .join("&");
  return `${url.slice(0, at + 1)}${query}`;
}

function Card({ card, conversation }: { card: Card; conversation: string }) {
  const { table } = useLanguage();
  const t = table.confirm;
  const [asking, setAsking] = useState(false);

  async function press(allow: boolean): Promise<void> {
    if (asking) return;
    setAsking(true);
    await answer(allow, card.id, conversation);
  }

  return <div className="browser-confirm" data-card={card.id}>
    <div className="browser-confirm-head">
      <span className="browser-confirm-title">{t.title}</span>
      <span className="browser-confirm-waiting">{t.waiting}</span>
    </div>
    <Where card={card} label={t} />
    {card.fields.length === 0
      ? <div className="browser-confirm-fields"><div className="browser-confirm-none">{t.none}</div></div>
      : <div className="browser-confirm-fields">
        {card.fields.map((field) => <Field key={`${card.id}:${field.name}`} field={field} label={t} />)}
      </div>}
    <div className="browser-confirm-answers">
      <button
        type="button"
        className="browser-confirm-answer is-allow"
        disabled={asking}
        onClick={() => void press(true)}
      >
        {t.allow}
      </button>
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