/**
 * The turn-end memory extract holds the engine: a dispose racing it can kill
 * the completion mid-flight (`LlamaService.dispose` → `stopCompletion`, and
 * the extract's abort reaches it only through the turn signal). Both switch
 * paths wait for it HERE — the local model switch and the remote transition —
 * so there is one wait, not two, bounded so a stranded job cannot hang a
 * switch forever.
 *
 * The ref is cleared only while it still holds the promise this call waited
 * on: a newer extract armed during the wait owns the ref now, and the next
 * waiter must wait for THAT one (the arming side guards its own clear the
 * same way, `engineTurnMemory.ts`).
 */
export const MEMORY_EXTRACT_WAIT_MS = 3000;

export async function waitForMemoryExtract(
  ref: { current: Promise<void> | null },
): Promise<void> {
  const running = ref.current;
  if (running === null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      running,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, MEMORY_EXTRACT_WAIT_MS);
      }),
    ]);
  } catch {
    // The extract's own failure is not the switch's.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (ref.current === running) ref.current = null;
  }
}
