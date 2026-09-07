import { gateNonEvictableMiB, type ModelGateRAMModel } from "./modelGateRAM";
import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { resolveGateLoadPolicy } from "./loadPolicy";
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
