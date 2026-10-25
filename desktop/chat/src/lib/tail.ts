/**
 * Incremental last-line tracker for the thinking ticker. Only the visible
 * tail is kept: appending costs O(chunk), never O(history). A trailing
 * newline is kept as a one-char break marker (stripped at display time) so
 * the next chunk cannot glue onto the finished line. Display correctness
 * holds by cases — the tail shown is capped far below what is kept, so a
 * dropped head can never change it. Pure and dependency-free so tests can
 * import it directly.
 */
export function appendTail(prev: string, chunk: string): string {
  const text = (prev + chunk).slice(-400);
  if (/\n+$/.test(text)) {
    const stripped = text.replace(/\n+$/, "");
    const cut = stripped.lastIndexOf("\n");
    const line = cut === -1 ? stripped : stripped.slice(cut + 1);
    return `${line.slice(-140)}\n`;
  }
  const cut = text.lastIndexOf("\n");
  const line = cut === -1 ? text : text.slice(cut + 1);
  return line.slice(-140);
}
