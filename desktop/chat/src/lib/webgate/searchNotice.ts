// The first-search notice's half that is not a dialog: which service this
// build searches with, and whether this install has been told. The name comes
// from the door, which reads it off the provider that sends the query, so the
// words the owner reads are never a second copy that can go stale.

import { available, invoke } from "../tauri";

export interface SearchNoticeState {
  /** The active provider's own display name, e.g. "Exa". */
  provider: string;
  answered: boolean;
}

/** What the door said, read once per window — but only a read that named a
    service is kept. Until the door says otherwise the state is NOT answered
    and has no name: a notice the owner never read is not consent, and words
    that left to a service they were not told about are worse than a refusal.
    That refusal is for the search that hit it; the next one asks again. */
const state: SearchNoticeState = { provider: "", answered: false };
let reading: Promise<SearchNoticeState> | null = null;

export function searchNotice(): Promise<SearchNoticeState> {
  if (reading === null) {
    reading = read().then((answer) => {
      // A read that named no service did not happen. Forget it, so the next
      // search asks the door again and a window whose bridge was briefly gone
      // recovers without a restart. A read that named one is kept: the answer
      // can only move from unanswered to answered, and a second search must not
      // pay for a second round trip to learn that.
      if (answer.provider === "") reading = null;
      return answer;
    });
  }
  return reading;
}

async function read(): Promise<SearchNoticeState> {
  if (!available()) return state;
  const answer = await invoke<unknown>("brain_web_search_notice").catch(() => null);
  const provider = (answer as { provider?: unknown } | null)?.provider;
  // A door that rejects, or answers with no name in it, leaves the state as it
  // started — nothing to show and nothing to rely on. The caller refuses the
  // search rather than sending it unseen.
  if (typeof provider !== "string" || provider === "") return state;
  state.provider = provider;
  state.answered = (answer as { answered?: unknown }).answered === true;
  return state;
}

/** The owner answered: this install's first search has been told. Kept in
    this window whether or not the disk takes it — the answer was given, and a
    question seconds later would be a lie. A write the desk refuses asks again
    at the next start, which is exactly what was stored. */
export async function answerSearchNotice(): Promise<void> {
  state.answered = true;
  if (!available()) return;
  await invoke("brain_web_search_notice_answered").catch(() => {});
}