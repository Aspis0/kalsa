import { useEffect, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { Icon } from "../Icon";
import { count as attachmentCount } from "../../lib/mail/attachments";
import { draftFor, pendingFor, sentToFor } from "../../lib/mail/drafts";
import type { DraftRecord, Drafts, SentTo } from "../../lib/mail/drafts";
import type { PendingSend } from "../../lib/mail/pending";
import { reasonItems } from "../../lib/mail/reasons";
import type { Mail, MailCardItem, MailDraft } from "../../lib/mail/types";
import { initials } from "./initials";
import { stampRelative } from "./mailTime";
import { useAutoSize } from "./autoSize";
import { SendControls } from "./SendConfirm";
import "./mail.css";

/**
 * The cards under an answer. Every field of a card came from the sidecar's own
 * record for that id — the model proposed which ids matter and wrote one line
 * each — so a card cannot carry a sender or a subject the mailbox never had.
 *
 * How many of them are drawn is the thread's decision, not this one's: it draws
 * what it is handed and says how many are held back, so one place knows what is
 * on screen and nothing here can draw the same mail twice.
 */

export function MailCardsView({ mail, more, onReveal, selected, onOpen, onDraft, onSend, sent, drafts, onSave, onCompose }: {
  mail: Mail;
  /** How many of `mail.items` are not drawn, for the button that brings them in. */
  more?: number;
  onReveal?: () => void;
  selected: string | null;
  onOpen: (item: MailCardItem) => void;
  onDraft: (item: MailCardItem) => void;
  /** Opens the confirmation. The cards never call the command themselves. */
  onSend: (send: PendingSend) => void;
  /** Where each reply went, under the mail it answers. */
  sent: SentTo;
  /** The replies in hand, under the mail each one answers. */
  drafts: Drafts;
  onSave: (replyToId: string, record: DraftRecord) => void;
  /** Modifica: the draft's words in the composer, where they can be rewritten.
    One meaning and one argument — the same words the panel's box would send. */
  onCompose: (body: string) => void;
}) {
  if (mail.kind === "draft") {
    return (
      <MailDraftCard
        draft={mail}
        drafts={drafts}
        sent={sent}
        onSave={onSave}
        onSend={onSend}
        onCompose={onCompose}
      />
    );
  }
  const { table } = useLanguage();
  const t = table.mail;
  // A mailbox holding nothing but newsletters still says so: the count is the only
  // thing that mail has to say, and an empty turn would say nothing at all.
  if (mail.items.length === 0 && mail.bulk === 0) return null;
  const rest = more ?? 0;
  return (
    <div className="mail-turn">
      <div className="mail-cards">
        {mail.items.map((item) => (
          <MailCard key={item.id} item={item} selected={selected === item.id} onOpen={onOpen} onDraft={onDraft} />
        ))}
      </div>
      {rest > 0 ? (
        <button type="button" className="mail-more" onClick={() => onReveal?.()}>
          {rest === 1 ? t.oneMoreMail : t.moreMail(rest)}
        </button>
      ) : null}
      {mail.bulk > 0 ? <p className="mail-bulk">{mail.bulk === 1 ? t.oneNewsletter : t.moreNewsletters(mail.bulk)}</p> : null}
      <p className="mail-careful">
        <Icon name="alert" size={14} />
        {t.careful}
      </p>
    </div>
  );
}

function MailCard({ item, selected, onOpen, onDraft }: {
  item: MailCardItem;
  selected: boolean;
  onOpen: (item: MailCardItem) => void;
  onDraft: (item: MailCardItem) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.mail;
  const name = item.from.name || item.from.address;
  const reasons = item.labels.label === "suspicious" ? reasonItems(t, item.labels.reasons) : [];

  return (
    <article className={`mail-card${selected ? " is-on" : ""}`}>
      <button type="button" className="mail-card-open" onClick={() => onOpen(item)}>
        <span className="mail-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="mail-card-head">
          <span className="mail-card-top">
            <span className="mail-from" title={item.from.address}>{name}</span>
            <span className="mail-when">{stampRelative(item.date, tag)}</span>
            <span className="mail-unread" aria-hidden="true" />
          </span>
          <span className="mail-subject">{item.subject}</span>
          {item.gist ? <span className="mail-gist">{item.gist}</span> : null}
          {reasons.length > 0 ? (
            <span className="mail-suspect">
              <span className="mail-suspect-head">
                <Icon name="alert" size={13} />
                <b>{t.suspicious}</b>
              </span>
              <ul className="mail-reasons">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </span>
          ) : null}
        </span>
        {/* The chevron stands on its own, centred, the way the mockup draws it:
            the time and the dot belong to the header line above it. */}
        <span className="mail-chevron" aria-hidden="true">
          <Icon name="right" size={16} />
        </span>
      </button>
      <div className="mail-card-actions">
        <button type="button" className="mail-btn" onClick={() => onOpen(item)}>
          <Icon name="mail" size={16} />
          {t.open}
        </button>
        <button type="button" className="mail-btn" onClick={() => onDraft(item)}>
          <Icon name="reply" size={16} />
          {t.replyDraft}
        </button>
        {attachmentCount(item.id) > 0 ? (
          <button type="button" className="mail-btn" onClick={() => onOpen(item)}>
            <Icon name="download" size={16} />
            {t.download}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** The draft, with the recipient fixed by the mail it answers. Sending is a
    second press on the confirm this opens; the card itself never sends. */
function MailDraftCard({ draft, drafts, sent, onSave, onSend, onCompose }: {
  draft: MailDraft;
  drafts: Drafts;
  sent: SentTo;
  onSave: (replyToId: string, record: DraftRecord) => void;
  onSend: (send: PendingSend) => void;
  onCompose: (body: string) => void;
}) {
  const { table } = useLanguage();
  const t = table.mail;
  const [copied, setCopied] = useState(false);
  /** This mail's own words, never another mail's. */
  const mine = draftFor(drafts, draft.replyToId);
  // The reply the model wrote becomes the one in hand, so the Mail tab shows
  // these words instead of an empty box of its own.
  useEffect(() => {
    if (mine === null) onSave(draft.replyToId, { to: draft.to, subject: draft.subject, body: draft.body });
  }, [draft.body, draft.replyToId, draft.subject, draft.to, mine, onSave]);
  const body = mine === null ? draft.body : mine.body;
  const to = draft.toName === "" ? draft.to : `${draft.toName} <${draft.to}>`;
  const sentTo = sentToFor(sent, draft.replyToId);
  const pending = pendingFor(drafts, draft.replyToId);
  const box = useAutoSize(body);

  return (
    <article className="mail-draft">
      <p className="mail-draft-row">
        <span className="mail-draft-key">{t.to}</span>
        <span className="mail-draft-value">{to}</span>
      </p>
      <p className="mail-draft-row">
        <span className="mail-draft-key">{t.subject}</span>
        <span className="mail-draft-value">{draft.subject}</span>
      </p>
      <textarea
        className="mail-draft-body"
        aria-label={t.body}
        ref={box}
        value={body}
        onChange={(event) => onSave(draft.replyToId, { to: draft.to, subject: draft.subject, body: event.target.value })}
        readOnly={sentTo !== null}
      />
      <SendControls
        pending={pending}
        sentTo={sentTo}
        onAsk={onSend}
        onCopy={() => {
          void navigator.clipboard?.writeText(body).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        onEdit={() => onCompose(body)}
        copied={copied}
      />
    </article>
  );
}