/**
 * Which sentence a failed account command is shown as. The codes are the ones
 * `src-tauri/src/mail` can answer with — `error.rs` names them, and an IMAP
 * login that is refused arrives as `mail.invalid_account`.
 *
 * Only a refusal of the login itself shows the app-password steps: every other
 * cause is about the machine or the account, and sending a person after a
 * sixteen-letter code would be sending them the wrong way.
 */

export type AccountErrorKey =
  | "notConfigured"
  | "invalidAccount"
  | "keychain"
  | "unsupportedProvider"
  | "notApproved"
  | "helperGone"
  | "failed";

const KEYS: Record<string, AccountErrorKey> = {
  "mail.not_configured": "notConfigured",
  "mail.invalid_account": "invalidAccount",
  "mail.keychain": "keychain",
  "mail.unsupported_provider": "unsupportedProvider",
  "mail.not_approved": "notApproved",
  "mail.program_changed": "helperGone",
  "mail.server_gone": "helperGone",
  "mail.denied": "helperGone",
  "mail.confirmation_needed": "helperGone",
  "mail.failed": "failed",
};

/** The sentence for this code; anything unknown is the plain "it did not work". */
export function accountErrorKey(code: string): AccountErrorKey {
  return KEYS[code] ?? "failed";
}
