import { mailAllowed } from "./allowlist";
import type { Capability } from "../../surfaces/MachineCard";

/**
 * The mail table's key for the notice the page shows about the running AI.
 * The three are what this computer can honestly say: an AI that may read mail
 * is offered here, none is, or nothing is known yet.
 */
export type MailNoticeKey =
  | "modelNotAllowed"
  | "mailUnavailableHere"
  | "modelCannotRead";

/**
 * The notice for the running AI, or null when there is nothing to say: no AI
 * is running, or the running one may read mail.
 */
export function mailNotice(running: string, capability: Capability | null): MailNoticeKey | null {
  if (running === "" || mailAllowed(running)) return null;
  if (capability === null || capability.kind !== "measured") return "modelCannotRead";
  const model = capability.model;
  const quicker = capability.quicker;
  // A measured capability offering no option at all says nothing about which
  // AIs this computer can run: it is not an offer of none.
  if (model === null && quicker === null) return "modelCannotRead";
  if (model !== null && mailAllowed(model.name)) return "modelNotAllowed";
  if (quicker !== null && mailAllowed(quicker.name)) return "modelNotAllowed";
  return "mailUnavailableHere";
}
