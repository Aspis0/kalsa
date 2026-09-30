// The host's room, on this computer. It reads and writes through the
// app's own commands — never through the HTTP door — and its live news
// arrives as `room-event` Tauri events from the app's one follower.
// Every user-visible sentence is the backend's code (translated by
// roomNotes) or the approved copy listed in ROOM-PROTOCOL.md; a state the
// user can neither understand nor fix is not shown at all.

import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { callsAi } from "../lib/roomMention";
import { roomNote } from "./roomNotes";
import "./RoomSurface.css";

interface RoomMember {
  member_id: number;
  name: string;
  kind: "host" | "phone" | "ai";
  former: boolean;
}

interface RoomAi {
  state: string;
  running: string | null;
  queue: string[];
  you_pending: boolean;
}

interface RoomInfo {
  open: boolean;
  room_name: string;
  you: number;
  members: RoomMember[];
  ai: RoomAi;
}

interface RoomEntry {
  seq: number;
  member_id: number;
  name: string;
  former: boolean;
  text: string;
  time: number;
  call_ai: boolean;
  read: number | null;
  client_msg_id: string;
}

/** One live news frame from the app's follower, by kind. */
type RoomEvent =
  | ({ kind: "message" | "ai_message" } & RoomEntry)
  | { kind: "member"; action: "joined" | "renamed" | "left"; member_id: number; name: string }
  | {
      kind: "ai_status";
      state: string;
      note_code: string | null;
      note: string | null;
      running: string | null;
      queue: string[];
      you_pending: boolean;
    }
  | { kind: "ai_delta"; turn: number; text: string };

interface LiveAnswer {
  turn: number;
  text: string;
}

