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
  /** The transcript generation; a change means a resync, not a page. */
  transcriptEpoch: string | number;
};

export type RoomHistoryMessage = {
  seq: number;
  memberId: number;
  name: string;
  time: number;
  text: string;
  callAi: boolean;
};

export type RoomHistoryPage = {
  messages: RoomHistoryMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
};

export type RoomPostAck = {
  seq: number;
  time: number;
  aiCall: null | "queued" | "refused";
  refusal: string | null;
};

export type RoomNameAck = { memberId: number; name: string };

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

function asEpoch(value: unknown): string | number | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
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
  const transcriptEpoch = asEpoch(info.transcript_epoch);
  const members = parseMembers(info.members);
  const ai = parseAiTurn(info.ai);
  if (
    roomName === null ||
    roomId === null ||
    roomId.length === 0 ||
    you === null ||
    transcriptEpoch === null ||
    members === null ||
    ai === null
  ) {
    return null;
  }
  return { roomName, members, ai, you, roomId, transcriptEpoch };
}

function parseMessage(value: unknown): RoomHistoryMessage | null {
  const message = asObject(value);
  if (message === null) return null;
  const seq = asCounter(message.seq);
  const memberId = asMemberId(message.member_id);
  const name = asString(message.name);
  const time = asCounter(message.time);
  const text = asString(message.text);
  const callAi = asBoolean(message.call_ai);
  if (seq === null || memberId === null || name === null || time === null || text === null || callAi === null) {
    return null;
  }
  return { seq, memberId, name, time, text, callAi };
}

export function parseRoomHistoryPage(value: unknown): RoomHistoryPage | null {
  const page = asObject(value);
  if (page === null) return null;
  const hasOlder = asBoolean(page.has_older);
  const hasNewer = asBoolean(page.has_newer);
  if (hasOlder === null || hasNewer === null || !Array.isArray(page.messages)) return null;
  const messages: RoomHistoryMessage[] = [];
  for (const entry of page.messages) {
    const message = parseMessage(entry);
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
