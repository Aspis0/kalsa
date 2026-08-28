import { shouldStreamExperts } from "./expertStreaming";
import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { HIGH_RAM_N_CTX } from "./contextProfile";

/**
 * 8B-A1B numbers as measured. Resident side is the estimator (repack:true);
 * streamed side is the S23 peak RssAnon — never derived from repack:false.
 */
const STREAMING_RESIDENT = {
  bytes: 2_816_708_608,
  measuredAtContextTokens: 8192,
};

const MOE = {
  canStreamExperts: true,
  sizeBytes: 5_155_564_768,
  contextTokens: 8192,
  kvBytesPerToken: null,
  streamingResident: STREAMING_RESIDENT,
};

const MiB = 1024 * 1024;
const STREAMED_MIB = STREAMING_RESIDENT.bytes / MiB;

function residentMiB(sizeBytes: number, contextTokens: number): number {
  const resident = estimateModelNonEvictableMiB({
    sizeBytes,
    contextTokens,
    kvBytesPerToken: null,
    repack: true,
  });
  if (resident === null) throw new Error("valid MoE estimate missing");
  return resident;
}

describe("shouldStreamExperts", () => {
  it("refuses a dense model even when it would not fit resident", () => {
    expect(
      shouldStreamExperts({ ...MOE, canStreamExperts: undefined, availableMemoryBytes: 1 * MiB }),
    ).toBe(false);
  });

  it("streams only inside the measured band", () => {
    const resident = residentMiB(MOE.sizeBytes, MOE.contextTokens);
    expect(resident).toBeGreaterThan(STREAMED_MIB);

    const between = ((resident + STREAMED_MIB) / 2) * MiB;
    expect(shouldStreamExperts({ ...MOE, availableMemoryBytes: between })).toBe(true);
    expect(
      shouldStreamExperts({
        ...MOE,
        availableMemoryBytes: (STREAMED_MIB - 1) * MiB,
      }),
    ).toBe(false);
    expect(
      shouldStreamExperts({
        ...MOE,
        availableMemoryBytes: (resident + 1) * MiB,
      }),
    ).toBe(false);
  });

  it("keeps weights resident when the model fits either way", () => {
    expect(
      shouldStreamExperts({ ...MOE, availableMemoryBytes: 16_000 * MiB }),
    ).toBe(false);
  });

  it("does not stream when streaming would not save it either", () => {
    expect(
      shouldStreamExperts({ ...MOE, availableMemoryBytes: 64 * MiB }),
    ).toBe(false);
  });

  it("returns false when memory is unknown — absence is not permission", () => {
    expect(
      shouldStreamExperts({ ...MOE, availableMemoryBytes: null }),
    ).toBe(false);
    expect(
      shouldStreamExperts({ ...MOE, availableMemoryBytes: 0 }),
    ).toBe(false);
    expect(
      shouldStreamExperts({ ...MOE, availableMemoryBytes: Number.NaN }),
    ).toBe(false);
  });

  it("returns false when streamingResident is absent — no measurement, no stream", () => {
    const resident = residentMiB(MOE.sizeBytes, MOE.contextTokens);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;
    expect(
      shouldStreamExperts({
        canStreamExperts: true,
        sizeBytes: MOE.sizeBytes,
        contextTokens: MOE.contextTokens,
        kvBytesPerToken: null,
        availableMemoryBytes: between,
      }),
    ).toBe(false);
  });

  it("refuses when the measurement was taken at a different n_ctx", () => {
    const resident = residentMiB(MOE.sizeBytes, MOE.contextTokens);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;
    expect(
      shouldStreamExperts({
        ...MOE,
        contextTokens: HIGH_RAM_N_CTX,
        availableMemoryBytes: between,
      }),
    ).toBe(false);
  });

  it("returns false on input the estimator cannot price", () => {
    expect(
      shouldStreamExperts({ ...MOE, sizeBytes: 0, availableMemoryBytes: 4_000 * MiB }),
    ).toBe(false);
  });
});
