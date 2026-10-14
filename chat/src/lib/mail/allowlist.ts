/**
 * Which models may open the mailbox. The small ones are excluded: reading a
 * stranger's mail is a job a 2.6B model does badly, and a mail it misreads is
 * still shown to the owner as the truth. A name this build does not know is
 * not allowed — the allowlist is what is approved, not what is merely unknown.
 */

const ALLOWED = [/qwen[\s_-]*3\.6/i, /gemma[\s_-]*4/i];

/** The mail tools are offered and run only for these. LFM 2.5 2.6B and the LFM
    VL family match nothing allowed, so they are excluded without a list of
    their own. */
export function mailAllowed(model: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(model));
}