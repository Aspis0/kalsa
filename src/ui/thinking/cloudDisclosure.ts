/**
 * Which thinking clouds the reader left open, by message id.
 *
 * The disclosure's open/closed choice cannot live in the row: the streaming
 * row remounts when its answer settles (the transcript band's context-fed
 * footer becomes an ordinary list cell) and any row remounts as the
 * conversation's render window pages — local state resets on both. This
 * module is the row's memory across those remounts: read on mount, written
 * on toggle. It holds only ids the reader OPENED (closed is the absence), so
 * it grows with the reader's toggles, not with the messages.
 */
const openIds = new Set<string>();

export function cloudInitiallyOpen(messageId: string): boolean {
  return openIds.has(messageId);
}

export function rememberCloudOpen(messageId: string, open: boolean): void {
  if (open) openIds.add(messageId);
  else openIds.delete(messageId);
}
