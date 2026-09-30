/**
 * The room protocol's answers as this client types them (§3–§6), and the
 * parsers that prove a 2xx body really is one: anything the contract does
 * not describe reads as null, which the caller turns into a typed
 * malformed_response instead of a half-understood room.
 */

export type RoomMember = { memberId: number; name: string; kind: "host" | "phone" | "ai" };

export type RoomAiTurn = {
  busy: boolean;
  running: string | null;
  queue: string[];
  youPending: boolean;
};

export type RoomInfo = {
  roomName: string;
  members: RoomMember[];
  ai: RoomAiTurn;
  /** The caller's own member id, as the computer assigns it. */
  you: number;
  /** Opaque; stable for the life of the computer's room. */
  roomId: string;
  /** The transcript epoch seqs are unique within; a change means resync. */
  epoch: string;
};

export type RoomHistoryMessage = {
  seq: number;
  /** The epoch this entry belongs to — the room's current one at read. */
  epoch: string;
  memberId: number;
  name: string;
  time: number;
  text: string;
  callAi: boolean;
  /** The author's device is gone: the mark §4 puts on their old entries. */
  former: boolean;
};

export type RoomHistoryPage = {
  messages: RoomHistoryMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
};

export type RoomPostAck = {
  seq: number;
  time: number;
  /** Null in this version — the AI guest claims nothing yet (§5); "queued"
   *  and "refused" are what it will answer once it lands. */
  aiCall: null | "queued" | "refused";
  refusal: string | null;
};

export type RoomNameAck = { memberId: number; name: string };

/** A `member` frame from the stream: the action §7 names, the row's id,
 *  and the name — null only for a `left` the room has no name for. */
export type RoomMemberEvent = {
  action: "joined" | "renamed" | "left";
  memberId: number;
  name: string | null;
};

/** An `ai_status` frame: the same view info's `ai` answers (§7). The
 *  core four are in the contract's example and every door frame; the
 *  rest ride the door's frames and are typed when present. */
export type RoomAiStatus = {
  state: string;
  who: string | null;
  running: string | null;
  queue: string[];
  busy?: boolean;
  youPending?: boolean;
  noteCode?: string | null;
  note?: string | null;
};

/** An `ai_delta` frame — one chunk of the answer being assembled (§7). */
export type RoomAiDelta = {
  /** The turn this chunk belongs to, when the door names one. */
  turn?: number;
  text: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** member_id: the computer's uint32 space, host and AI included. */
function asMemberId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295
    ? value
    : null;
}

