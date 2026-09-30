import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { invoke, PAIRING_ASK_BOUND_MS } from "../lib/tauri";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";

/** One row of `brain_invite_list`: the id the buttons name, and the moment
 *  it dies. Never a code — the link comes from `brain_invite_link`, asked
 *  for only when the owner asks to copy it. */
interface InviteRow {
  id: number;
  /** Whole seconds since the epoch. */
  expires_at: number;
}

/** What `brain_invite_list` answers. */
export interface InviteList {
  discarded: boolean;
  invites: InviteRow[];
}

/** The moment an invite dies, in the owner's own language: the time when it
 *  is today, "tomorrow at …" when it falls on the next day, and the date
 *  beyond that. An invite lives a day, so those three cover everything it
 *  can be, and the day is named exactly where naming it matters. */
function untilTime(t: { tomorrowAt: (time: string) => string }, expiresAtSeconds: number, tag: string): string {
  const when = new Date(expiresAtSeconds * 1000);
  const time = new Intl.DateTimeFormat(tag, { timeStyle: "short" }).format(when);
  if (when.toDateString() === new Date().toDateString()) return time;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (when.toDateString() === tomorrow.toDateString()) return t.tomorrowAt(time);
  return new Intl.DateTimeFormat(tag).format(when);
}

/** The newest invitation in a list: ids only ever move forward, so the
 *  highest one is the link that was just minted. */
function newestInvite(invites: InviteRow[]): InviteRow | null {
  return invites.reduce<InviteRow | null>(
    (best, invite) => (best === null || invite.id > best.id ? invite : best),
    null,
  );
}

interface InvitePanelProps {
  /** The invitations as the page's poll last heard them. */
  invites: InviteList | null;
  /** The list as this panel's own reads see it, so a read made here and the
   *  poll cannot leave the page holding two different houses. */
  onList: (listed: InviteList) => void;
}

// The invitation half of the Devices page: one quiet button, the rows of
// what is out, and the three things worth saying about them. The links
// themselves are never rendered — they go to the clipboard, and only a
// clipboard that refuses gets a field the owner can select from.
export function InvitePanel({ invites, onList }: InvitePanelProps) {
  const { table, tag } = useLanguage();
  const t = table.invite;
  const [notice, setNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [linkFallback, setLinkFallback] = useState<string | null>(null);
  // What the bound says while a create is still in flight. It is not an
  // error — nothing failed yet — so it lives apart from the other two.
  const [waiting, setWaiting] = useState<string | null>(null);
  // One link at a time: while a create is running the button is disabled,
  // so a double press cannot mint two invitations. The generation numbers
  // each ask — the answer to a create that already timed out is dropped
  // rather than rendered, because the page has said it did not get one.
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  // The panel unmounts whenever the owner leaves the page and every action
  // here awaits something first — the page's poll guards the same way: a
  // reply that lands after the component is gone writes nothing.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The owner asks for a link. The command answers with the link itself,
  // which goes to the clipboard and nowhere else; the sentence that follows
  // names when THIS link dies, which only the list can say — and when the
  // list cannot answer, the sentence names what is true of every link (one
  // day) instead. The field is for a refused clipboard only, never for a
  // successful copy.
  //
  // Past the bound the create is SLOW, not failed: the shell may still
  // mint, so the button stays down — a create in flight must never be
  // mintable twice — and the owner is told to look below rather than press
  // again. Only the command settling re-enables it, and an answer that
  // arrives after the bound belongs to a gesture the owner has already been
  // told may not have happened: no copy, no notice, the list refreshed from
  // the source so the invitation can be copied from where it landed.
  async function createInvite(): Promise<void> {
    setCommandError(null);
    setNotice(null);
    setLinkFallback(null);
    setWaiting(null);
    setCreating(true);
    const mine = ++generation.current;
    const stillMine = (): boolean => live.current && mine === generation.current;
    const clock = { missed: false };
    const bound = setTimeout(() => {
      if (!stillMine()) return;
      clock.missed = true;
      setWaiting(t.slowCreate);
    }, PAIRING_ASK_BOUND_MS);
    try {
      const link = await invoke<string>("brain_invite_create");
      if (!stillMine()) return;
      setWaiting(null);
      if (clock.missed) {
        const listed = await invoke<InviteList>("brain_invite_list").catch(() => null);
        if (stillMine() && listed) onList(listed);
      } else if (await copyText(link)) {
        const listed = await invoke<InviteList>("brain_invite_list").catch(() => null);
        if (!stillMine()) return;
        if (listed) onList(listed);
        const newest = listed ? newestInvite(listed.invites) : null;
        setNotice(
          newest ? t.copiedUntil(untilTime(t, newest.expires_at, tag)) : t.copiedOneDay,
        );
      } else {
        if (stillMine()) setLinkFallback(link);
      }
    } catch (error) {
      // The command's own words — no road, no room, could not save — shown
      // as they are, with nothing of the invitation inside them.
      if (stillMine()) {
        setWaiting(null);
        setCommandError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      clearTimeout(bound);
      // The command settled — that, and only that, puts the button back.
      if (stillMine()) setCreating(false);
    }
  }

  // Copy an invitation's link again: the same two roads as creating one —
  // the clipboard, then the field the owner can select — and never a
  // sentence, never a log.
  function copyLink(id: number): void {
    setCommandError(null);
    setNotice(null);
    setLinkFallback(null);
    void (async () => {
      try {
        const link = await invoke<string>("brain_invite_link", { id });
        if (!live.current) return;
        if (!(await copyText(link))) {
          if (live.current) setLinkFallback(link);
        }
      } catch (error) {
        // The invitation is gone — spent, cancelled or expired. The command
        // says so in its own words, and the next list read drops the row.
        if (live.current) setCommandError(error instanceof Error ? error.message : String(error));
      }
    })();
  }

  function cancelInvite(id: number): void {
    setCommandError(null);
    setNotice(null);
    setLinkFallback(null);
    invoke("brain_invite_cancel", { id })
      .then(() => {
        // The row leaves at once; the next poll agrees with it.
        if (!live.current) return;
        if (invites) {
          onList({
            ...invites,
            invites: invites.invites.filter((invite) => invite.id !== id),
          });
        }
      })
      .catch((error: unknown) => {
        if (live.current) setCommandError(error instanceof Error ? error.message : String(error));
      });
  }

  const rows = invites?.invites ?? [];
  return (
    <>
      <div className="surface-actions">
        <button
          type="button"
          className="btn-quiet"
          disabled={creating}
          onClick={() => void createInvite()}
        >
          {t.inviteByLink}
        </button>
      </div>
      {commandError ? <p className="surface-note">{commandError}</p> : null}
      {waiting ? <p className="surface-quiet">{waiting}</p> : null}
      {notice ? (
        <p className="surface-quiet" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {linkFallback ? (
        <input
          className="surface-link"
          readOnly
          value={linkFallback}
          aria-label={t.invitationLinkAria}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {invites?.discarded ? <p className="surface-quiet">{t.discarded}</p> : null}
      {rows.length > 0 ? (
        <div className="surface-devices">
          {rows.map((invite) => (
            // Their own row class, styled with the device rows: the page's
            // copy rules count PHONE rows by that class, and a countdown is
            // not a phone.
            <div key={invite.id} className="surface-invite">
              <span className="surface-invite-name">{t.expires(untilTime(t, invite.expires_at, tag))}</span>
              <button type="button" className="btn-quiet" onClick={() => copyLink(invite.id)}>
                {t.copyLink}
              </button>
              <button type="button" className="btn-quiet" onClick={() => cancelInvite(invite.id)}>
                {t.cancelInvite}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
