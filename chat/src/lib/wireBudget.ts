/**
 * What fits through the door. The door reads at most 16 MiB of request body
 * (`crates/kalsa-door/src/request.rs` MAX_BODY) and answers 413 past it, so a
 * conversation full of pictures must be packed before it leaves — the fit's
 * token budget knows nothing of base64 weight. Pure arithmetic and one
 * selection rule; no fetch, no DOM.
 */

/** The whole JSON body's ceiling: the door's 16 MiB minus room for the
    envelope's growth between here and the socket (chunked transfer, head
    framing) that this side cannot measure. */
export const WIRE_BODY_BUDGET = 12 * 1024 * 1024;

/** What the attach road allows one conversation's pending pictures to weigh
    together: the budget above with the rest of the body still unknown (a
    megabyte covers the envelope, the tools and any text the token fit has
    already passed — none of which reaches a megabyte in practice). */
export const ATTACH_IMAGE_CEILING = WIRE_BODY_BUDGET - 1024 * 1024;

/** base64 grows bytes by 4/3, and the part dresses each URI in a few dozen
    characters of JSON (`{"type":"image_url","image_url":{"url":"data:…` —
    the prefix is part of the string, the quotes and braces its frame). */
export function wireImageBytes(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3) + 64;
}

export interface WireImage {
  id: string;
  /** The stored blob's size in bytes. */
  bytes: number;
}

export interface WireImagePick {
  /** The ids that ride as image parts. */
  rides: Set<string>;
  /** What the riders weigh on the wire, in the same units as the budget. */
  imageBytes: number;
}

/**
 * Which stored pictures ride and which become the text placeholder: the
 * NEWEST are kept and the oldest are demoted first, because the newest are
 * what the model is being asked about and the oldest are the conversation's
 * own past. The last `protect` pictures (the current turn's own) always
 * ride — the caller refuses the send outright when even they do not fit,
 * rather than dropping a picture the person just attached without a word.
 * `nonImageBytes` is the body's length with every picture already a
 * placeholder, so the budget left for pictures is what it says it is.
 */
export function selectWireImages(
  images: WireImage[],
  nonImageBytes: number,
  protect: number,
): WireImagePick {
  const budget = WIRE_BODY_BUDGET - nonImageBytes;
  const rides = new Set<string>();
  let spent = 0;
  // Newest first; a picture that does not fit ends the walk, so an older,
  // smaller one cannot buy its way in past a newer one that was dropped.
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index];
    const cost = wireImageBytes(image.bytes);
    const guarded = index >= images.length - protect;
    if (!guarded && spent + cost > budget) break;
    rides.add(image.id);
    spent += cost;
  }
  return { rides, imageBytes: spent };
}
