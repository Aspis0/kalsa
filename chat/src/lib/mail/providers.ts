/**
 * The IMAP server for a common address, guessed from its domain, for the Server
 * field to show. The backend's table in `src-tauri/src/mail/providers.rs` is the
 * authority: this one mirrors it, and `mail-cards.mjs` fails when the two
 * disagree. A guessed value is never sent to the backend; only one the person
 * typed is.
 */

const BY_DOMAIN = new Map<string, string>([
  ["icloud.com", "imap.mail.me.com"],
  ["me.com", "imap.mail.me.com"],
  ["mac.com", "imap.mail.me.com"],
  ["gmail.com", "imap.gmail.com"],
  ["googlemail.com", "imap.gmail.com"],
  ["libero.it", "imapmail.libero.it"],
  ["iol.it", "imapmail.libero.it"],
  ["blu.it", "imapmail.libero.it"],
  ["inwind.it", "imapmail.libero.it"],
  ["virgilio.it", "in.virgilio.it"],
  ["aruba.it", "imap.aruba.it"],
]);

// Microsoft asks for OAuth2 on its IMAP server, which this build does not do: the
// address is refused with the reason, and no server is guessed for it.
const UNSUPPORTED = new Set(["outlook.com", "hotmail.com", "hotmail.it", "live.com", "outlook.it"]);

export interface ServerGuess {
  host: string | null;
  supported: boolean;
}

/** The server this address most likely means, or null when it is none of them:
    an unknown domain still gets a field, the person's to fill in. */
export function guessServer(email: string): ServerGuess | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  if (UNSUPPORTED.has(domain)) return { host: null, supported: false };
  const host = BY_DOMAIN.get(domain);
  if (host === undefined) return null;
  return { host, supported: true };
}
