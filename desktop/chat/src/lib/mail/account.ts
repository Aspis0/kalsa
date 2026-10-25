/**
 * The account this machine reads its mail with, asked of the backend.
 *
 * The page and the Mail tab both show it, and neither keeps its own copy: a
 * copy in browser storage said a deleted account was still linked, and said it
 * with nothing in the fields to contradict it. The answer carries the address
 * and the host and never the password — that stays where Rust put it.
 */

import { invoke } from "../tauri";

export interface MailAccount {
  email: string;
  host: string;
}

/** The saved account, or null when this machine has none. */
export function readAccount(): Promise<MailAccount | null> {
  return invoke<MailAccount | null>("brain_mail_account_get").then((answer) => {
    if (answer === null || typeof answer !== "object") return null;
    const email = typeof answer.email === "string" ? answer.email : "";
    return email === "" ? null : { email, host: typeof answer.host === "string" ? answer.host : "" };
  });
}