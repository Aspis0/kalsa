/**
 * Cancellation contract for one memory-extraction job.
 *
 * Regression encoded here (audit 2026-09-10, AppShell memory extract wiring):
 * the AppShell listener on the TURN signal released the save gate but never
 * aborted the signal `extractMemory` actually listens on. So after the job had
 * passed its post-gate check and entered the native completion, `stop` /
 * `clearChat` (both abort the turn signal) left that completion running.
 *
 * The job shape below mirrors AppShell: gate -> post-gate guards -> native
 * completion; the "old wiring" control reproduces the released-gate-only wiring.
 */

import { createExtractAbort } from "./extractAbort";

/** Resolves only when its signal aborts — models stopCompletion. */
function nativeCompletion(signal: AbortSignal): Promise<{ stopReason: string }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ stopReason: "aborted_by_send" });
      return;
    }
    signal.addEventListener(
      "abort",
      () => resolve({ stopReason: "aborted_by_send" }),
      { once: true },
    );
    // Deliberately never settles on its own: a passing test must have been
    // driven by the abort reaching this signal.
  });
}

describe("createExtractAbort", () => {
  test("no cancellation leaves the native signal live", () => {
    const handle = createExtractAbort({ outer: new AbortController().signal, onCancel: jest.fn() });
    expect(handle.cancelled()).toBe(false);
    expect(handle.signal.aborted).toBe(false);
  });

  test("cancel() aborts the native signal and runs onCancel once", () => {
    const onCancel = jest.fn();
    const handle = createExtractAbort({ outer: new AbortController().signal, onCancel });

    handle.cancel();
    expect(handle.cancelled()).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);

    handle.cancel();
    handle.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("REGRESSION: aborting the turn signal (stop / clearChat) reaches the native signal", () => {
    const outer = new AbortController();
    const onCancel = jest.fn();
    const handle = createExtractAbort({ outer: outer.signal, onCancel });

    expect(handle.signal.aborted).toBe(false);
    outer.abort();

    expect(handle.cancelled()).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("CONTROL: the released-gate-only wiring never aborts the native signal", () => {
    // Pre-fix AppShell: onAbortRelease released the save gate and stopped there.
    const outer = new AbortController();
    const nativeController = new AbortController(); // extractMemory's signal
    let gateReleased = 0;
    const onAbortRelease = () => {
      gateReleased += 1;
    };
    outer.signal.addEventListener("abort", onAbortRelease, { once: true });

    outer.abort();

    expect(gateReleased).toBe(1); // the gate DID open
    expect(nativeController.signal.aborted).toBe(false); // and nothing cancelled
  });

  test("an already-aborted outer signal cancels at creation", () => {
    const outer = new AbortController();
    outer.abort();
    const onCancel = jest.fn();

    const handle = createExtractAbort({ outer: outer.signal, onCancel });

    expect(handle.cancelled()).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("no outer signal: only an explicit cancel() fires", () => {
    const onCancel = jest.fn();
    const handle = createExtractAbort({ onCancel });
    expect(handle.signal.aborted).toBe(false);
    handle.cancel();
    expect(handle.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("detach() stops forwarding after the job settled", () => {
    const outer = new AbortController();
    const onCancel = jest.fn();
    const handle = createExtractAbort({ outer: outer.signal, onCancel });

    handle.detach();
    outer.abort();

    expect(handle.cancelled()).toBe(false);
    expect(handle.signal.aborted).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("onCancel throwing still aborts the native signal", () => {
    const handle = createExtractAbort({
      outer: new AbortController().signal,
      onCancel: () => {
        throw new Error("gate release failed");
      },
    });

    expect(() => handle.cancel()).toThrow("gate release failed");
    expect(handle.signal.aborted).toBe(true);
    expect(handle.cancelled()).toBe(true);
  });
});

describe("extract job contract (gate + native completion)", () => {
  /** Mirrors AppShell: gate -> post-gate cancel check -> native -> result. */
  async function runExtractJob(
    handle: ReturnType<typeof createExtractAbort>,
    gate: Promise<void>,
    native: (signal: AbortSignal) => Promise<{ stopReason: string }>,
  ): Promise<{ stopReason: string; nativeStarted: boolean }> {
    let nativeStarted = false;
    await gate;
    if (handle.cancelled()) return { stopReason: "aborted_by_send", nativeStarted };
    nativeStarted = true;
    const result = await native(handle.signal);
    return { stopReason: result.stopReason, nativeStarted };
  }

  test("stop during the save gate: never starts native work, reports cancelled", async () => {
    const outer = new AbortController();
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const handle = createExtractAbort({ outer: outer.signal, onCancel: releaseGate });
    const native = jest.fn(nativeCompletion);

    const job = runExtractJob(handle, gate, native);
    outer.abort(); // stop / clearChat while the turn-end save is still in flight
    await gate;

    await expect(job).resolves.toEqual({ stopReason: "aborted_by_send", nativeStarted: false });
    expect(native).not.toHaveBeenCalled();
  });

  test("stop during the native completion: aborts mid-flight, reports cancelled", async () => {
    const outer = new AbortController();
    const handle = createExtractAbort({ outer: outer.signal, onCancel: () => undefined });
    let markedStarted: () => void = () => undefined;
    const nativeIsRunning = new Promise<void>((resolve) => {
      markedStarted = resolve;
    });
    const native = jest.fn((signal: AbortSignal) => {
      markedStarted();
      return nativeCompletion(signal);
    });

    const job = runExtractJob(handle, Promise.resolve(), native);
    await nativeIsRunning; // the completion is in flight now
    expect(handle.signal.aborted).toBe(false);

    outer.abort(); // stop / clearChat, after the post-gate check passed

    await expect(job).resolves.toEqual({ stopReason: "aborted_by_send", nativeStarted: true });
    expect(native).toHaveBeenCalledTimes(1);
    expect(handle.signal.aborted).toBe(true);
  });

  test("next send cancels immediately without waiting for the gate", async () => {
    const outer = new AbortController();
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const handle = createExtractAbort({ outer: outer.signal, onCancel: releaseGate });

    handle.cancel(); // memoryExtractCancelRef.current?.() in AppShell
    await gate;

    expect(handle.cancelled()).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(outer.signal.aborted).toBe(false); // the turn itself is not aborted
  });

  test("no cancellation: native completion runs to its own result", async () => {
    const outer = new AbortController();
    const handle = createExtractAbort({ outer: outer.signal, onCancel: () => undefined });
    const native = jest.fn(async () => ({ stopReason: "done" }));

    await expect(runExtractJob(handle, Promise.resolve(), native)).resolves.toEqual({
      stopReason: "done",
      nativeStarted: true,
    });
  });
});
