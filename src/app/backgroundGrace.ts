/** Schedules one deferred background action until foreground or cancellation. */
export function createBackgroundGrace<H>({
  graceMs,
  setTimeout: schedule,
  clearTimeout: cancelTimer,
}: {
  graceMs: number;
  setTimeout: (run: () => void, delayMs: number) => H;
  clearTimeout: (handle: H) => void;
}) {
  let pending: H | null = null;

  const cancel = (): boolean => {
    if (pending === null) return false;
    cancelTimer(pending);
    pending = null;
    return true;
  };

  return {
    onBackground(run: () => void): void {
      if (pending !== null) return;
      pending = schedule(() => {
        pending = null;
        run();
      }, graceMs);
    },
    onForeground(): boolean {
      return cancel();
    },
    isPending(): boolean {
      return pending !== null;
    },
    cancel,
  };
}
