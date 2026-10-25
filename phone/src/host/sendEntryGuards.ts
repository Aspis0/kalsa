/**
 * The entry guards of one send — one decision in one place: may this send
 * dispatch at all? The claim check (old controller minus the voice/PDF busy
 * flags this host does not have; the translate flag it DOES have), plus the
 * model-switch guard added for the switch race. The visible refusals are the
 * composer's holds; this module covers the paths that never consult the
 * composer (cards, edit/regenerate) — hence its own home rather than a
 * longer inline condition in `sendHost`.
 */
import { sendClaimRef } from "../engine/regenState";
import { modelSwitchInFlightRef } from "./modelSwitchState";
import { translationInFlightRef } from "./translateState";

export function sendEntryRefused(input: {
  /**
   * Non-empty draft OR staged rows — an attachment-only send IS a send
   * (controller `Chat:3676`); foreign callers (edit/regenerate) hand their
   * own attachments, the face, a card or the welcome block consume rows.
   */
  hasSomethingToSend: boolean;
  /** This host's own live-run flag (a hook ref, not module state). */
  sending: boolean;
  /** Nothing dispatches before the history load has settled. */
  historyLoaded: boolean;
}): boolean {
  return (
    !input.hasSomethingToSend ||
    sendClaimRef.current ||
    input.sending ||
    translationInFlightRef.current ||
    modelSwitchInFlightRef.current ||
    // A model switch in flight owns the engine from the tap (its dispose may
    // run mid-turn): a send must not slip in between the flip and the dispose.
    !input.historyLoaded
  );
}
