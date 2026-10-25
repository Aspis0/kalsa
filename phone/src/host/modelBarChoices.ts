/**
 * The pill's where-choices: the rows its sheet offers and what a press on
 * each one does. A tap on the pill opens a STATUS sheet (model name, the
 * model bar's rows, the retry control) and never a model catalog, so with one
 * place able to answer there is no choice to offer: the caller gets no rows
 * and the strip drops the chevron instead of promising a picker that does not
 * exist.
 *
 * A usable pairing — or the computer already answering through a manual door
 * — makes the choice real. The press runs the SAME `selectLocation` the
 * Settings "Where it responds" sheet calls, so the refusal rules (a download,
 * a switch in flight, a document operation, a held send claim, a running
 * memory extract) and the room-removal handling stay in that one path
 * (`remoteModelSelection.ts` / `remoteModelHostActions.ts`); nothing here
 * re-decides them. The rows are DISABLED on the shared guard's own verdict —
 * the predicate the press would run through (`locationSwitchBlocked`) — so a
 * row never asks the switch for something it would only refuse, and a switch
 * can never dispose the engine under a running answer.
 *
 * Pure: translations, live booleans and the switch in; row data out, so the
 * table is a test and not a device probe.
 */
import type { AttachSheetRowData } from "../ui/shell/AttachSheet";

export function modelBarChoices(input: {
  /** The active pairing, unless a room already refused it (`removed`). */
  usablePairing: boolean;
  /** The computer is answering now, so the phone row is a real choice even
   *  without a pairing (a manual door): the chooser stays. */
  remoteActive: boolean;
  /** The shared location-switch guard's verdict this render
   *  (`remoteModelHostActions.locationSwitchBlocked`). */
  switchBlocked: boolean;
  /** The phone's selected local model — the name a switch back loads. */
  localModelName: string;
  labels: { phone: string; computer: string };
  /** The Settings control's own switch; a refusal is its `false`. */
  selectLocation: (location: "local" | "remote") => boolean;
}): AttachSheetRowData[] {
  const { usablePairing, remoteActive, switchBlocked, localModelName, labels, selectLocation } = input;
  // One place can answer: the sheet stays a status sheet, with no choices.
  if (!usablePairing && !remoteActive) return [];
  const shared = { role: "radio" as const, disabled: switchBlocked };
  return [
    {
      ...shared,
      testID: "shell.modelSheet.location.phone",
      label: `${labels.phone} · ${localModelName}`,
      selected: !remoteActive,
      // The verdict is the Settings switch's own (a refusal speaks through
      // the one-slot notice); this row does not consume it.
      onPress: () => {
        selectLocation("local");
      },
    },
    {
      ...shared,
      testID: "shell.modelSheet.location.computer",
      label: labels.computer,
      selected: remoteActive,
      onPress: () => {
        selectLocation("remote");
      },
    },
  ];
}