function uid(): string {
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RoomSurface() {
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [note, setNote] = useState<{ code: string | null; text: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const seenSeqs = useRef(new Set<number>());

  const load = useCallback(async () => {
    if (!available()) return;
    try {
      const [nextInfo, history] = await Promise.all([
        invoke<RoomInfo>("brain_room"),
        invoke<RoomEntry[]>("brain_room_history", { limit: 200 }),
      ]);
      setInfo(nextInfo);
      for (const entry of history) seenSeqs.current.add(entry.seq);
      setEntries(history);
    } catch {
      // The commands failing is the room's closed state, read again below
      // through info; there is no second sentence to invent here.
      const closed = await invoke<RoomInfo>("brain_room").catch(() => null);
      if (closed) setInfo(closed);
    }
  }, []);

  useEffect(() => {
    if (!available()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    // The listener is attached BEFORE the reads, so nothing the room
    // announces while the page loads is lost; the reads are the history
    // the events move forward from.
    void window.__TAURI__!.event!.listen("room-event", (payload) => {
      if (cancelled) return;
      applyEvent(payload as RoomEvent);
    }).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });
    void load();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyEvent(event: RoomEvent): void {
    if (event.kind === "message") {
      if (seenSeqs.current.has(event.seq)) return;
      seenSeqs.current.add(event.seq);
      setEntries((current) => [...current, event]);
      return;
    }
    if (event.kind === "ai_message") {
      // The numbered final answer replaces whatever partial of the same
      // turn the deltas had assembled.
      if (!seenSeqs.current.has(event.seq)) {
        seenSeqs.current.add(event.seq);
        setEntries((current) => [...current, event]);
      }
      setLive(null);
      return;
    }
    if (event.kind === "ai_delta") {
      setLive((current) =>
        current && current.turn === event.turn
          ? { turn: current.turn, text: current.text + event.text }
          : { turn: event.turn, text: event.text },
      );
      return;
    }
    if (event.kind === "ai_status") {
      setInfo((current) =>
        current
          ? {
              ...current,
              ai: {
                state: event.state,
                running: event.running,
                queue: event.queue,
                you_pending: event.you_pending,
              },
            }
          : current,
      );
      if (event.state === "done") setLive(null);
      setNote(event.note_code || event.note ? { code: event.note_code, text: event.note } : null);
      return;
    }
    // member news: a rename updates in place, a join or a leave re-reads
    // the roster — one command, and the page holds no second roster.
    if (event.kind === "member") {
      if (event.action === "renamed") {
        setInfo((current) =>
          current
            ? {
                ...current,
                members: current.members.map((member) =>
                  member.member_id === event.member_id
                    ? { ...member, name: event.name }
                    : member,
                ),
              }
            : current,
        );
        setEntries((current) =>
          current.map((entry) =>
            entry.member_id === event.member_id ? { ...entry, name: event.name } : entry,
          ),
        );
      } else {
        void load();
      }
    }
  }

  async function send(withCall: boolean): Promise<void> {
    const text = draft.trim();
    if (!text || !available()) return;
    const client_msg_id = uid();
    setDraft("");
    if (withCall) setAsking(true);
    try {
      const landed = await invoke<RoomEntry>("brain_room_post", {
        clientMsgId: client_msg_id,
        text,
        callAi: withCall,
      });
      if (!seenSeqs.current.has(landed.seq)) {
        seenSeqs.current.add(landed.seq);
        setEntries((current) => [...current, landed]);
      }
    } catch {
      // The post was refused (the room's store, or a reused id). The words
      // go back where they were typed: nothing was lost, nothing pretends.
      setDraft(text);
    } finally {
      if (withCall) setAsking(false);
    }
  }

  async function stop(): Promise<void> {
    await invoke("brain_room_stop").catch(() => {});
  }

  async function saveName(): Promise<void> {
    const name = nameDraft.trim();
    setNaming(false);
    if (!name) return;
    try {
      const saved = await invoke<string>("brain_room_set_name", { name });
      setInfo((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.member_id === (current?.you ?? -1) ? { ...member, name: saved } : member,
              ),
            }
          : current,
      );
    } catch {
      // A refused name keeps the old one; the field closes either way.
    }
  }

  const roomClosed = info !== null && !info.open;
  const hostName =
    info?.members.find((member) => member.member_id === (info?.you ?? -1))?.name ?? "";
  const ai = info?.ai;
  const answering = ai?.state === "answering";
  const waiting = (ai?.queue.length ?? 0) > 0 || ai?.state === "waiting";
  const noteLine = roomNote(note?.code, note?.text);
  const hostMember = info?.members.find((member) => member.kind === "host");

  return (
    <div className="surface-page room-page">
      {!available() || roomClosed ? (
        <p className="surface-quiet">The room opens when the assistant runs.</p>
      ) : info === null ? (
        // The reads are in flight; the page holds its silence rather than
        // promising a room it has not seen.
        <div className="surface-page room-page" />
      ) : (
        <>
          <header className="room-head">
            <h2 className="surface-verdict">{info.room_name || "Room"}</h2>
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
                  placeholder={hostName || "Your name"}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => void saveName()}
                />
              </form>
            ) : (
              <button
                type="button"
                className="room-name-chip"
                onClick={() => {
                  setNameDraft(hostMember?.name ?? "");
                  setNaming(true);
                }}
              >
                You are {hostMember?.name || "…"}
              </button>
            )}
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
                {entry.call_ai && entry.member_id !== info.you ? (
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
            {answering && ai?.running ? <p className="surface-quiet">Kalsa is answering {ai.running}.</p> : null}
            {answering ? (
              <button type="button" className="room-stop" onClick={() => void stop()}>
                Stop
              </button>
            ) : null}
            {waiting && !answering && ai && ai.queue.length > 0 ? (
              <p className="surface-quiet">Waiting to ask Kalsa: {ai.queue.join(", ")}</p>
            ) : null}
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
            <button
              type="button"
              className="brain-bar-action brain-bar-chat"
              disabled={draft.trim().length === 0 || asking}
              onClick={() => void send(true)}
            >
              Ask Kalsa
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** One message's text, with the @Kalsa token highlighted when the message
    calls — by the exact §5 rule, mirrored in roomMention. */
function RoomText({ text }: { text: string }) {
  if (!callsAi(text)) return <span className="room-text">{text}</span>;
  const at = text.toLowerCase().indexOf("@kalsa");
  if (at < 0) {
    // The call came from the button, not the token.
    return <span className="room-text">{text}</span>;
  }
  return (
    <span className="room-text">
      {text.slice(0, at)}
      <span className="room-mention">@Kalsa</span>
      {text.slice(at + 6)}
    </span>
  );
}
