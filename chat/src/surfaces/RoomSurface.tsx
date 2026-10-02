// The host's room, on this computer: the chat's own pieces — the thread's
// bubbles, the composer, the waiting dots — wearing what a room has and a
// chat has not. Who wrote each message, who is in, and the call to Kalsa.
// Every user-visible sentence comes from the language table (the backend's
// codes its keys); a state the user can neither understand nor fix is not
// shown at all.

import { useLayoutEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import { available } from "../lib/tauri";
import { RoomText } from "../lib/roomMention";
import { assignNameColors, KALSA_NAME_COLOR } from "../lib/roomColors";
import { Composer } from "../components/Composer";
import { Markdown } from "../components/Markdown";
import { stamp, Thinking } from "../components/Thread";
import type { RoomEntry, RoomInfo } from "./roomFeed";
import { useRoomFeed } from "./useRoomFeed";
import { useLanguage } from "../i18n/useLanguage";
import "../components/Thread.css";
import "./RoomSurface.css";

/** The waiting line, in queue order: who is next, then the rest joined
    the way the chosen language lists them — whole messages, never joined
    fragments. */
export function queueLine(queue: string[], table: { queueNext: (a: string) => string; queueThen: (a: string, b: string) => string; listJoin: (items: string[]) => string }): string {
  if (queue.length === 0) return "";
  const [next, ...rest] = queue;
  if (rest.length === 0) return table.queueNext(next);
  const last = rest[rest.length - 1];
  const earlier = rest.slice(0, -1);
  const restPart = earlier.length > 0 ? table.listJoin([...earlier, last]) : last;
  return table.queueThen(next, restPart);
}

export function RoomSurface() {
  const feed = useRoomFeed();
  const { table, tag } = useLanguage();
  const room = table.room;
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
  // `running` is the feed's own word for that; the composer wears it as
  // the chat wears streaming.
  const turnRunning = ai?.running != null;

  // Glued to the bottom while the answer arrives, unless the reader
  // scrolled up — the thread's own rule.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  });

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  // Both sends ride the one composer: the store adds the call itself when
  // the words name @Kalsa, and the quiet button names it outright. A bare
  // "@" names nobody — nothing to post, nobody to ask.
  function post(text: string, withCall: boolean): boolean {
    const body = text.trim();
    if (!body || body === "@") return false;
    void feed.send(body, withCall);
    return true;
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
        <p className="surface-quiet">{room.closedRoom}</p>
      </div>
    );
  }

  // The table's sentence for the code, the backend's own English only as
  // the fallback of a code the table does not know.
  const noteLine = room.notes[note?.code ?? ""] ?? note?.text ?? null;
  const refusalLine = room.notes[feed.refusal?.code ?? ""] ?? null;
  const nameLine = room.notes[feed.nameError?.code ?? ""] ?? null;
  // A send that the room refused is said, never swallowed; the sentence
  // follows the code, and one the table does not know gets the app's own.
  const sendErrorLine = feed.sendError
    ? (room.notes[feed.sendError.code] ?? room.sendFailed)
    : null;
  // One color per member, stable order, Kalsa in green.
  const colors = assignNameColors(info?.members ?? []);

  return (
    <div className="surface-page room-page">
      <header className="room-head">
        <h2 className="surface-verdict">{info?.room_name || "Room"}</h2>
        <div className="room-people">
          {(info?.members ?? []).map((member) => (
            <span className="room-person" key={member.member_id}>
              <span className="room-person-name" style={{ color: colors.get(member.member_id) }}>
                {member.name}
              </span>
              {member.former ? <span className="room-left">{room.left}</span> : null}
            </span>
          ))}
        </div>
        {hostName && !naming ? (
          <button
            type="button"
            className="room-name-chip"
            onClick={() => {
              setNameDraft(hostName);
              setNaming(true);
            }}
          >
            {room.youAre(hostName)}
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
              aria-label={room.nameAria}
              placeholder={hostName || room.namePlaceholder}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void saveName()}
            />
            {nameLine ? <span className="room-name-error">{nameLine}</span> : null}
          </form>
        ) : null}
      </header>

      <div className="thread-wrap">
        <div
          ref={scrollRef}
          className="thread"
          onScroll={handleScroll}
          aria-busy={turnRunning}
          aria-live="polite"
        >
          <div className="thread-column">
            {entries.length === 0 && live === null && !turnRunning ? (
              <p className="surface-quiet">{room.emptyRoom}</p>
            ) : null}
            {entries.map((entry) => (
              <RoomRow
                key={entry.seq}
                entry={entry}
                info={info ?? null}
                color={colors.get(entry.member_id) ?? KALSA_NAME_COLOR}
                asked={room.askedKalsa}
                left={room.left}
                readLast={room.readLast}
                when={stamp(entry.time * 1000, tag)}
              />
            ))}
            {live !== null || turnRunning ? (
              <div className="row row-assistant">
                <div className="room-author">
                  <span className="room-author-name" style={{ color: KALSA_NAME_COLOR }}>
                    Kalsa
                  </span>
                </div>
                <div className="assistant-body">
                  {live !== null && live.text !== "" ? (
                    <Markdown text={live.text} />
                  ) : (
                    <Thinking />
                  )}
                </div>
              </div>
            ) : null}
          </div>
          {!pinned ? (
            <button
              type="button"
              className="jump-bottom"
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
                setPinned(true);
              }}
            >
              {table.thread.backToLatest}
            </button>
          ) : null}
        </div>

        <div className="room-turn">
          {!turnRunning && ai && ai.queue.length > 0 ? (
            <p className="surface-quiet">{queueLine(ai.queue, room)}</p>
          ) : null}
          {refusalLine ? <p className="surface-quiet">{refusalLine}</p> : null}
          {noteLine ? <p className="surface-quiet">{noteLine}</p> : null}
        </div>
        {sendErrorLine ? (
          <p className="surface-quiet room-send-error" role="alert">
            {sendErrorLine}
          </p>
        ) : null}
        <Composer
          streaming={turnRunning}
          opening={false}
          draft={draft}
          onDraftChange={setDraft}
          onSend={(text) => post(text, false)}
          onStop={() => void feed.stop()}
          ask={
            ai
              ? {
                  label: room.askKalsa,
                  disabled: ai.you_pending,
                  onAsk: (text) => post(text, true),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/** One message of the room, in the thread's shapes: this computer's own
    words in the user's bubble, everyone else's in an authored block —
    Kalsa's typeset like the chat's answers, the room's people with their
    calls and reads marked. The author's name wears the member's color. */
function RoomRow({
  entry,
  info,
  color,
  asked,
  left,
  readLast,
  when,
}: {
  entry: RoomEntry;
  info: RoomInfo | null;
  color: string;
  asked: string;
  left: string;
  readLast: (count: number) => string;
  when: string;
}) {
  const own = info !== null && entry.member_id === info.you;
  if (own) {
    return (
      <div className="row row-user" title={when}>
        <div className="user-bubble">
          <RoomText text={entry.text} />
        </div>
      </div>
    );
  }
  const aiId = info?.members.find((member) => member.kind === "ai")?.member_id;
  const isKalsa = entry.member_id === aiId;
  return (
    <div className="row row-assistant" title={when}>
      <div className="room-author">
        <span className="room-author-name" style={{ color }}>
          {entry.name}
        </span>
        {entry.former ? <span className="room-left">{left}</span> : null}
      </div>
      <div className="assistant-body">
        {entry.call_ai && !isKalsa ? <span className="room-asked">{asked} </span> : null}
        {isKalsa ? <Markdown text={entry.text} /> : <RoomText text={entry.text} />}
        {entry.read !== null && entry.read !== undefined ? (
          <span className="room-read">{readLast(entry.read)}</span>
        ) : null}
      </div>
    </div>
  );
}
