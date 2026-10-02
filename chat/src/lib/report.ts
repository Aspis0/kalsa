// The tester's report, from the page's side: one command, one id, four
// stable refusal codes the surfaces word themselves. Never sent but by a
// press — this module holds no timer, no retry, no queue.

import { invoke } from "./tauri";

export type SendRefusal = "rate_limited" | "try_tomorrow" | "offline" | "failed";

/** Sends the log report. Resolves to the report id the server minted;
    rejects with one of the four stable codes. */
export function sendLog(): Promise<string> {
  return invoke<string>("brain_send_log");
}
