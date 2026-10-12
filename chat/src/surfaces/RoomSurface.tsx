// The host's room, on this computer: the chat's own pieces — the thread's
// bubbles, the composer, the waiting dots — wearing what a room has and a
// chat has not. Who wrote each message, who is in, and the call to Kalsa.
// Every user-visible sentence comes from the language table (the backend's
// codes its keys); a state the user can neither understand nor fix is not
// shown at all.

import { Fragment, useEffect, useState } from "react";
import { available } from "../lib/tauri";
import { useStickToBottom } from "../lib/stickToBottom";
import { assignNameColors, assignNameTints, KALSA_NAME_COLOR, KALSA_TINT } from "../lib/roomColors";
import { RoomMediaChips } from "../components/RoomMediaChips";
import { Composer } from "../components/Composer";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { Thinking } from "../components/Thread";
import { RoomRow } from "./RoomRow";
import { clockTime, dayLabel, fullStamp, msUntilNextLocalMidnight, sameLocalDay } from "./roomTime";
import { useRoomFeed } from "./useRoomFeed";
import { useBrain } from "./useBrain";
import { useRoomMedia } from "./useRoomMedia";
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
  // The closed Room's one action is Home's own start (useBrain's act).
  const brain = useBrain();
  const { table, tag } = useLanguage();
  const room = table.room;
  const mediaWords = room.media;
  const { info, note, entries, live } = feed;
  // The backend leaves an UNNAMED host's name empty — the computer's own
  // label is English words nobody chose — and the page renders the
  // household's words for it. A set name crosses as itself.
  const localName = (name: string): string => (name === "" ? room.defaultHostName : name);
  const [draft, setDraft] = useState("");
  // The media on their way in, their one error line, and the shelf's broom
  // (useRoomMedia); the broom asks first, with this confirm.
  const {
    pendingMedia,
    mediaError,
    mediaEpoch,
    attachMedia,
    cancelMedia,
    dropMedia,
    clearRoomMediaNow,
    postWithMedia,
  } = useRoomMedia(mediaWords, feed.send);
  const [clearing, setClearing] = useState(false);

  // The header's name affordance exists only while there is a name to
  // show: a bare "You are …" is noise, and the placeholder copy is not
  // approved.
  const hostMember = info?.members.find((member) => member.kind === "host");
  const hostName = hostMember ? localName(hostMember.name) : "";
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const ai = info?.ai;
  // A stop can act exactly while a turn runs — thinking or answering.
  // `running` is the feed's own word for that; the composer wears it as
  // the chat wears streaming.
  const turnRunning = ai?.running != null;
  // `thinking` and `queued` both mean this running turn is still being read;
  // a bare `answering` snapshot (a reconnect) stays dots alone until a delta.
  const kalsaWorking =
    turnRunning && (ai?.state === "thinking" || ai?.state === "queued");

  // Glued to the bottom while the answer arrives, unless the reader
  // scrolled up — the thread's own rule.
  const { ref: scrollRef, following, toBottom } = useStickToBottom();

  // The day labels stand on this reading; a timer moves it when the local
  // day does, so an idle Room cannot keep yesterday's "Today".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const arm = (): void => {
      // A zone whose midnight the clock skipped can put the arithmetic
      // midnight behind the reading; the floor keeps the re-arm from
      // becoming a busy loop.
      const wait = Math.max(msUntilNextLocalMidnight(Date.now()), 1_000);
      timer = window.setTimeout(() => {
        setNow(Date.now());
        arm();
      }, wait);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);

  // Both sends ride the one composer: the store adds the call itself when
  // the words name @Kalsa, and the quiet button names it outright. A bare
  // "@" names nobody — nothing to post, nobody to ask. The answer is the
  // feed's own, so a send the room refused leaves the words in the composer
  // for exactly as long as it leaves them nowhere else.
  async function post(text: string, withCall: boolean): Promise<boolean> {
    const body = text.trim();
    if ((!body && pendingMedia.length === 0) || body === "@") return false;
    if (pendingMedia.length === 0) return feed.send(body, withCall);
    return postWithMedia(body, withCall);
  }

  async function saveName(): Promise<void> {
    setNaming(false);
    await feed.saveName(nameDraft.trim());
  }

  // The room closed (or there is no app to ask): one quiet fact, nothing
  // to fix, nothing else on the page.
  const brainKind = brain.state?.kind;
  const starting = brain.busy || brain.walking || brainKind === "starting";
  const canTurnOn = available() && !starting && (brainKind === "stopped" || brainKind === "failed");
  if (!available() || (info !== null && !info.open)) {
    return (
      <div className="surface-page room-page">
        <div className="room-empty room-empty-closed">
          <span className="room-empty-mark">
            <Icon name="users" size={34} stroke={1.9} />
          </span>
          <h3 className="room-empty-title">{room.closedTitle}</h3>
          <p className="room-empty-line">{room.closedRoom}</p>
          {canTurnOn || starting ? (
            // Only offered while Kalsa is off: act() on a running brain stops it.
            <button type="button" className="room-empty-go" disabled={starting} onClick={() => void brain.act()}>
              <Icon name="power" size={22} stroke={2} />
              {starting ? table.power.starting : room.turnOn}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // One policy for every code the backend sends — note, refusal, name
  // error, failed send: the table's sentence when the language knows the
  // code, and the app's own fallback when it does not. Never the backend's
  // English, which no other language's reader was promised.
  const line = (code: string | null | undefined): string | null =>
    code ? (room.notes[code] ?? room.noteFallback) : null;
  const noteLine = line(note?.code);
  const refusalLine = line(feed.refusal?.code);
  const nameLine = line(feed.nameError?.code);
  const sendErrorLine = line(feed.sendError?.code);
  // One color per member, stable order, Kalsa in green — and the tint of
  // the same hue every message of theirs washes with.
  const colors = assignNameColors(info?.members ?? []);
  const tints = assignNameTints(info?.members ?? []);
  // The live turn joins a Kalsa run that ends the feed, as a finished
  // message would. It carries no day label, so an earlier day's run is not
  // joined: its name would be the only thing marking the new day.
  const aiId = info?.members.find((member) => member.kind === "ai")?.member_id;
  const lastEntry = entries[entries.length - 1];
  const liveGrouped =
    lastEntry !== undefined && lastEntry.member_id === aiId && sameLocalDay(lastEntry.time * 1000, now);

  return (
    <div className="surface-page room-page">
      <header className="room-head">
        <h2 className="surface-verdict">{info?.room_name || hostName || table.chrome.room}</h2>
        <div className="room-people">
          {/* The others: this computer is named by its own chip, Kalsa by the ask. */}
          {(info?.members ?? [])
            .filter((member) => member.member_id !== info?.you && member.kind !== "ai")
            .map((member) => (
              <span className="room-person" key={member.member_id}>
                <span className="room-person-name" style={{ color: colors.get(member.member_id) }}>
                  {localName(member.name)}
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
            <Icon name="pencil" size={15} />
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
              className="room-name-input"
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
        {naming ? null : (
          <button type="button" className="room-clear-chip" onClick={() => setClearing(true)}>
            <Icon name="trash" size={17} />
            {mediaWords.clearAction}
          </button>
        )}
      </header>
      {clearing ? (
        <ConfirmDialog
          icon="trash"
          tone="danger"
          title={mediaWords.clearAction}
          body={mediaWords.clearConfirm}
          cancel={mediaWords.clearKeep}
          confirm={mediaWords.clearDelete}
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            setClearing(false);
            void clearRoomMediaNow();
          }}
        />
      ) : null}

      <div className="thread-wrap">
        <div
          ref={scrollRef}
          className="thread"
          aria-busy={turnRunning}
          aria-live="polite"
        >
          <div className="thread-column">
            {entries.length === 0 && live === null && !turnRunning ? (
              <div className="room-empty">
                <span className="room-empty-mark">
                  <Icon name="users" size={34} stroke={1.9} />
                </span>
                <h3 className="room-empty-title">{room.emptyTitle}</h3>
                <p className="room-empty-line">{room.emptyRoom}</p>
              </div>
            ) : null}
            {entries.map((entry, index) => {
              const when = entry.time * 1000;
              const newDay =
                index === 0 || !sameLocalDay(entries[index - 1].time * 1000, when);
              const label = dayLabel(when, now, tag);
              return (
                <Fragment key={entry.seq}>
                  {newDay ? (
                    <div className="room-day" role="separator" aria-label={label}>
                      {label}
                    </div>
                  ) : null}
                  <RoomRow
                    mediaEpoch={mediaEpoch}
                    entry={entry}
                    info={info ?? null}
                    color={colors.get(entry.member_id)}
                    tint={tints.get(entry.member_id)}
                    grouped={!newDay && entries[index - 1].member_id === entry.member_id}
                    defaultHostName={room.defaultHostName}
                    asked={room.askedKalsa}
                    left={room.left}
                    readLast={room.readLast}
                    when={fullStamp(when, tag)}
                    clock={clockTime(when, tag)}
                  />
                </Fragment>
              );
            })}
            {live !== null || turnRunning ? (
              // No clock on the live turn: the feed holds no moment for it,
              // and an invented one would be a lie. The message's own time
              // arrives with the message.
              <div className={`row room-row${liveGrouped ? " room-row-grouped" : ""}`}>
                {!liveGrouped ? (
                  <div className="room-author">
                    <span className="room-author-name" style={{ color: KALSA_NAME_COLOR }}>
                      Kalsa
                    </span>
                  </div>
                ) : null}
                <div
                  className="room-bubble room-bubble-kalsa"
                  style={{ "--room-bubble-color": KALSA_NAME_COLOR, "--room-bubble-tint": KALSA_TINT } as React.CSSProperties}
                >
                  {live !== null && live.text !== "" ? (
                    <Markdown text={live.text} streaming />
                  ) : (
                    <span className="room-waiting-row">
                      <Thinking />
                      {kalsaWorking ? (
                        <span className="surface-quiet" role="status">
                          {room.readingRoom}
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          {!following ? (
            <button
              type="button"
              className="jump-bottom"
              onClick={toBottom}
            >
              {table.thread.backToLatest}
            </button>
          ) : null}
        </div>

        <div className="room-turn">
          {!turnRunning && ai && ai.queue.length > 0 ? (
            <p className="surface-quiet">{queueLine(ai.queue.map(localName), room)}</p>
          ) : null}
          {refusalLine ? <p className="surface-quiet">{refusalLine}</p> : null}
          {noteLine ? <p className="surface-quiet">{noteLine}</p> : null}
        </div>
        {sendErrorLine ? (
          <p className="surface-quiet room-send-error" role="alert">
            {sendErrorLine}
          </p>
        ) : null}
        {mediaError ? (
          <p className="surface-quiet room-send-error" role="alert">
            {mediaError}
          </p>
        ) : null}
        <Composer
          streaming={turnRunning}
          opening={false}
          draft={draft}
          onDraftChange={setDraft}
          onSend={(text) => post(text, false)}
          onStop={() => void feed.stop()}
          onAttach={(files) => void attachMedia(files)}
          acceptsImages
          acceptsVideos
          mediaChips={
            <RoomMediaChips
              items={pendingMedia}
              words={mediaWords}
              onCancel={cancelMedia}
              onRemove={dropMedia}
            />
          }
          attach={{ label: room.attachPhoto, icon: "image" }}
          placeholder={room.writePlaceholder}
          disclaimer={room.disclaimer}
          sendBlocked={pendingMedia.some((item) => item.state === "compressing")}
          allowsMediaOnly={pendingMedia.length > 0}
          ask={
            ai
              ? {
                  label: room.askKalsa,
                  icon: "at",
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
