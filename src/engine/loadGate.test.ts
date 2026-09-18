import { gateModelLoad, refusalMessageKey, smallerModelExists } from "./loadGate";
import { estimateMemory } from "./memoryEstimate";

/** Qwen-class 4B: ~3.5 GB bundle, KV-heavy at catalog ctx. */
const BIG = {
  id: "qwen",
  sizeBytes: 3_500_000_000,
  engineCtx: 8192,
  kvBytesPerToken: 262_144,
  mmproj: null,
  loadPolicy: undefined,
};

/** LFM-class small model: ~1.5 GB, KV-light. */
const SMALL = {
  id: "lfm",
  sizeBytes: 1_500_000_000,
  engineCtx: 8192,
  kvBytesPerToken: 0,
  mmproj: null,
  loadPolicy: undefined,
};

const baseInput = (model: typeof BIG) => ({
  model,
  markerPresent: false,
  residentModelId: null as string | null,
  lostModelId: null as string | null,
  benchNoRepack: false,
  disposeResident: jest.fn(async () => true),
  getAvailableBytes: jest.fn(async () => 8_000_000_000 as number | null),
});

describe("gateModelLoad", () => {
  test("fit allow:false at startup → refuse with the existing model.tooLarge key", async () => {
    // The incident's 868 MB of MemAvailable against a 3.5 GB KV-heavy model.
    const input = baseInput(BIG);
    input.getAvailableBytes = jest.fn(async () => 868 * 1024 * 1024);
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(false);
    expect(verdict.reasonKey).toBe("model.tooLarge");
    expect(verdict.refusedBy).toBe("fit");
    expect(verdict.disposedResident).toBe(false);
    expect(input.disposeResident).not.toHaveBeenCalled();
  });

  test("resident big + selected small → dispose first, then fit, then allow", async () => {
    const calls: string[] = [];
    const input = baseInput(SMALL);
    input.residentModelId = "qwen";
    input.disposeResident = jest.fn(async () => {
      calls.push("dispose");
      return true;
    });
    input.getAvailableBytes = jest.fn(async () => {
      calls.push("available");
      return 8_000_000_000;
    });
    const verdict = await gateModelLoad(input);
    // Disposal of the different resident model happens BEFORE the evaluation.
    expect(calls).toEqual(["dispose", "available"]);
    expect(verdict.allow).toBe(true);
    expect(verdict.disposedResident).toBe(true);
  });

  test("same model resident → no dispose, no fit re-check, allow", async () => {
    const input = baseInput(BIG);
    input.residentModelId = "qwen";
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(true);
    expect(verdict.disposedResident).toBe(false);
    expect(input.disposeResident).not.toHaveBeenCalled();
    expect(input.getAvailableBytes).not.toHaveBeenCalled();
  });

  test("death marker refuses before the resident engine is touched", async () => {
    const input = baseInput(SMALL);
    input.markerPresent = true;
    input.residentModelId = "other";
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(false);
    // The marker knows only that a load did not finish — it carries NO fit
    // reason, so reasonKey stays null instead of borrowing model.tooLarge.
    expect(verdict.reasonKey).toBeNull();
    expect(verdict.refusedBy).toBe("marker");
    expect(input.disposeResident).not.toHaveBeenCalled();
    expect(input.getAvailableBytes).not.toHaveBeenCalled();
  });

  test("dispose timeout refuses the load instead of stacking contexts", async () => {
    const input = baseInput(SMALL);
    input.residentModelId = "qwen";
    input.disposeResident = jest.fn(async () => false);
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(false);
    // No fit reason exists here either; the message key comes from refusedBy.
    expect(verdict.reasonKey).toBeNull();
    expect(verdict.refusedBy).toBe("disposeTimeout");
    // Telemetry honesty: the bounded op never enqueued, so nothing was disposed.
    expect(verdict.disposedResident).toBe(false);
    expect(input.getAvailableBytes).not.toHaveBeenCalled();
  });

  test("tight refusal passes model.tightNow through to the message", async () => {
    const input = baseInput(SMALL);
    // Same load mode the gate resolves by default (repack on, mmap on,
    // ubatch 256): park MemAvailable just above the non-evictable estimate —
    // inside the 512 MiB headroom → tight, not does_not_fit.
    const estimate = estimateMemory({
      fileBytes: SMALL.sizeBytes,
      contextTokens: SMALL.engineCtx,
      kvBytesPerToken: SMALL.kvBytesPerToken ?? 0,
      ubatch: 256,
      repack: true,
      mmap: true,
    });
    input.getAvailableBytes = jest.fn(
      async () => (estimate.nonEvictableMiB + 1) * 1024 * 1024,
    );
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(false);
    expect(verdict.refusedBy).toBe("fit");
    expect(verdict.reasonKey).toBe("model.tightNow");
    if (verdict.allow) throw new Error("expected a refusal");
    // The message carries the decider's reason verbatim — never re-derived to
    // model.tooLarge, whatever the availability facts around it are.
    expect(refusalMessageKey(verdict, true, true)).toBe("model.tightNow");
    expect(refusalMessageKey(verdict, false, false)).toBe("model.tightNow");
  });

  test("lost engine recovery of the same model is allowed through", async () => {
    const input = baseInput(BIG);
    input.lostModelId = "qwen";
    input.getAvailableBytes = jest.fn(async () => 868 * 1024 * 1024);
    const verdict = await gateModelLoad(input);
    expect(verdict.allow).toBe(true);
  });
});

describe("refusalMessageKey (claim only the cause the code knows)", () => {
  const fitVerdict = (reasonKey: "model.tooLarge" | "model.tightNow") => ({
    allow: false as const,
    refusedBy: "fit" as const,
    reasonKey,
    disposedResident: false,
  });
  const markerVerdict = {
    allow: false as const,
    refusedBy: "marker" as const,
    reasonKey: null,
    disposedResident: false,
  };
  const disposeVerdict = {
    allow: false as const,
    refusedBy: "disposeTimeout" as const,
    reasonKey: null,
    disposedResident: false,
  };

  test("fit refusals pass the decider's reason through untouched", () => {
    expect(refusalMessageKey(fitVerdict("model.tightNow"), true, true)).toBe(
      "model.tightNow",
    );
    expect(refusalMessageKey(fitVerdict("model.tightNow"), false, false)).toBe(
      "model.tightNow",
    );
    expect(refusalMessageKey(fitVerdict("model.tooLarge"), false, false)).toBe(
      "model.tooLarge",
    );
  });

  test("marker refusal with another model on disk → set-aside key", () => {
    expect(refusalMessageKey(markerVerdict, true, true)).toBe("model.loadSetAside");
  });

  test("marker refusal, nothing else on disk, smaller model exists → download-smaller", () => {
    expect(refusalMessageKey(markerVerdict, false, true)).toBe(
      "model.loadSetAsideDownloadSmaller",
    );
  });

  test("marker refusal, refused model already the smallest → retry is the honest advice", () => {
    expect(refusalMessageKey(markerVerdict, false, false)).toBe(
      "model.loadSetAsideRetry",
    );
  });

  test("dispose timeout keeps the dispose key", () => {
    expect(refusalMessageKey(disposeVerdict, false, false)).toBe(
      "errors.engineDisposeTimeout",
    );
  });

  test("smallerModelExists compares bundle sizes, not identity", () => {
    expect(smallerModelExists([1_500_000_000, 3_500_000_000], 1_593_894_944)).toBe(true);
    expect(smallerModelExists([3_500_000_000], 1_593_894_944)).toBe(false);
    expect(smallerModelExists([], 1_593_894_944)).toBe(false);
  });
});
