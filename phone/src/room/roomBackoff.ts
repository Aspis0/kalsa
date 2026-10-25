/**
 * The retry curve both room clients share: the stream's reconnects and
 * the outgoing queue's retries — capped exponential backoff with
 * half-jitter — attempt 0 lands in [500, 1000) ms and nothing ever
 * exceeds the 30 s cap. Pure, so its band is testable without timers.
 */

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

export function backoffDelayMs(attempt: number): number {
  const growth = BACKOFF_BASE_MS * 2 ** Math.min(Math.max(attempt, 0), 16);
  const capped = Math.min(BACKOFF_CAP_MS, growth);
  return Math.floor(capped / 2 + Math.random() * (capped / 2));
}