/** seq and time: counters the computer assigns, never negative. */
function asCounter(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asEpoch(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseMembers(value: unknown): RoomMember[] | null {
  if (!Array.isArray(value)) return null;
  const members: RoomMember[] = [];
  for (const entry of value) {
    const member = asObject(entry);
    if (member === null) return null;
    const memberId = asMemberId(member.member_id);
    const name = asString(member.name);
    const kind = member.kind;
    if (memberId === null || name === null) return null;
    if (kind !== "host" && kind !== "phone" && kind !== "ai") return null;
    members.push({ memberId, name, kind });
  }
  return members;
}

function parseAiTurn(value: unknown): RoomAiTurn | null {
  const ai = asObject(value);
  if (ai === null) return null;
  const busy = asBoolean(ai.busy);
  const youPending = asBoolean(ai.you_pending);
  const running =
    ai.running === null || typeof ai.running === "string" ? ai.running : undefined;
  const queue = ai.queue;
  if (busy === null || youPending === null || running === undefined || !Array.isArray(queue)) {
    return null;
  }
  const names: string[] = [];
  for (const entry of queue) {
    const name = asString(entry);
    if (name === null) return null;
    names.push(name);
  }
  return { busy, running, queue: names, youPending };
}

export function parseRoomInfo(value: unknown): RoomInfo | null {
  const info = asObject(value);
  if (info === null) return null;
  const roomName = asString(info.room_name);
  const roomId = asString(info.room_id);
  const you = asMemberId(info.you);
  const epoch = asEpoch(info.epoch);
  const members = parseMembers(info.members);
  const ai = parseAiTurn(info.ai);
  if (
    roomName === null ||
    roomId === null ||
    roomId.length === 0 ||
    you === null ||
    epoch === null ||
    members === null ||
    ai === null
  ) {
    return null;
  }
  return { roomName, members, ai, you, roomId, epoch };
}

/** One history entry — the shape history pages, `message` and
 *  `ai_message` frames, and the stream's dedupe all share. */
export function parseRoomHistoryEntry(value: unknown): RoomHistoryMessage | null {
  const message = asObject(value);
  if (message === null) return null;
  const seq = asCounter(message.seq);
  const epoch = asEpoch(message.epoch);
  const memberId = asMemberId(message.member_id);
  const name = asString(message.name);
  const time = asCounter(message.time);
  const text = asString(message.text);
  const callAi = asBoolean(message.call_ai);
  // former is absent for a live author and true for a gone one; anything
  // else is not the shape §4 promises.
  const former =
    message.former === undefined
      ? false
      : typeof message.former === "boolean"
        ? message.former
        : null;
  if (
    seq === null ||
    epoch === null ||
    memberId === null ||
    name === null ||
    time === null ||
    text === null ||
    callAi === null ||
    former === null
  ) {
    return null;
  }
  return { seq, epoch, memberId, name, time, text, callAi, former };
}

export function parseRoomHistoryPage(value: unknown): RoomHistoryPage | null {
  const page = asObject(value);
  if (page === null) return null;
  const hasOlder = asBoolean(page.has_older);
  const hasNewer = asBoolean(page.has_newer);
  if (hasOlder === null || hasNewer === null || !Array.isArray(page.messages)) return null;
  const messages: RoomHistoryMessage[] = [];
  for (const entry of page.messages) {
    const message = parseRoomHistoryEntry(entry);
    if (message === null) return null;
    messages.push(message);
  }
  return { messages, hasOlder, hasNewer };
}

export function parseRoomPostAck(value: unknown): RoomPostAck | null {
  const ack = asObject(value);
  if (ack === null) return null;
  const seq = asCounter(ack.seq);
  const time = asCounter(ack.time);
  const rawAiCall: unknown = ack.ai_call;
  const aiCall =
    rawAiCall === null || rawAiCall === "queued" || rawAiCall === "refused" ? rawAiCall : undefined;
  const rawRefusal: unknown = ack.refusal;
  const refusal = rawRefusal === null || typeof rawRefusal === "string" ? rawRefusal : undefined;
  if (seq === null || time === null || aiCall === undefined || refusal === undefined) return null;
  return { seq, time, aiCall, refusal };
}

export function parseRoomNameAck(value: unknown): RoomNameAck | null {
  const ack = asObject(value);
  if (ack === null) return null;
  const memberId = asMemberId(ack.member_id);
  const name = asString(ack.name);
  if (memberId === null || name === null) return null;
  return { memberId, name };
}

export function parseRoomMemberEvent(value: unknown): RoomMemberEvent | null {
  const member = asObject(value);
  if (member === null) return null;
  const action = member.action;
  if (action !== "joined" && action !== "renamed" && action !== "left") return null;
  const memberId = asMemberId(member.member_id);
  if (memberId === null) return null;
  if (member.name === null) return { action, memberId, name: null };
  const name = asString(member.name);
  return name === null ? null : { action, memberId, name };
}

export function parseRoomAiStatus(value: unknown): RoomAiStatus | null {
  const status = asObject(value);
  if (status === null) return null;
  const state = asString(status.state);
  // state/who/running/queue are §7's example and every door frame; busy,
  // you_pending, note_code and note ride the door's frames only and are
  // typed when present, absent when not.
  const who =
    status.who === null ? null : typeof status.who === "string" ? status.who : undefined;
  const running =
    status.running === null
      ? null
      : typeof status.running === "string"
        ? status.running
        : undefined;
  if (state === null || who === undefined || running === undefined) return null;
  if (!Array.isArray(status.queue)) return null;
  const queue: string[] = [];
  for (const entry of status.queue) {
    const name = asString(entry);
    if (name === null) return null;
    queue.push(name);
  }
  const parsed: RoomAiStatus = { state, who, running, queue };
  const busy = asBoolean(status.busy);
  const youPending = asBoolean(status.you_pending);
  if (busy !== null) parsed.busy = busy;
  if (youPending !== null) parsed.youPending = youPending;
  if (typeof status.note_code === "string" || status.note_code === null) {
    parsed.noteCode = status.note_code as string | null;
  }
  if (typeof status.note === "string" || status.note === null) {
    parsed.note = status.note as string | null;
  }
  return parsed;
}

export function parseRoomAiDelta(value: unknown): RoomAiDelta | null {
  const delta = asObject(value);
  if (delta === null) return null;
  const text = asString(delta.text);
  if (text === null) return null;
  if (delta.turn === undefined) return { text };
  const turn = asCounter(delta.turn);
  return turn === null ? null : { turn, text };
}
