// The host's room feed hook: the listener that folds live events into the
// feed (roomFeed.ts's pure rules), the reads that refill it, and the
// commands the room page acts with. Refusal and name-error codes are
// carried in state for the page to render when the owner approves copy.

import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import {
  emptyFeed,
  mergeHistory,
  reduceEvent,
  renameEntries,
  type RoomEntry,
  type RoomEvent,
  type RoomFeed,
  type RoomInfo,
} from "./roomFeed";

export type { RoomEntry, RoomInfo } from "./roomFeed";

interface RoomPostAnswer extends RoomEntry {
  ai_call: string | null;
  refusal: string | null;
}

interface NameErrorDto {
  code: string;
}

interface SendErrorDto {
  code: string;
}

export function useRoomFeed() {
  const [feed, setFeed] = useState<RoomFeed>(emptyFeed);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [note, setNote] = useState<{ code: string | null; text: string | null } | null>(null);
  const [refusal, setRefusal] = useState<{ code: string } | null>(null);
  const [nameError, setNameError] = useState<{ code: string } | null>(null);
  const [sendError, setSendError] = useState<{ code: string } | null>(null);
  const [sending, setSending] = useState(false);
  // The listener's closure reads the epoch through a ref: it must compare
  // against what the feed holds NOW, not the value from its first render.
  const feedRef = useRef(feed);
  feedRef.current = feed;

  const load = useCallback(async () => {
    if (!available()) return;
    try {
      const [nextInfo, history] = await Promise.all([
        invoke<RoomInfo>("brain_room"),
        invoke<RoomEntry[]>("brain_room_history", { limit: 200 }),
      ]);
      setInfo(nextInfo);
      setFeed((current) => mergeHistory(current, nextInfo.epoch, history));
    } catch {
      const closed = await invoke<RoomInfo>("brain_room").catch(() => null);
      if (closed) setInfo(closed);
    }
  }, []);

  useEffect(() => {
    if (!available()) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    // The listener attaches before the reads, so nothing the room
    // announces while the page loads is lost; the reads are the history
    // those events move forward from.
    void window.__TAURI__!.event!.listen("room-event", (payload) => {
      if (cancelled) return;
      const event = payload as RoomEvent;
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
        // The idle frame is the turn's end, not news: it clears the
        // answering line (its running is null) and must leave the note the
        // turn ended with — the failure or the wait is what there is to
        // read.
        setNote((current) =>
          event.state === "idle"
            ? current
            : event.note_code || event.note
              ? { code: event.note_code, text: event.note }
              : null,
        );
      }
      if (event.kind === "member" && event.action === "renamed") {
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
        setFeed((current) => ({
          ...current,
          entries: renameEntries(current.entries, event.member_id, event.name),
        }));
        return;
      }
      // A new epoch's seqs name different words: after the replace, the
      // history of THAT epoch is what fills the page.
      const moved =
        (event.kind === "message" || event.kind === "ai_message") &&
        event.epoch !== feedRef.current.epoch;
      setFeed((current) => reduceEvent(current, event));
      if (moved) void load();
    }).then((offListen) => {
      if (cancelled) offListen();
      else off = offListen;
    });
    void load();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [load]);

  const send = useCallback(
    async (text: string, withCall: boolean): Promise<boolean> => {
      if (!text || !available()) return false;
      setSending(true);
      try {
        const answer = await invoke<RoomPostAnswer>("brain_room_post", {
          clientMsgId: `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          callAi: withCall,
        });
        setFeed((current) =>
          reduceEvent(current, { kind: "message", epoch: current.epoch, ...answer }),
        );
        // The refused-call codes live in state for the page; the one with
        // approved copy renders, the rest wait for the owner.
        if (answer.refusal) setRefusal({ code: answer.refusal });
        else setRefusal(null);
        setSendError(null);
        return true;
      } catch (error) {
        // A refused post keeps the words where they were typed: nothing
        // was stored, nothing pretends. The code is carried for the page,
        // which says what happened instead of swallowing it.
        const code = (error as SendErrorDto | undefined)?.code;
        setSendError({ code: code ?? "internal" });
        return false;
      } finally {
        setSending(false);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    await invoke("brain_room_stop").catch(() => {});
  }, []);

  const saveName = useCallback(async (name: string): Promise<void> => {
    if (!name) return;
    try {
      await invoke("brain_room_set_name", { name });
      setNameError(null);
    } catch (error) {
      // The old name stands; the code is carried for the copy the owner
      // has not approved yet.
      const code = (error as NameErrorDto | undefined)?.code;
      if (code) setNameError({ code });
    }
  }, []);

  return {
    feed,
    entries: feed.entries,
    live: feed.live,
    info,
    note,
    refusal,
    nameError,
    sendError,
    sending,
    load,
    send,
    stop,
    saveName,
  };
}
