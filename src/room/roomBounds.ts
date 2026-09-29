/**
 * The bounds §5, §6 and §9 put on what this phone may send, checked
 * before any request exists: a refusal here means the bytes never left
 * the phone. The rules the COMPUTER enforces on content (a taken name, a
 * lookalike script mix) are its to make — only the numeric bounds are
 * ours to pre-check.
 */
import type { RoomError } from "./roomError";

const utf8 = new TextEncoder();

function invalid(message: string): RoomError {
  return { code: "invalid_input", message };
}

/** §9: 1–8000 UTF-8 bytes, empty included in the refusal. */
export function checkRoomText(text: string): RoomError | null {
  const bytes = utf8.encode(text).length;
  if (bytes < 1 || bytes > 8000) return invalid("Message text must be 1-8000 UTF-8 bytes.");
  return null;
}

/** §9: 1–40 UTF-8 bytes after trimming — the same value the computer compares. */
export function checkRoomName(name: string): RoomError | null {
  const bytes = utf8.encode(name.trim()).length;
  if (bytes < 1 || bytes > 40) return invalid("The display name must be 1-40 UTF-8 bytes.");
  return null;
}

/** §9: 1–64 characters, every one ASCII 0x21–0x7E. */
export function checkClientMsgId(clientMsgId: string): RoomError | null {
  if (clientMsgId.length < 1 || clientMsgId.length > 64) {
    return invalid("client_msg_id must be 1-64 characters of ASCII 0x21-0x7E.");
  }
  for (let i = 0; i < clientMsgId.length; i += 1) {
    const code = clientMsgId.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      return invalid("client_msg_id must be 1-64 characters of ASCII 0x21-0x7E.");
    }
  }
  return null;
}

/** §4: an integer 1–200; the default of 100 is the computer's to apply. */
export function checkHistoryLimit(limit: number): RoomError | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return invalid("The history limit must be an integer from 1 to 200.");
  }
  return null;
}
