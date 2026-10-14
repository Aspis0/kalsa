/**
 * The IMAP server for a common address, guessed from its domain. It is a
 * default in the Settings field and nothing more: the field is editable, and
 * `brain_mail_account_test` tests the account that was saved, never a host
 * the caller passes in.
 */

const BY_DOMAIN: Record<string, string> = {
  "icloud.com": "imap.mail.me.com",
  "me.com": "imap.mail.me.com",
  "mac.com": "imap.mail.me.com",
  // Microsoft: named here so its own sentence is shown, not the "unknown
  // provider" one a missing entry would give.
  "outlook.com": "outlook.office365.com",
  "outlook.it": "outlook.office365.com",
  "hotmail.com": "outlook.office365.com",
  "hotmail.it": "outlook.office365.com",
  "live.com": "outlook.office365.com",
  "gmail.com": "imap.gmail.com",
  "googlemail.com": "imap.gmail.com",
  "libero.it": "imapmail.libero.it",
  "virgilio.it": "imap.virgilio.it",
  "aruba.it": "imap.aruba.it",
  "tiscali.it": "imap.tiscali.it",
  "alice.it": "imap.alice.it",
  "fastmail.com": "imap.fastmail.com",
  "yahoo.com": "imap.mail.yahoo.com",
  "yahoo.it": "imap.mail.yahoo.com",
};

// Microsoft's IMAP needs its own sign-in, and this phase wires none: the
// address is refused with the reason rather than left to fail at the login.
const UNSUPPORTED = new Set(["outlook.office365.com"]);

export interface ServerGuess {
  host: string;
  supported: boolean;
}

/** The server this address most likely means, or null when it is none of them:
    an unknown domain still gets a field, the person's to fill in. */
export function guessServer(email: string): ServerGuess | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  const host = BY_DOMAIN[domain];
  if (host === undefined) return null;
  return { host, supported: !UNSUPPORTED.has(host) };
}

/** A provider that needs a password of its own, stated where it is typed. */
export function needsAppPassword(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain === "gmail.com" || domain === "googlemail.com";
}