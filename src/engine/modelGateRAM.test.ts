import { gateNonEvictableMiB, gateOptionFit, optionAvailability, type ModelGateRAMModel } from "./modelGateRAM";
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
