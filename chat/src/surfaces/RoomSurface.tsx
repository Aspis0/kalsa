// The host's room, on this computer: the page renders what the feed holds
// (useRoomFeed) — the feed owns the news, the commands, and the rules for
// what may be shown. Every user-visible sentence is the backend's code
// (translated by roomNotes) or the approved copy in ROOM-PROTOCOL.md; a
// state the user can neither understand nor fix is not shown at all.

import { useState } from "react";
import { available } from "../lib/tauri";
import { RoomText } from "../lib/roomMention";
import { roomNote } from "./roomNotes";
import { useRoomFeed } from "./useRoomFeed";
import { roomNameError } from "./roomNameError";
import "./RoomSurface.css";

/** The waiting line, in queue order: who is next, then the rest joined
    the way English lists them. */
export function queueLine(queue: string[]): string {
  if (queue.length === 0) return "";
  const [next, ...rest] = queue;
  if (rest.length === 0) return `Kalsa will answer ${next} next.`;
  const last = rest[rest.length - 1];
  const earlier = rest.slice(0, -1);
  const thenPart =
    earlier.length > 0 ? `then ${earlier.join(", ")} and ${last}` : `then ${last}`;
  return `Kalsa will answer ${next} next, ${thenPart}.`;
}

export function RoomSurface() {
  const feed = useRoomFeed();
  const { info, note, entries, live } = feed;
  const [draft, setDraft] = useState("");

  // The header's name affordance exists only while there is a name to
  // show: a bare "You are …" is noise, and the placeholder copy is not
  // approved.
  const hostMember = info?.members.find((member) => member.kind === "host");
  const hostName = hostMember?.name ?? "";
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const ai = info?.ai;
  // A stop can act exactly while a turn runs — thinking or answering.
  // `running` is the feed's own word for that.
  const turnRunning = ai?.running != null;

  async function send(withCall: boolean): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await feed.send(text, withCall);
  }

  async function saveName(): Promise<void> {
    setNaming(false);
    await feed.saveName(nameDraft.trim());
  }

  // The room closed (or there is no app to ask): one quiet fact, nothing
  // to fix, nothing else on the page.
  if (!available() || (info !== null && !info.open)) {
    return (
      <div className="surface-page room-page">
        <p className="surface-quiet">Turn on Kalsa to use the room.</p>
      </div>
    );
  }

  const noteLine = roomNote(note?.code, note?.text);
  const refusalLine = roomNote(feed.refusal?.code, null);
  const nameLine = roomNameError(feed.nameError?.code);

  return (
    <div className="surface-page room-page">
      <header className="room-head">
        <h2 className="surface-verdict">{info?.room_name || "Room"}</h2>
        {hostName && !naming ? (
          <button
            type="button"
            className="room-name-chip"
            onClick={() => {
              setNameDraft(hostName);
              setNaming(true);
            }}
          >
            You are {hostName}
          </button>
        ) : null}
        {naming ? (
          <form
            className="room-name"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <input
              type="text"
              className="brain-bar-input room-name-input"
              value={nameDraft}
              autoFocus
              aria-label="Your name in this room"
              placeholder={hostName || undefined}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void saveName()}
            />
            {nameLine ? <span className="room-name-error">{nameLine}</span> : null}
          </form>
        ) : null}
      </header>

      <div className="room-thread" aria-live="polite">
        {entries.length === 0 && live === null ? (
          <p className="surface-quiet">No messages yet. Say something, or ask Kalsa.</p>
        ) : null}
        {entries.map((entry) => (
          <p key={entry.seq} className="room-line">
            <span className="room-line-name">
              {entry.name}
              {entry.former ? <span className="room-left"> · left</span> : null}
              :{" "}
            </span>
            {entry.call_ai && entry.member_id !== info?.you ? (
              <span className="room-asked">asked Kalsa · </span>
            ) : null}
            <RoomText text={entry.text} />
            {entry.read !== null && entry.read !== undefined ? (
              <span className="room-read"> · read the last {entry.read}</span>
            ) : null}
          </p>
        ))}
        {live !== null ? (
          <p className="room-line room-live">
            <span className="room-line-name">Kalsa: </span>
            {live.text}
          </p>
        ) : null}
      </div>

      <div className="room-turn" aria-live="polite">
        {turnRunning && ai?.running ? (
          <p className="surface-quiet">Kalsa is answering {ai.running}.</p>
        ) : null}
        {turnRunning ? (
          <button type="button" className="room-stop" onClick={() => void feed.stop()}>
            Stop
          </button>
        ) : null}
        {!turnRunning && ai && ai.queue.length > 0 ? (
          <p className="surface-quiet">{queueLine(ai.queue)}</p>
        ) : null}
        {refusalLine ? <p className="surface-quiet">{refusalLine}</p> : null}
        {noteLine ? <p className="surface-quiet">{noteLine}</p> : null}
      </div>

      <form
        className="room-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <input
          type="text"
          className="brain-bar-input"
          value={draft}
          placeholder="Write to the room…"
          aria-label="Write to the room"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="brain-bar-action"
          disabled={draft.trim().length === 0}
          aria-label="Send"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M8 2.2v10.6M3.8 7 8 2.8 12.2 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {/* The button exists only when it can act: while the host's own
            call is already pending it is held down, and a refusal that
            still happens (an @Kalsa typed into the text) shows nothing —
            no approved sentence exists for it. */}
        <button
          type="button"
          className="brain-bar-action brain-bar-chat"
          disabled={draft.trim().length === 0 || feed.sending || (ai?.you_pending ?? false)}
          onClick={() => void send(true)}
        >
          Ask Kalsa
        </button>
      </form>
    </div>
  );
}
