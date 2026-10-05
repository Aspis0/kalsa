/**
 * The shared extraction wait (`modelSwitch.ts` and `remoteModelTransition.ts`
 * both call it): it resolves when the extract does, is bounded so a stranded
 * job cannot hang a switch forever, and never clears a NEWER extract's ref.
 */
import { MEMORY_EXTRACT_WAIT_MS, waitForMemoryExtract } from "./memoryExtractWait";

describe("the extraction wait", () => {
  test("an idle ref returns at once", async () => {
    await expect(waitForMemoryExtract({ current: null })).resolves.toBeUndefined();
  });

  test("it resolves with the extract and clears the ref it waited on", async () => {
    let release: (() => void) | undefined;
    const ref: { current: Promise<void> | null } = {
      current: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const wait = waitForMemoryExtract(ref);
    release?.();
    await wait;
    expect(ref.current).toBeNull();
  });

  test("a failed extract is not the switch's failure", async () => {
    const ref: { current: Promise<void> | null } = { current: Promise.reject(new Error("extract")) };
    await expect(waitForMemoryExtract(ref)).resolves.toBeUndefined();
    expect(ref.current).toBeNull();
  });

  test("a stranded extract is abandoned after the bound, without hanging the switch", async () => {
    jest.useFakeTimers();
    try {
      const ref: { current: Promise<void> | null } = { current: new Promise<void>(() => undefined) };
      const wait = waitForMemoryExtract(ref);
      await jest.advanceTimersByTimeAsync(MEMORY_EXTRACT_WAIT_MS);
      await expect(wait).resolves.toBeUndefined();
      expect(ref.current).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a newer extract armed during the wait keeps the ref", async () => {
    const ref: { current: Promise<void> | null } = { current: null };
    let release: (() => void) | undefined;
    ref.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wait = waitForMemoryExtract(ref);
    const newer = Promise.resolve();
    ref.current = newer;
    release?.();
    await wait;
    expect(ref.current).toBe(newer);
  });
});
