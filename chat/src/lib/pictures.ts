/**
 * The pictures on the wire: how many there are, what they weigh, and which of
 * them may be let go.
 *
 * **A picture is counted as IMAGE_TOKENS by the token fit whatever it
 * weighs** (`attachments.ts`), so a wire full of pictures can pass the
 * window's fit and still be refused by the door, which counts bytes and
 * answers 413 past sixteen of them. This is the measure the token fit cannot
 * make, and the two guards that need it live here: the one that refuses a
 * picture past the ceiling, and the one that lets the oldest go.
 */

import type { WireMessage } from "./chat";
import { wireBodyBytes } from "./wireBudget";
import { BROWSER_SCREENSHOT_NAME } from "./tools/browserTools";

/**
 * How many pictures one turn may carry. **Six.**
 *
 * It is a ceiling and not a plan: a turn that wants more is a model that
 * cannot see what it already has, and the picture it asks for is the one it
 * would have to forget. Six is enough to look at a page before and after a
 * step, and few enough that the body they ride in stays inside the door's
 * road.
 */
export const MAX_PICTURES_PER_TURN = 6;

/** What is said in place of a picture the body had to let go: the line stays
    true, and the model is not told it can see a picture that is not there. */
const PICTURE_LET_GO = "The picture itself was let go to make room; this line is all that is left of it.";

/**
 * What one turn's pictures may weigh together: **six mebibytes**.
 *
 * The room the body has for them, less the envelope's own — the tool
 * definitions, the knobs and the framing — so a body carrying this much
 * still leaves the door's sixteen mebibytes alone. A picture of the page is
 * at most 256 KiB of JPEG, which is under half a megabyte of base64, so six
 * of them fit here with room to spare; the ceiling is what a turn that
 * carries the person's own pictures as well has to answer to.
 */
export const PICTURE_BYTES_PER_TURN = 6 * 1024 * 1024;

/** A picture on the wire, and where it is. */
export interface PicturePart {
  /** The message it is in. */
  message: number;
  /** Its own index in that message's content. */
  part: number;
  /** What it weighs, in the bytes the door counts. */
  bytes: number;
}

/**
 * Every picture part on the wire, in the order they appear.
 *
 * **The weight is the URI's, not the picture's**: the bytes ride as a data
 * URI, and that is what the body carries.
 */
export function pictureParts(messages: WireMessage[]): PicturePart[] {
  const found: PicturePart[] = [];
  messages.forEach((message, index) => {
    if (!Array.isArray(message.content)) return;
    message.content.forEach((part, at) => {
      if (part.type !== "image_url") return;
      found.push({ message: index, part: at, bytes: wireBodyBytes(part.image_url.url) });
    });
  });
  return found;
}

/** How many pictures the wire carries, and what they weigh together. */
export function pictureLoad(messages: WireMessage[]): { count: number; bytes: number } {
  const parts = pictureParts(messages);
  let bytes = 0;
  for (const part of parts) bytes += part.bytes;
  return { count: parts.length, bytes };
}

/**
 * How many pictures this turn has taken: **the calls, not the bytes.**
 *
 * A picture the body later let go is still a picture the turn took, so the
 * count walks the calls rather than the parts: a wire whose pictures were
 * dropped still says how many pictures there were.
 *
 * The turn's own ledger counts them too, and it is the one that knows about
 * the calls of the round in flight; this is the count for a caller with no
 * ledger.
 */
export function picturesTaken(messages: WireMessage[]): number {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) names.set(call.id, call.function.name);
  }
  let taken = 0;
  for (const message of messages) {
    if (message.role !== "tool") continue;
    if (names.get(message.tool_call_id ?? "") === BROWSER_SCREENSHOT_NAME) taken += 1;
  }
  return taken;
}

/**
 * Lets the oldest **tool's** picture go, and says whether one went.
 *
 * **Only the tool's pictures go.** The person's own pictures are theirs: the
 * road they took was measured before the turn began, and a picture the
 * person attached is not this app's to drop.
 *
 * **The line stays, and the absence is said.** What the picture said about the
 * page — the host and the moment — is still true, and the model can still act
 * on it: the picture goes, its line does not. And the line says the picture is
 * gone, so a model is not left describing a page it has not seen.
 */
export function demoteOldestToolPicture(messages: WireMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    const content = message.content;
    if (!content.some((part) => part.type === "image_url")) continue;
    const line = content.find((part) => part.type === "text");
    message.content = line === undefined ? PICTURE_LET_GO : `${line.text}\n${PICTURE_LET_GO}`;
    return true;
  }
  return false;
}
