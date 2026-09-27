import { useState } from "react";
import { copyText } from "../lib/clipboard";
import { invoke } from "../lib/tauri";
import "./surfaces.css";

// Said once, when the invite file could not be read at startup: those
// invitations were thrown away rather than honoured, and the owner is told
// plainly. dev/smoke-react.mjs keeps its own copy of this sentence.
const DISCARDED_INVITES =
  "Earlier invitations could not be read, so they were cancelled for safety.";

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

/** The moment an invite dies, in the owner's own locale: the time when it
 *  is today, "tomorrow at …" when it falls on the next day, and the date
 *  beyond that. An invite lives a day, so those three cover everything it
 *  can be, and the day is named exactly where naming it matters. */
function untilTime(expiresAtSeconds: number): string {
  const when = new Date(expiresAtSeconds * 1000);
  const time = when.toLocaleTimeString();
  if (when.toDateString() === new Date().toDateString()) return time;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (when.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return when.toLocaleString();
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
  const [notice, setNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [linkFallback, setLinkFallback] = useState<string | null>(null);

  // The owner asks for a link. The command answers with the link itself,
  // which goes to the clipboard and nowhere else; the sentence that follows
  // needs the moment THIS link dies, and only the list knows that — so the
  // list is asked, and a link whose moment cannot be named is shown to
  // select instead of the sentence being invented.
  async function createInvite(): Promise<void> {
    setCommandError(null);
    setNotice(null);
    setLinkFallback(null);
    try {
      const link = await invoke<string>("brain_invite_create");
      if (await copyText(link)) {
        const listed = await invoke<InviteList>("brain_invite_list").catch(() => null);
        if (listed) onList(listed);
        const newest = listed ? newestInvite(listed.invites) : null;
        if (newest) {
          setNotice(
            `Link copied. It works once, until ${untilTime(newest.expires_at)}. Send it only to the person you want to add.`,
          );
        } else {
          setLinkFallback(link);
        }
      } else {
        setLinkFallback(link);
      }
    } catch (error) {
      // The command's own words — no road, no room, could not save — shown
      // as they are, with nothing of the invitation inside them.
      setCommandError(error instanceof Error ? error.message : String(error));
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
        if (!(await copyText(link))) setLinkFallback(link);
      } catch (error) {
        // The invitation is gone — spent, cancelled or expired. The command
        // says so in its own words, and the next list read drops the row.
        setCommandError(error instanceof Error ? error.message : String(error));
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
        if (invites) {
          onList({
            ...invites,
            invites: invites.invites.filter((invite) => invite.id !== id),
          });
        }
      })
      .catch((error: unknown) =>
        setCommandError(error instanceof Error ? error.message : String(error)),
      );
  }

  const rows = invites?.invites ?? [];
  return (
    <>
      <div className="surface-actions">
        <button type="button" className="btn-quiet" onClick={() => void createInvite()}>
          Invite by link
        </button>
      </div>
      {commandError ? <p className="surface-note">{commandError}</p> : null}
      {notice ? <p className="surface-quiet">{notice}</p> : null}
      {linkFallback ? (
        <input
          className="surface-link"
          readOnly
          value={linkFallback}
          aria-label="Invitation link"
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {invites?.discarded ? <p className="surface-quiet">{DISCARDED_INVITES}</p> : null}
      {rows.length > 0 ? (
        <div className="surface-devices">
          {rows.map((invite) => (
            // Their own row class, styled with the device rows: the page's
            // copy rules count PHONE rows by that class, and a countdown is
            // not a phone.
            <div key={invite.id} className="surface-invite">
              <span className="surface-invite-name">Expires {untilTime(invite.expires_at)}</span>
              <button type="button" className="btn-quiet" onClick={() => copyLink(invite.id)}>
                Copy link
              </button>
              <button type="button" className="btn-quiet" onClick={() => cancelInvite(invite.id)}>
                Cancel invite
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
