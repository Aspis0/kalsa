/**
 * Race one uncovered await against a timeout that REJECTS, so each caller's
 * existing failure path owns the fallback. The real promise is never
 * cancelled: its late settlement is swallowed (same contract as the raced
 * stopCompletion in disposeEngineLocked) and the timer is always cleared.
 *
 * KNOWN LIMIT: this is the plain JS timer, which Android suspends while the
 * activity is paused, so the bound covers the foreground only. That is the
 * opposite of the generation watchdogs, which were deliberately moved to the
 * native timer for exactly this reason. Moving these too needs a device to
 * validate the timer's lifecycle against dispose, so it stays a follow-up
 * rather than an unverified change.
 */
export async function withNativeCallTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raced = Promise.race([
    p,
    new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} did not settle within ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
  // The race stops listening once the timeout wins; swallow the loser's late
  // rejection so RN never logs an unhandled rejection for it.
  p.catch(() => undefined);
  return raced.finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
