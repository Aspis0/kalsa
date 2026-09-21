import {
  gateModelLoad,
  loadGateFitModel,
  refusalMessageKey,
  smallerModelExists,
} from "./loadGate";
import { estimateMemory } from "./memoryEstimate";
import { MODEL_REGISTRY, type ModelInfo } from "./ModelRegistry";
import { resolveLoadPolicy } from "./loadPolicy";
import { gateNonEvictableMiB } from "./modelGateRAM";

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

/** LFM2.5 2.6B as the catalog carries it, plus the tuning fields. */
const FIT_MODEL = {
  id: "lfm2.5-2.6b",
  sizeBytes: 1_593_894_944,
  engineCtx: 8192,
  contextLength: 131072,
  hybrid: true,
  kvCache: { k: "q8_0", v: "q4_0" } as const,
  kvBytesPerToken: 6656,
  mmproj: null,
  loadPolicy: undefined,
};

const fitDevice = (availableMiB: number, totalBytes = 12_000_000_000) => ({
  brand: "test",
  cpuCoreCount: 8,
  availableMemoryBytes: availableMiB * 1024 * 1024,
  totalMemoryBytes: totalBytes,
});

describe("loadGateFitModel", () => {
  test("charges the context the budget will load, not the request nor the catalog", () => {
    // The 100k request cannot fit at 1.7 GiB, so the gate must charge what init
    // will actually run with. Charging 102400 refuses a graceful downgrade;
    // charging the catalog 8192 ignores the user's choice on the load path.
    const fit = loadGateFitModel({
      model: FIT_MODEL,
      profile: fitDevice(1700),
      requestedContextTokens: 102400,
    });
    expect(fit.engineCtx).toBeGreaterThanOrEqual(8192);
    expect(fit.engineCtx).toBeLessThan(102400);
  });

  test("keeps the high-RAM hybrid upgrade when nobody asked for a size", () => {
    // 8 GB total ≥ the 7.5 GB gate: resolveContextProfile upgrades 8192 → 16384,
    // and the gate must charge that upgraded context, not the catalog default.
    const fit = loadGateFitModel({
      model: FIT_MODEL,
      profile: fitDevice(6000, 8_000_000_000),
    });
    expect(fit.engineCtx).toBe(16384);
  });

  test("prices KV at the chosen cache profile, not the catalog's", () => {
    const shipped = loadGateFitModel({
      model: FIT_MODEL,
      profile: fitDevice(6000, 8_000_000_000),
    });
    const high = loadGateFitModel({
      model: FIT_MODEL,
      profile: fitDevice(6000, 8_000_000_000),
      kvCache: { k: "q8_0", v: "q8_0" },
    });
    expect(shipped.kvBytesPerToken).toBe(6656);
    expect(high.kvBytesPerToken).toBe(8704);
  });
});

describe("loadGateFitModel — expert streaming", () => {
  const MiB = 1024 * 1024;

  test("carries the streaming capability, so a streamable MoE is priced streamed", () => {
    // A model that fits ONLY streamed: 5 GB of weights, a 1000 MiB measured
    // RssAnon, 3000 MiB free. Dropping canStreamExperts here prices the full
    // resident footprint and refuses a load the gate would have allowed.
    const streamable = {
      id: "dev-moe",
      sizeBytes: 5_000_000_000,
      engineCtx: 8192,
      contextLength: 131072,
      kvBytesPerToken: 6656,
      mmproj: null,
      loadPolicy: undefined,
      canStreamExperts: true,
      streamingResident: { bytes: 1_000 * MiB, measuredAtContextTokens: 8192 },
    };
    const fit = loadGateFitModel({
      model: streamable,
      profile: {
        brand: "test",
        cpuCoreCount: 8,
        availableMemoryBytes: 3_000 * MiB,
        totalMemoryBytes: 8_000_000_000,
      },
      requestedContextTokens: 8192,
    });
    expect(fit.canStreamExperts).toBe(true);
    expect(fit.streamingResident).toEqual({
      bytes: 1_000 * MiB,
      measuredAtContextTokens: 8192,
    });
    // The gate charges the MEASUREMENT when the capability survives: without
    // the fields this is the resident estimate (4.5 GiB), which does not fit.
    // Same shape AppShell passes: the fit model's size-only mmproj view is
    // replaced by the catalog's spec.
    expect(
      gateNonEvictableMiB({
        model: { ...fit, mmproj: undefined },
        contextTokens: 8192,
        availableMemoryBytes: 3_000 * MiB,
      }),
    ).toBe(1_000);
  });
});

