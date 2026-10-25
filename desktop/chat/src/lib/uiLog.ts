// The page's half of the log's `ui:` line: one stable code for one failure the
// person is already reading on screen.
//
// Never a sentence. A sentence shown to the owner can quote a conversation
// title, an answer or a file name, and the log's promise is that none of those
// ever reach the file; the code is minted where the sentence is chosen, and
// Rust writes only codes shaped `^[a-z0-9_.]{1,64}$` (src-tauri/src/ui_event.rs),
// so a bug that hands over prose gets one fixed line instead of the prose.
//
// Fire and forget: the person is already looking at the failure, and a log
// line that fails must not become a second one.

import { available, invoke } from "./tauri";

/** The one shape the log writes, checked here as well as in Rust: a code that
    is not a code is a bug at the call site, and a bug must never become the
    line the log promises never to carry. */
const CODE = /^[a-z0-9_.]{1,64}$/;

export function logUiEvent(code: string): void {
  // `typeof window` first on purpose: the screenshot and slot harnesses
  // bundle this module for Node, where `window` does not exist and a bare
  // read in `available()` would be a ReferenceError.
  if (typeof window === "undefined" || !available()) return;
  if (!CODE.test(code)) return;
  void invoke("brain_log_event", { code }).catch(() => {});
}
