import { gateModelLoad, refusalMessageKey } from "./loadGate";

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
    expect(verdict.reasonKey).toBe("model.tooLarge");
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
    expect(verdict.reasonKey).toBe("errors.engineDisposeTimeout");
    expect(verdict.refusedBy).toBe("disposeTimeout");
    // Telemetry honesty: the bounded op never enqueued, so nothing was disposed.
    expect(verdict.disposedResident).toBe(false);
    expect(input.getAvailableBytes).not.toHaveBeenCalled();
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
  test("marker refusal with another model on disk → set-aside key", () => {
    expect(refusalMessageKey("marker", true)).toBe("model.loadSetAside");
  });

  test("marker refusal with nothing else on disk → download-smaller key", () => {
    expect(refusalMessageKey("marker", false)).toBe(
      "model.loadSetAsideDownloadSmaller",
    );
  });

  test("fit refusal keeps model.tooLarge — the case where it is true", () => {
    expect(refusalMessageKey("fit", true)).toBe("model.tooLarge");
    expect(refusalMessageKey("fit", false)).toBe("model.tooLarge");
  });

  test("dispose timeout keeps the dispose key", () => {
    expect(refusalMessageKey("disposeTimeout", false)).toBe(
      "errors.engineDisposeTimeout",
    );
  });
});