/**
 * End-to-end guard: the load path must consume ModelInfo.loadPolicy, not only
 * the pure resolver. gateModelLoad → decidePreSendFit is the deepest
 * node-loadable part of that path (LlamaService.initEngine pulls llama.rn and
 * AsyncStorage, so it cannot run here), and it is exactly where the wiring can
 * silently drop the policy while loadPolicy.test.ts stays green. The real qwen
 * registry entry is used, so a registry edit or a gate change shows up as a
 * failure here.
 */
describe("gateModelLoad — consumes ModelInfo.loadPolicy (qwen3.5-4b)", () => {
  const qwenEntry = MODEL_REGISTRY.find((entry) => entry.id === "qwen3.5-4b");
  if (!qwenEntry) throw new Error("qwen3.5-4b missing from MODEL_REGISTRY");
  const qwen: ModelInfo = qwenEntry;

  // Bundle = main GGUF + mmproj, exactly what the gate prices.
  const bundleBytes = qwen.sizeBytes + (qwen.mmproj?.sizeBytes ?? 0);
  // Park MemAvailable just above the repack-ON non-evictable footprint. With
  // the entry's repack:false that budget leaves ample headroom; with the default
  // it is the tight-refuse regime. The margin is expressed in the estimator's
  // own terms, so the test carries no invented device constant.
  const repackOn = estimateMemory({
    fileBytes: bundleBytes,
    contextTokens: qwen.engineCtx,
    kvBytesPerToken: qwen.kvBytesPerToken ?? 0,
    ubatch: 256,
    repack: true,
    mmap: true,
  });
  const budgetBytes = (repackOn.nonEvictableMiB + 1) * 1024 * 1024;

  const loadInput = (model: ModelInfo, benchNoRepack?: boolean) => ({
    model,
    markerPresent: false,
    residentModelId: null as string | null,
    lostModelId: null as string | null,
    benchNoRepack,
    disposeResident: jest.fn(async () => true),
    getAvailableBytes: jest.fn(async () => budgetBytes),
  });

  test("qwen entry (repack:false) allows where the default policy refuses", async () => {
    const withEntry = await gateModelLoad(loadInput(qwen));
    expect(withEntry.allow).toBe(true);

    // Same bytes, entry policy stripped → default repack:true → tightNow. This
    // assertion fails if gateModelLoad stops forwarding model.loadPolicy into
    // decidePreSendFit.
    const defaultPolicy = await gateModelLoad(
      loadInput({ ...qwen, loadPolicy: undefined }),
    );
    expect(defaultPolicy.allow).toBe(false);
    expect(defaultPolicy.refusedBy).toBe("fit");
    expect(defaultPolicy.reasonKey).toBe("model.tightNow");
  });

  test("loadGateFitModel forwards the entry's policy to the gate", () => {
    // Production (AppShell) builds the gate model with loadGateFitModel before
    // handing it to gateModelLoad; a dropped field there is the same regression
    // class, so assert the hop directly.
    const fit = loadGateFitModel({
      model: qwen,
      profile: {
        brand: "test",
        cpuCoreCount: 8,
        availableMemoryBytes: budgetBytes,
        totalMemoryBytes: 12_000_000_000,
      },
      requestedContextTokens: qwen.engineCtx,
    });
    expect(fit.loadPolicy).toEqual({ mmap: true, repack: false });
  });

  test("kalsa.bench.norepack=0 re-arms repack on the entry → refusal returns", async () => {
    // The bench lever overrides the registry policy on a non-streamed load, so
    // the repack-priced refusal comes back even though the entry disables it.
    const verdict = await gateModelLoad(loadInput(qwen, false));
    expect(verdict.allow).toBe(false);
    expect(verdict.refusedBy).toBe("fit");
    expect(verdict.reasonKey).toBe("model.tightNow");
  });

  test("streaming still wins over the entry and the bench lever", () => {
    // The gate prices the resident, non-streamed load; the load-time streaming
    // force lives in the resolver. Assert it against the real entry so the
    // qwen-shaped policy cannot silently lose the physical override.
    expect(
      resolveLoadPolicy({
        policy: qwen.loadPolicy,
        streamExperts: true,
        benchNoRepack: false,
        benchUseMmap: false,
      }),
    ).toEqual({ useMmap: true, noExtraBufts: true });
  });
});
