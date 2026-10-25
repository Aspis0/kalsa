import {
  gateCacheOptionFit,
  gateContextOptionFit,
  gateNonEvictableMiB,
  gateOptionFit,
  optionAvailability,
  type ModelGateRAMModel,
} from "./modelGateRAM";
import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { resolveGateLoadPolicy } from "./loadPolicy";
import { modelAtKvProfile } from "./kvQuantCost";
const MEASURED_BYTES = 2_816_708_608;
const MEASURED_CTX = 8192;
const MiB = 1024 * 1024;
const STREAMED_MIB = MEASURED_BYTES / MiB;

/**
 * Policy-priced resident estimate for the SAME mode the gate prices with.
 * Entries without loadPolicy fall out to the historic constants; curated
 * entries price their own load mode.
 */
function residentMiB(model: ModelGateRAMModel, contextTokens: number): number {
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
  const load = resolveGateLoadPolicy({ policy: model.loadPolicy });
  const resident = estimateModelNonEvictableMiB({
    sizeBytes: bundleBytes,
    contextTokens,
    kvBytesPerToken: model.kvBytesPerToken,
    mmap: load.mmap,
    repack: load.repack,
  });
  if (resident === null) throw new Error("valid MoE estimate missing");
  return resident;
}

describe("gateNonEvictableMiB", () => {
  it("prices at the resident estimate when there is no streaming measurement", () => {
    const model: ModelGateRAMModel = {
      sizeBytes: 5_155_564_768,
      kvBytesPerToken: null,
      canStreamExperts: true,
    };
    const resident = residentMiB(model, MEASURED_CTX);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;

    expect(
      gateNonEvictableMiB({
        model,
        contextTokens: MEASURED_CTX,
        availableMemoryBytes: between,
      }),
    ).toBe(resident);
  });

  it("returns null when the estimator cannot price the model", () => {
    const result = gateNonEvictableMiB({
      model: {
        sizeBytes: 0,
        kvBytesPerToken: null,
        canStreamExperts: true,
        streamingResident: {
          bytes: MEASURED_BYTES,
          measuredAtContextTokens: MEASURED_CTX,
        },
      },
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: 16_000 * MiB,
    });

    expect(result).toBeNull();
  });
});

describe("gateOptionFit", () => {
  // LFM2.5 2.6B as the catalog carries it: file 1520 MiB, KV 6656 B/token
  // (q8_0/q4_0), default load policy. Non-evictable at 8192 ctx ≈
  // 1360 repack + 249 compute + 52 KV = 1661 MiB.
  const lfm: ModelGateRAMModel = {
    sizeBytes: 1_593_894_944,
    kvBytesPerToken: 6656,
  };

  it("blocks an option whose estimate exceeds available memory", () => {
    const fit = gateOptionFit({
      model: lfm,
      contextTokens: 8192,
      availableMemoryBytes: 1500 * MiB,
    });
    expect(fit.status).toBe("does_not_fit");
    expect(optionAvailability(fit.status)).toBe("blocked");
    expect(fit.nonEvictableMiB).toBeGreaterThan(1500);
  });

  it("keeps a tight option selectable while flagging it", () => {
    const fit = gateOptionFit({
      model: lfm,
      contextTokens: 8192,
      availableMemoryBytes: 1700 * MiB,
    });
    expect(fit.status).toBe("tight");
    expect(optionAvailability(fit.status)).toBe("tight");
  });

  it("shows an option with no verdict when memory cannot be read", () => {
    const fit = gateOptionFit({
      model: lfm,
      contextTokens: 8192,
      availableMemoryBytes: null,
    });
    expect(fit.status).toBe("unknown");
    expect(optionAvailability(fit.status)).toBe("unknown");
  });

  it("charges the chosen cache profile: +200 MiB for q8_0 V at 100k", () => {
    const atStandard = gateOptionFit({
      model: lfm,
      contextTokens: 102400,
      availableMemoryBytes: null,
    });
    const atHigh = gateOptionFit({
      model: modelAtKvProfile(lfm, "q8_0", "q8_0"),
      contextTokens: 102400,
      availableMemoryBytes: null,
    });
    // KV only: 650 MiB at q8_0/q4_0, 850 at q8_0/q8_0.
    expect(
      Math.round((atHigh.nonEvictableMiB ?? 0) - (atStandard.nonEvictableMiB ?? 0)),
    ).toBe(200);
  });
});

