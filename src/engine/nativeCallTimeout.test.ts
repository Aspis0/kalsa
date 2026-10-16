/**
 * withNativeCallTimeout: the bound must be able to CANCEL, not only to stop
 * waiting. A tool still sitting on something cancellable — a search prompt —
 * would otherwise resume after the caller has already reported a failure.
 */
import { withNativeCallTimeout } from "./nativeCallTimeout";

describe("withNativeCallTimeout", () => {
  it("returns the value when the call settles in time", async () => {
    await expect(withNativeCallTimeout(Promise.resolve("ok"), 1000, "t")).resolves.toBe("ok");
  });

  it("rejects with the label when the bound fires", async () => {
    jest.useFakeTimers();
    try {
      const never = new Promise<string>(() => undefined);
      const raced = withNativeCallTimeout(never, 100, "executeTool(web_search)");
      const assertion = expect(raced).rejects.toThrow(
        "executeTool(web_search) did not settle within 100ms",
      );
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("aborts the caller's signal when the bound fires", async () => {
    jest.useFakeTimers();
    try {
      // The shape the tool loop uses: a controller combined with the turn's
      // signal, aborted on timeout so a pending search stops waiting.
      const controller = new AbortController();
      let sawAbort = false;
      const pending = new Promise<string>((resolve) => {
        controller.signal.addEventListener("abort", () => {
          sawAbort = true;
          resolve("cancelled");
        });
      });
      const raced = withNativeCallTimeout(pending, 100, "executeTool", () =>
        controller.abort(),
      );
      // Whichever wins the race is beside the point: the abort runs FIRST, so
      // the cancelled work normally settles before the rejection. What must
      // hold is that the call stops waiting AND the signal was aborted.
      await jest.advanceTimersByTimeAsync(100);
      await raced.catch(() => undefined);
      expect(sawAbort).toBe(true);
      expect(controller.signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports the timeout, not the abort, when the abort itself throws", async () => {
    jest.useFakeTimers();
    try {
      const assertion = expect(
        withNativeCallTimeout(new Promise<string>(() => undefined), 100, "executeTool", () => {
          throw new Error("abort exploded");
        }),
      ).rejects.toThrow("executeTool did not settle within 100ms");
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not abort when the call settles first", async () => {
    const onTimeout = jest.fn();
    await withNativeCallTimeout(Promise.resolve(1), 50_000, "t", onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});