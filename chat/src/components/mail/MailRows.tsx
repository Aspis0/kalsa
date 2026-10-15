import { useLanguage } from "../../i18n/useLanguage";
import type { DraftRecord, Drafts, SentTo } from "../../lib/mail/drafts";
import type { Mail, MailCards, MailCardItem } from "../../lib/mail/types";
import { MailCardsView, DRAWN } from "./MailCards";
import { MailFailureCard } from "./MailFailureCard";
import { mailFailure, UNKNOWN_FAILURE } from "../../lib/mail/failure";
import type { MailFailure } from "../../lib/mail/failure";
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
  onOpenMailSettings,
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
  onOpenMailSettings: () => void;
}) {
  const { table } = useLanguage();
  const t = table.mail;
  // A call that failed has a cause to say; it drew no cards, so it shows the
  // notice in their place.
  // A call the sidecar refused without a code of its own still failed, and a
  // silent failure is worse than a plain sentence.
  const notices = runs
    .filter((run) => NAMES.has(run.name) && (run.resultCode !== undefined || run.state === "failed" || run.state === "refused"))
    .map((run) => ({ id: run.id, why: mailFailure(run.resultCode) ?? UNKNOWN_FAILURE }))
    .filter((entry): entry is { id: string; why: MailFailure } => entry.why !== null);
  const told = new Set(notices.map((entry) => entry.id));
  // The list drew the cards, and a model's `mail_show` adds the one line it
  // wrote: an id the list already drew keeps its place and gains the gist. The
  // exception is an id past the cards the list draws — a selection the person
  // was shown is drawn as its own group rather than left behind a reveal, and
  // only the ids that are not already on screen go in it.
  const sets = runs.filter((run): run is ToolRun & { mail: MailCards } => run.mail?.kind === "cards" && !told.has(run.id));
  const listed = sets[0];
  const lines = new Map<string, string>();
  for (const run of sets) {
    for (const item of run.mail.items) if (item.gist !== "") lines.set(item.id, item.gist);
  }
  const cards: MailCards | null =
    listed === undefined
      ? null
      : { ...listed.mail, items: listed.mail.items.map((item) => ({ ...item, gist: lines.get(item.id) ?? item.gist })) };
  const onScreen = new Set(cards === null ? [] : cards.items.slice(0, DRAWN).map((item) => item.id));
  const drafted = runs.filter((run) => run.mail?.kind === "draft" && !told.has(run.id));
  const groups: { key: string; mail: Mail }[] = [
    ...sets
      .filter((run) => run !== listed)
      .map((run) => ({ run, mail: { ...run.mail, items: run.mail.items.filter((item) => !onScreen.has(item.id)) } }))
      .filter((entry) => entry.mail.items.length > 0)
      .map((entry) => ({ key: entry.run.id, mail: entry.mail })),
    ...drafted.flatMap((run) => (run.mail === undefined ? [] : [{ key: run.id, mail: run.mail }])),
  ];
  const stubs = runs.filter((run) => run.mail === undefined && run.mailShown !== undefined);
  if (notices.length === 0 && cards === null && groups.length === 0 && stubs.length === 0) {
    return null;
  }
  return (
    <>
      {notices.map((entry) => (
        <MailFailureCard key={entry.id} failure={entry.why} onOpenSettings={onOpenMailSettings} />
      ))}
      {stubs.map((run) => (
        <p className="mail-stub" key={run.id}>
          {t.shownCount(run.mailShown as number)}
        </p>
      ))}
      {cards !== null ? (
        <MailCardsView
          key={listed?.id ?? "mail"}
          mail={cards}
          selected={selected}
          onOpen={onOpen}
          onDraft={onDraft}
          onSend={onSend}
          sent={sent}
          drafts={drafts}
          onSave={onSave}
          onCompose={onComposeMail}
        />
      ) : null}
      {groups.map((group) => (
        <MailCardsView
          key={group.key}
          mail={group.mail}
          selected={selected}
          onOpen={onOpen}
          onDraft={onDraft}
          onSend={onSend}
          sent={sent}
          drafts={drafts}
          onSave={onSave}
          onCompose={onComposeMail}
        />
      ))}
    </>
  );
}

/** Whether a name is one of the mailbox's tools, so the reader's rows stay
    quiet about them: the cards are the tool's whole visible output. */
export function isMailTool(name: string): boolean {
  return NAMES.has(name);
}