/**
 * The address the person reads their mail with, kept beside the app's other
 * settings. The card and the Mail tab both show it as the recipient of
 * everything they send, and no command answers it: the account's own record
 * lives in Rust, and this is the copy the page can read without one.
 */

const KEY = "crescent-chat.mail-account.v1";

export function rememberAccount(email: string): void {
  const clean = email.trim();
  if (clean === "") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ email: clean }));
  } catch {
    // No storage: the page forgets it and the Mail tab says what it has.
  }
}

/** The account address, or "" when no account has been saved on this machine. */
export function accountEmail(): string {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return "";
    const parsed = JSON.parse(raw) as { email?: unknown };
    return typeof parsed.email === "string" ? parsed.email : "";
  } catch {
    return "";
  }
}
