import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import type { DraftRecord, Drafts, SentTo } from "../../lib/mail/drafts";
import type { Mail, MailCards, MailCardItem } from "../../lib/mail/types";
import { MailCardsView } from "./MailCards";
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

/** How many cards one group draws before its button asks. A list can carry fifty
    mails and a turn is not a page: past this the person decides to keep
    reading. The rest are already in hand, so the button reveals, never fetches. */
const DRAWN = 8;

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
  // Which group a person has asked to see all of, by run. One place holds it so
  // that revealing one group can change what another draws, and nothing here
  // depends on a child's own state.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const reveal = (key: string) => setRevealed((before) => ({ ...before, [key]: true }));
  // A call that failed has a cause to say; it drew no cards, so it shows the
  // notice in their place.
  // A call the sidecar refused without a code of its own still failed, and a
  // silent failure is worse than a plain sentence.
  const notices = runs
    .filter((run) => NAMES.has(run.name) && (run.resultCode !== undefined || run.state === "failed" || run.state === "refused"))
    .map((run) => ({ id: run.id, why: mailFailure(run.resultCode) ?? UNKNOWN_FAILURE }))
    .filter((entry): entry is { id: string; why: MailFailure } => entry.why !== null);
  const told = new Set(notices.map((entry) => entry.id));
  // One turn, one copy of a mail. The list draws the first `DRAWN` of its cards,
  // a model's `mail_show` adds the line it wrote, and a selection that sits past
  // what the list has drawn is drawn as its own group. Which ids those are is
  // settled here rather than inside the card view, because revealing the list
  // can bring a selected mail back into it: whoever is asked to draw must know
  // what everyone else has already drawn.
  const sets = runs.filter((run): run is ToolRun & { mail: MailCards } => run.mail?.kind === "cards" && !told.has(run.id));
  const listed = sets[0];
  const listKey = listed?.id ?? "mail";
  const lines = new Map<string, string>();
  for (const run of sets) {
    for (const item of run.mail.items) if (item.gist !== "") lines.set(item.id, item.gist);
  }
  const cards: MailCards | null =
    listed === undefined
      ? null
      : { ...listed.mail, items: listed.mail.items.map((item) => ({ ...item, gist: lines.get(item.id) ?? item.gist })) };
  const drawn = (key: string, items: MailCardItem[]): MailCardItem[] => (revealed[key] ? items : items.slice(0, DRAWN));
  const listItems = cards === null ? [] : drawn(listKey, cards.items);
  const onScreen = new Set(listItems.map((item) => item.id));
  const groups: { key: string; mail: Mail; more: number }[] = [];
  for (const run of sets) {
    if (run === listed) continue;
    const unseen = run.mail.items.filter((item) => !onScreen.has(item.id));
    if (unseen.length === 0) continue;
    const items = drawn(run.id, unseen);
    for (const item of items) onScreen.add(item.id);
    groups.push({ key: run.id, mail: { ...run.mail, items }, more: unseen.length - items.length });
  }
  const drafted = runs.filter((run) => run.mail?.kind === "draft" && !told.has(run.id));
  for (const run of drafted) {
    if (run.mail !== undefined) groups.push({ key: run.id, mail: run.mail, more: 0 });
  }
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
          key={listKey}
          mail={{ ...cards, items: listItems }}
          more={cards.items.length - listItems.length}
          onReveal={() => reveal(listKey)}
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
          more={group.more}
          onReveal={() => reveal(group.key)}
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