// What the Phones page shows for one pairing read: the title, the words, the
// square and the one button. Pure, so a state cannot leave a stale square or
// a half-cleared button behind, and the page only maps the action to a call.

import type { English } from "../i18n/en/all";
import type { IconName } from "../components/Icon";
import { everyPhoneWaiting, pairedSentence, tailscaleNote } from "./pairingWords";
import type { PairedDevice, PairingState } from "./pairingWords";

/** What the page's button (and its second one) does. */
export type PanelAction = "turnOn" | "retry" | "refresh" | "forgetAndRefresh";

export interface PhonesPanel {
  title: string;
  lead: string | null;
  headline: string | null;
  sentence: string;
  qrSvg: string | null;
  fresh: string | null;
  note: string | null;
  noteClass: string;
  tailscale: string | null;
  button: string | null;
  buttonIcon: IconName | null;
  quietButton: boolean;
  action: PanelAction | null;
  alt: string | null;
  altAction: PanelAction | null;
  devices: PairedDevice[];
}

/** `settled`: the first read has answered or given up. `canAsk`: a retry can
    reach the backend at all (false outside the webview). */
export function phonesPanel(
  t: English["devices"],
  state: PairingState | null,
  settled: boolean,
  canAsk: boolean,
): PhonesPanel {
  const panel: PhonesPanel = {
    title: t.title,
    lead: null,
    headline: null,
    sentence: "",
    qrSvg: null,
    fresh: null,
    note: null,
    noteClass: "surface-quiet",
    tailscale: null,
    button: null,
    buttonIcon: null,
    quietButton: false,
    action: null,
    alt: null,
    altAction: null,
    devices: [],
  };

  if (state === null) {
    // Still the first read: say so plainly and offer no retry — there is
    // nothing to retry yet, and "could not check" would be false. Settled
    // with nothing to show, the read rejected, hung past the bound, or
    // cannot run at all; "Try again" is offered only where a retry can ask.
    if (!settled) return { ...panel, sentence: t.checking };
    return canAsk
      ? { ...panel, sentence: t.couldNotCheckSentence, button: t.tryAgain, action: "refresh" }
      : { ...panel, sentence: t.couldNotCheckSentence };
  }

  const tailscale = tailscaleNote(t, state.door_port, state.desk_port, state.desk_port_preferred !== false);
  switch (state.state) {
    case "idle":
      return {
        ...panel,
        lead: t.connectLead,
        headline: t.offHeadline,
        sentence: t.notRunningYet,
        button: t.turnKalsaOn,
        buttonIcon: "power",
        action: "turnOn",
      };
    case "waiting":
      // No square yet is its own honest moment, not a camera instruction.
      if (!state.qr_svg) return { ...panel, title: t.connectTitle, lead: t.connectLead, sentence: t.squareNotReady };
      return {
        ...panel,
        title: t.connectTitle,
        lead: t.connectLead,
        sentence: t.cameraInstruction,
        qrSvg: state.qr_svg,
        fresh: state.refreshed ?? null,
        note: t.awareness,
        tailscale,
      };
    case "claiming":
      return {
        ...panel,
        title: t.connectTitle,
        sentence: t.claiming,
        note: t.onlyAllowKnown,
        noteClass: "phones-note",
        button: t.cancel,
        quietButton: true,
        action: "retry",
      };
    case "paired": {
      // The house itself is the page's title (09-phones-paired), its
      // sentence the lead under it.
      const sentence = pairedSentence(t, state);
      return {
        ...panel,
        title: everyPhoneWaiting(state.devices) ? t.waitingForOkHeadline : t.pairedHeadline,
        lead: sentence,
        sentence,
        button: t.pairAnother,
        buttonIcon: "plus",
        action: "retry",
        tailscale,
        devices: Array.isArray(state.devices) ? state.devices : [],
      };
    }
    case "failed":
      if (state.failure === "could-not-read") {
        return {
          ...panel,
          lead: t.connectLead,
          headline: t.couldNotReadHeadline,
          sentence: t.couldNotReadSentence,
          button: t.forgetAndPairAgain,
          action: "forgetAndRefresh",
          alt: t.tryAgain,
          altAction: "refresh",
        };
      }
      if (state.failure === "service-unavailable") {
        return {
          ...panel,
          lead: t.connectLead,
          headline: t.unavailableHeadline,
          sentence: t.unavailableSentence,
          button: t.turnKalsaOn,
          quietButton: true,
          action: "turnOn",
        };
      }
      // True for both roads: a square can be drawn again, an invitation
      // can be sent again, and neither promises that the last attempt
      // will come back on its own.
      return {
        ...panel,
        lead: t.connectLead,
        headline: t.couldNotFinishHeadline,
        sentence: t.couldNotSaveSentence,
        button: t.tryAgain,
        buttonIcon: "refresh",
        action: "retry",
      };
    default:
      return { ...panel, sentence: t.couldNotCheckSentence, button: t.tryAgain, action: "refresh" };
  }
}