describe("gateCacheOptionFit", () => {
  /** LFM2.5 2.6B plus the tuning fields the context resolver reads. */
  const lfm = {
    id: "lfm2.5-2.6b",
    sizeBytes: 1_593_894_944,
    engineCtx: 8192,
    contextLength: 131072,
    kvBytesPerToken: 6656,
  };
  const profile = {
    brand: "test",
    cpuCoreCount: 8,
    availableMemoryBytes: 2_000 * MiB,
    totalMemoryBytes: 8_000_000_000,
  };
  const shared = {
    model: lfm,
    profile,
    requestedContextTokens: 102400,
    availableMemoryBytes: profile.availableMemoryBytes,
  };

  it("resolves each cache quality at its own context, not at the other's", () => {
    const standard = gateCacheOptionFit({ ...shared, choice: { k: "q8_0", v: "q4_0" } });
    const high = gateCacheOptionFit({ ...shared, choice: { k: "q8_0", v: "q8_0" } });
    // Both are downgraded below the 100k ask, and the larger V cache holds less:
    // pricing High at the context Standard resolved to would hide that trade.
    expect(standard.contextTokens).toBeLessThan(102400);
    expect(high.contextTokens).toBeLessThan(standard.contextTokens);
  });

  it("prices the candidate's own quant, so High is not charged as Standard", () => {
    const standard = gateCacheOptionFit({ ...shared, choice: { k: "q8_0", v: "q4_0" } });
    const high = gateCacheOptionFit({ ...shared, choice: { k: "q8_0", v: "q8_0" } });
    expect(high.nonEvictableMiB).not.toBe(standard.nonEvictableMiB);
    expect(high.contextTokens).not.toBe(standard.contextTokens);
  });
});

describe("gateContextOptionFit", () => {
  /** LFM2.5 2.6B plus the tuning fields the context resolver reads. */
  const lfm = {
    id: "lfm2.5-2.6b",
    sizeBytes: 1_593_894_944,
    engineCtx: 8192,
    contextLength: 131072,
    kvBytesPerToken: 6656,
  };
  const roomy = {
    brand: "test",
    cpuCoreCount: 8,
    availableMemoryBytes: 2_000 * MiB,
    totalMemoryBytes: 8_000_000_000,
  };

  it("keeps a size the phone cannot hold SELECTABLE, and says what it loads instead", () => {
    // The owner requires 100k to be reachable on a capable phone and to
    // DEGRADE elsewhere. Blocking the row takes the request away; the budget
    // already knows how to honour it at a smaller context.
    const fit = gateContextOptionFit({
      model: lfm,
      requestedContextTokens: 102400,
      profile: roomy,
      availableMemoryBytes: roomy.availableMemoryBytes,
    });
    expect(fit.selectable).toBe(true);
    expect(fit.downgradesTo).toBe(fit.contextTokens);
    expect(fit.downgradesTo).toBeLessThan(102400);
  });

  it("does not report a downgrade when the size fits as asked", () => {
    const fit = gateContextOptionFit({
      model: lfm,
      requestedContextTokens: 8192,
      profile: roomy,
      availableMemoryBytes: roomy.availableMemoryBytes,
    });
    expect(fit.selectable).toBe(true);
    expect(fit.downgradesTo).toBeNull();
    expect(fit.contextTokens).toBe(8192);
  });

  it("blocks only when even the effective floor cannot load", () => {
    const tiny = { ...roomy, availableMemoryBytes: 300 * MiB };
    const fit = gateContextOptionFit({
      model: lfm,
      requestedContextTokens: 8192,
      profile: tiny,
      availableMemoryBytes: tiny.availableMemoryBytes,
    });
    expect(fit.status).toBe("does_not_fit");
    expect(fit.selectable).toBe(false);
    expect(fit.downgradesTo).toBeNull();
  });
});
