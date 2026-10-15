import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import type { English } from "../../i18n/en/all";
import { Icon } from "../Icon";
import { accountEmail } from "../../lib/mail/account";
import { draftFor, pendingFor, sentToFor } from "../../lib/mail/drafts";
import type { Drafts, SentTo } from "../../lib/mail/drafts";
import type { PendingSend } from "../../lib/mail/pending";
import { reasonItems } from "../../lib/mail/reasons";
import type { MailCardItem, MailRecord } from "../../lib/mail/types";
import { initials } from "./initials";
import { stampFull, stampRelative } from "./mailTime";
import { useAutoSize } from "./autoSize";
import { SendControls } from "./SendConfirm";
import "./mail.css";

/**
 * The mail open beside the chat: who wrote it, when, the subject, the whole
 * text, what is attached, and the line Kalsa wrote about it. The body is the
 * stranger's own words — nothing here acts on them, and the only way a reply
 * leaves this computer is the send button and the press after it.
 */

export interface OpenMail {
  item: MailCardItem;
  record: MailRecord | null;
  body: string;
}

export function MailView({ open, onDraft, onReply, onAskDraft, onSend, drafts, sent }: {
  open: OpenMail | null;
  onDraft: (body: string) => void;
  /** The person typed: only the words change, never the recipient. */
  onReply: (replyToId: string, body: string) => void;
  /** A draft the sidecar wrote, with the address the backend will send to. */
  /** Genera bozza: the chat model writes the reply, the box shows it. */
  onAskDraft: (item: MailCardItem) => void;
  onSend: (send: PendingSend) => void;
  /** The replies in hand, so the chat's card and this box are one reply rather
      than a box here and a different one there. */
  drafts: Drafts;
  sent: SentTo;
}) {
  const { table, tag } = useLanguage();
  const t = table.mail;
  const [copied, setCopied] = useState(false);

  // This mail's own reply. Opening another mail shows that mail's words or an
  // empty box, never the reply that was written for somebody else.
  const reply = draftFor(drafts, open?.item.id ?? "");
  const replyBox = useAutoSize(reply === null ? "" : reply.body);

  if (open === null) {
    return (
      <div className="mail-view">
        <p className="panel-empty">{t.noMail}</p>
      </div>
    );
  }
  const { item, record, body } = open;
  const sentTo = sentToFor(sent, item.id);
  const shown: MailRecord | MailCardItem = record ?? item;
  const preview = record?.snippet ?? "";
  const name = shown.from.name || shown.from.address;
  const reasons = shown.labels.label === "suspicious" ? reasonItems(t, shown.labels.reasons) : [];
  const attachments = record?.attachments ?? [];
  const recipient = accountEmail();
  const words = reply === null ? "" : reply.body;
  // Recipient, subject and body are the sidecar's own draft for this mail: the
  // backend sends to that address, and to nothing this panel could guess.
  const pending = pendingFor(drafts, item.id);

  return (
    <div className="mail-view">
      <div className="mail-view-head">
        <span className="mail-avatar" aria-hidden="true">{initials(name)}</span>
        <div className="mail-view-who">
          <span className="mail-view-name">{name}</span>
          <span className="mail-view-addr">{shown.from.address}</span>
        </div>
        <span className="mail-when">{stampRelative(shown.date, tag)}</span>
      </div>

      <p className="mail-view-full">{stampFull(shown.date, tag)}</p>
      <h3 className="mail-view-subject">{shown.subject}</h3>
      <p className="mail-view-to">{t.to}: {recipient || shown.from.address}</p>
      <hr className="mail-rule" />

      {reasons.length > 0 ? (
        <div className="mail-suspect">
          <span className="mail-suspect-head">
            <Icon name="alert" size={14} />
            <b>{t.suspicious}</b>
          </span>
          <ul className="mail-reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mail-body">{body || preview}</div>

      <section className="mail-gist-box">
        <p className="mail-gist-title">
          <Icon name="zap" size={15} />
          {t.aiSummary}
        </p>
        <p className="mail-gist-text">{item.gist || preview}</p>
      </section>

      <section className="mail-attach">
        <p className="mail-gist-title">
          <Icon name="paperclip" size={15} />
          {t.attachments}
        </p>
        {attachments.length === 0 ? (
          <p className="mail-attach-none">{t.noAttachments}</p>
        ) : (
          <ul className="mail-attach-list">
            {attachments.map((file) => (
              <li key={file.name}>
                <span>{file.name}</span>
                <span className="mail-attach-size">{size(file.size, t)}</span>
              </li>
            ))}
          </ul>
        )}
        {(record?.threadIds.length ?? 0) > 1 ? (
          <p className="mail-thread">{countMessages(record?.threadIds.length ?? 0, t.oneMessage, t.otherMessages)}</p>
        ) : null}
      </section>

      <section className="mail-reply">
        <div className="mail-reply-head">
          <span className="mail-gist-title">{t.replyDraft}</span>
          <button
            type="button"
            className="mail-btn"
            disabled={sentTo !== null}
            onClick={() => onAskDraft(open.item)}
          >
            <Icon name="zap" size={15} />
            {t.makeDraft}
          </button>
        </div>
        {words !== "" ? (
          <textarea
            className="mail-draft-body"
            aria-label={t.body}
            ref={replyBox}
            value={words}
            onChange={(event) => onReply(item.id, event.target.value)}
            readOnly={sentTo !== null}
          />
        ) : null}
        {words !== "" ? (
          <SendControls
            pending={pending}
            sentTo={sentTo}
            onAsk={onSend}
            onEdit={() => onDraft(words)}
            onCopy={() => {
              void navigator.clipboard?.writeText(words).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            copied={copied}
          />
        ) : null}
      </section>
    </div>
  );
}

function size(bytes: number, t: English["mail"]): string {
  return bytes < 1024 ? t.size(bytes) : t.bigSize(Math.round(bytes / 1024));
}

function countMessages(count: number, one: string, many: (n: number) => string): string {
  return count === 2 ? one : many(count - 1);
}
