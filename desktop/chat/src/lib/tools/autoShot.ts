import type { ToolImage } from "../chat";
import type { Ledger } from "../callLedger";
import { logBrowserFailure } from "../browser/diagnostics";
import { MAX_PICTURES_PER_TURN } from "../pictures";
import type { BrowserShot, ConversationId } from "./browserCall";
import { browserScreenshot, shotImage, shotLine } from "./browserCall";
import type { PictureGate } from "./browserTools";
import { picturesAllowed } from "./browserTools";

/**
 * The picture that comes with the open.
 *
 * **The open is what brings it.** A model that opens a page sees the page: the
 * picture is taken once, right after the open succeeded, and it rides the
 * open's own answer. One open, one picture — and an open that failed has no
 * picture, because there is no page to have one of.
 *
 * **The gate is the offer's gate.** The same three things that let the model
 * ask for a picture let it be given one: the turn is armed, the flag is on and
 * the engine can see. A turn without the flag is given nothing, and the phone
 * is given nothing either — it never carries a picture at all.
 *
 * **A picture that could not be taken is not a failure of the open.** The open
 * stands on its own answer and the model is told nothing: a sentence about a
 * picture the model never asked for would be a sentence about a page it is
 * already reading.
 */
export async function automaticShot(
  opened: string,
  conversationId: ConversationId,
  calls: Ledger | null,
  pictures: PictureGate | undefined,
  signal: AbortSignal | undefined,
): Promise<ToolImage | null> {
  // **The gate is the offer's gate.**
  if (!picturesAllowed(pictures)) return null;
  // **The turn's ledger is what counts the pictures.** A caller with no ledger
  // cannot know how many the turn took — the answers enter the wire only when
  // the round is over, so a batch of opens would each see the same count — and
  // a ceiling that cannot be counted is no ceiling.
  //
  // **And the ceiling is the turn's, shared.** Six opens that brought a picture
  // have spent the turn's six pictures, and a picture asked for by hand after
  // that is refused: one budget for the pictures of a turn, whoever asked.
  if (calls === null || calls.pictures >= MAX_PICTURES_PER_TURN) return null;
  let shot: BrowserShot;
  try {
    shot = await browserScreenshot(conversationId, signal);
  } catch {
    // **A picture is not worth an open.** A command that failed outright is
    // still a picture that did not arrive: the open stands on its own answer,
    // and the log is where the loss is said.
    logBrowserFailure("auto_shot");
    return null;
  }
  const image = shotImage(shot);
  if (image === null) {
    // **The sidecar refused, and the open stands.** The refusal is for the log
    // alone: the model reads the open and nothing else.
    logBrowserFailure("auto_shot");
    return null;
  }
  return {
    ...image,
    // **The open's own words first, the line beside them.** The model reads the
    // page as it came, and the line says which page the picture is of.
    text: `${opened}\n${image.text}`,
    // **The line the record keeps**, in words and never in bytes.
    line: shotLine(shot),
  };
}
