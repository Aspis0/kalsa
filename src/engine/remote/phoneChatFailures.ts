/**
 * The failure codes of the phone chat contract (PHONE-CHAT-PROTOCOL §3 turn
 * errors, §4/§5 mail route errors) said in the phone's own words.
 *
 * A code the computer invented is not echoed: the person reading a failure
 * sentence has to be able to trust it, and a sentence assembled out of
 * whatever arrived would be a sentence nobody wrote.
 *
 * The door's own codes (`remote_brain_*`) belong to `remoteBrainErrors`, and
 * this delegates them rather than repeating the table — a mail route answers
 * with both families and the phone must not say two different things about
 * one dead door.
 */
import type { TranslationKey } from "../../i18n";
import { humanRemoteBrainError } from "./remoteBrainErrors";

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

const CONTRACT_CODE_KEYS: Record<string, TranslationKey> = {
  // One turn at a time per phone; the first keeps running.
  busy: "chat.mail.failBusy",
  // The computer took the turn and then had no window to run it in.
  no_runner: "chat.mail.failNoRunner",
  engine: "chat.mail.failEngine",
  bad_request: "chat.mail.failBadRequest",
  "mail.invalid_account": "chat.mail.failInvalidAccount",
  "mail.keychain": "chat.mail.failKeychain",
  "mail.storage": "chat.mail.failStorage",
  "mail.unavailable": "chat.mail.failUnavailable",
  // The draft is spent, expired, or was never this phone's.
  draft_unknown: "chat.mail.failDraftExpired",
};

/** True for a code the contract names, so a caller can tell one apart from
 *  the engine's own sentence before translating it. */
export function isContractFailureCode(code: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(CONTRACT_CODE_KEYS, code) || code === "cancelled"
  );
}

export function humanContractFailure(code: string | undefined, t: Translate): string {
  if (!code) return t("chat.mail.failGeneric");
  if (code.startsWith("remote_brain_")) return humanRemoteBrainError(code, t);
  if (code === "cancelled") return t("chat.interrupted");
  // Own properties only: a code off the wire ("constructor") must not resolve
  // to an inherited member and leak into `t()`.
  const key = Object.prototype.hasOwnProperty.call(CONTRACT_CODE_KEYS, code)
    ? CONTRACT_CODE_KEYS[code]
    : undefined;
  return key ? t(key) : t("chat.mail.failGeneric");
}