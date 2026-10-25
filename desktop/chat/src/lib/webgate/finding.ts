/**
 * One thing the gate saw in an outgoing string, in the words the owner reads:
 * the kind of thing it looks like, the exact characters that tripped it, and —
 * for a run copied out of an attachment — the document it came from. A finding
 * never decides the call; it only makes the question louder.
 */
export interface GateFinding {
  kind: string;
  matched: string;
  /** Set only when the match was found in, and named after, a document. */
  source?: string;
}
