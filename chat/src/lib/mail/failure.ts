/**
 * Which cause a failed mail call carries, and whether the fix is in Settings.
 *
 * The backend answers a rejection with a code and nothing else
 * (`mail/error.rs`), so this is the whole truth table: the thread's notice is
 * Kalsa's own words, and the model is told the cause is already on screen. A
 * code that is not here draws no card — a cause nobody has words for is better
 * left to the sentence the sidecar already wrote.
 */

export type MailFailureKind = "keychain" | "noAccount" | "refused" | "unreachable" | "program" | "storage" | "unknown";

/** The sidecar's own code for a read of an id no list of this session returned
    (`imap::NOT_LISTED`). It is not in the table below because there is nothing to
    fix in Settings: the mailbox was reloaded, and the person asks for it again. */
export const NOT_LISTED = "not_listed";

export interface MailFailure {
  kind: MailFailureKind;
  /** Whether the person can fix it in Settings → Mail, which the card offers. */
  inSettings: boolean;
}

const BY_CODE: Record<string, MailFailure> = {
  "mail.keychain": { kind: "keychain", inSettings: false },
  "mail.not_configured": { kind: "noAccount", inSettings: true },
  "mail.invalid_account": { kind: "refused", inSettings: true },
  "mail.server_gone": { kind: "unreachable", inSettings: false },
  "mail.failed": { kind: "unreachable", inSettings: false },
  "mail.not_approved": { kind: "program", inSettings: false },
  "mail.program_changed": { kind: "program", inSettings: false },
  "mail.storage": { kind: "storage", inSettings: false },
};

/** What a failure nobody wrote words for says: the sidecar refused in its own
    prose, with no code of its own, and Kalsa's sentence stands in for it. */
export const UNKNOWN_FAILURE: MailFailure = { kind: "unknown", inSettings: false };

export function mailFailure(code: string | undefined): MailFailure | null {
  return code === undefined ? null : (BY_CODE[code] ?? null);
}