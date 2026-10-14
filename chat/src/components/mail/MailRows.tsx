import { useLanguage } from "../../i18n/useLanguage";
import type { DraftRecord, Drafts, SentTo } from "../../lib/mail/drafts";
import type { MailCardItem } from "../../lib/mail/types";
import { MailCardsView } from "./MailCards";
import type { ToolRun } from "../../lib/types";
import { MAIL_TOOLS } from "../../lib/tools/definitions";
import type { PendingSend } from "../../lib/mail/pending";

/**
 * The mail a turn drew, above its answer — the same place a miniapp's view
 * stands, because both are the turn's own drawing and not part of the prose.
 * A run whose cards were only ever in memory shows the count it left behind.
 */

const NAMES = new Set(MAIL_TOOLS.map((tool) => tool.function.name));

export function MailRows({
  runs,
  selected,
  onOpen,
  onDraft,
  onSend,
  sent,
  drafts,
  onSave,
  onComposeMail,
}: {
  runs: ToolRun[];
  /** The card the Mail tab is showing, so the thread can mark it. */
  selected: string | null;
  onOpen: (item: MailCardItem) => void;
  onDraft: (item: MailCardItem) => void;
  onSend: (send: PendingSend) => void;
  sent: SentTo;
  drafts: Drafts;
  onSave: (replyToId: string, record: DraftRecord) => void;
  onComposeMail: (replyToId: string, body: string) => void;
}) {
  const { table } = useLanguage();
  const t = table.mail;
  const drawn = runs.filter((run) => run.mail !== undefined);
  const stubs = runs.filter((run) => run.mail === undefined && run.mailShown !== undefined);
  if (drawn.length === 0 && stubs.length === 0) return null;
  return (
    <>
      {stubs.map((run) => (
        <p className="mail-stub" key={run.id}>
          {t.shownCount(run.mailShown as number)}
        </p>
      ))}
      {drawn.map((run) => {
        const mail = run.mail;
        if (mail === undefined) return null;
        return (
          <MailCardsView
            key={run.id}
            mail={mail}
            selected={selected}
            onOpen={onOpen}
            onDraft={onDraft}
            onSend={onSend}
            sent={sent}
            drafts={drafts}
            onSave={onSave}
            onCompose={onComposeMail}
          />
        );
      })}
    </>
  );
}

/** Whether a name is one of the mailbox's tools, so the reader's rows stay
    quiet about them: the cards are the tool's whole visible output. */
export function isMailTool(name: string): boolean {
  return NAMES.has(name);
}