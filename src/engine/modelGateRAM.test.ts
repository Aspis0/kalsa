import { gateNonEvictableMiB, type ModelGateRAMModel } from "./modelGateRAM";
import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { HIGH_RAM_N_CTX } from "./contextProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";

/**
 * Pins the real catalog entry. A call site that stops plumbing
 * streamingResident (registry field gone, or helper ignoring it) prices at
 * the repack estimate and fails inside the measured band.
 */
const LFM8B_ID = "lfm2.5-8b-a1b";
const MEASURED_BYTES = 2_816_708_608;
const MEASURED_CTX = 8192;
const MiB = 1024 * 1024;
const STREAMED_MIB = MEASURED_BYTES / MiB;

function lfm8b() {
  const entry = MODEL_REGISTRY.find((m) => m.id === LFM8B_ID);
  if (entry == null) throw new Error(`${LFM8B_ID} missing from MODEL_REGISTRY`);
  return entry;
}

function residentMiB(model: ModelGateRAMModel, contextTokens: number): number {
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
  const resident = estimateModelNonEvictableMiB({
    sizeBytes: bundleBytes,
    contextTokens,
    kvBytesPerToken: model.kvBytesPerToken,
    repack: true,
  });
  if (resident === null) throw new Error("valid MoE estimate missing");
  return resident;
}

describe("gateNonEvictableMiB", () => {
  it("pins lfm2.5-8b-a1b at the streamed measurement inside the real band", () => {
    const model = lfm8b();
    expect(model.streamingResident).toEqual({
      bytes: MEASURED_BYTES,
      measuredAtContextTokens: MEASURED_CTX,
    });

    const resident = residentMiB(model, MEASURED_CTX);
    expect(resident).toBeGreaterThan(STREAMED_MIB);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;

    const inside = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: between,
    });
    expect(inside).toBe(STREAMED_MIB);
    expect(inside).not.toBe(resident);

    const below = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: (STREAMED_MIB - 1) * MiB,
    });
    expect(below).toBe(resident);

    const above = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: (resident + 1) * MiB,
    });
    expect(above).toBe(resident);
  });

  it("prices at the repack estimate when n_ctx does not match the measurement", () => {
    const model = lfm8b();
    const resident16k = residentMiB(model, HIGH_RAM_N_CTX);
    const resident8k = residentMiB(model, MEASURED_CTX);
    const between8k = ((resident8k + STREAMED_MIB) / 2) * MiB;

    const result = gateNonEvictableMiB({
      model,
      contextTokens: HIGH_RAM_N_CTX,
      availableMemoryBytes: between8k,
    });
    expect(result).toBe(resident16k);
    expect(result).not.toBe(STREAMED_MIB);
  });

  it("prices kexp at the repack estimate — flag without a measurement is not permission", () => {
    const kexp = MODEL_REGISTRY.find((m) => m.id === "lfm2.5-8b-a1b-kexp");
    if (kexp == null) throw new Error("kexp missing from MODEL_REGISTRY");
    expect(kexp.canStreamExperts).toBe(true);
    expect(kexp.streamingResident).toBeUndefined();

    const resident = residentMiB(kexp, kexp.engineCtx);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;
    expect(
      gateNonEvictableMiB({
        model: kexp,
        contextTokens: kexp.engineCtx,
        availableMemoryBytes: between,
      }),
    ).toBe(resident);
  });

  it("prices at the repack estimate when there is no streaming measurement", () => {
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
