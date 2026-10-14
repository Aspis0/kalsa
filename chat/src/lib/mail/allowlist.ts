/**
 * Which models may open the mailbox. The strings here are the catalog's
 * display names — the one the running state carries (`system.rs` sends
 * `display_name` as the model) — and every allowed row is named with its size,
 * because that is what separates them: "Liquid LFM 2.5" alone is the 2.6B
 * stack and the VL 3B, both excluded, while the 24B is allowed.
 *
 * Reading a stranger's mail is a job a small model does badly, and a mail it
 * misreads is still shown to the owner as the truth. A name this build does
 * not know is not allowed: the list is what was approved, not what is merely
 * unrecognised.
 */

const ALLOWED = [
  /qwen[\s_-]*3\.6/i,
  /gemma[\s_-]*4[\s_-]*e4b/i,
  /gemma[\s_-]*4[\s_-]*12b/i,
  /gemma[\s_-]*4[\s_-]*26b/i,
  /lfm[\s_.-]*2\.5[\s_.-]*24b/i,
];

/** The mail tools are offered and run only for these. */
export function mailAllowed(model: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(model));
}