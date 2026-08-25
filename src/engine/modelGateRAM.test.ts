import { gateNonEvictableMiB, type ModelGateRAMModel } from "./modelGateRAM";
import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { resolveGateLoadPolicy } from "./loadPolicy";
import { HIGH_RAM_N_CTX } from "./contextProfile";
import { MODEL_REGISTRY } from "./ModelRegistry";

/**
 * Pins the real catalog entry. A call site that stops plumbing
 * streamingResident (registry field gone, or helper ignoring it) prices at
 * the resident estimate and fails inside the measured band.
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

/** Repack-priced resident estimate: what the norepack-lever mode weighs. */
function residentMiBWithRepack(
  model: ModelGateRAMModel,
  contextTokens: number,
): number {
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
  const resident = estimateModelNonEvictableMiB({
    sizeBytes: bundleBytes,
    contextTokens,
    kvBytesPerToken: model.kvBytesPerToken,
    mmap: true,
    repack: true,
  });
  if (resident === null) throw new Error("valid MoE estimate missing");
  return resident;
}

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
  it("pins lfm2.5-8b-a1b at the streamed measurement when streaming is the loaded config", () => {
    const model = lfm8b();
    expect(model.streamingResident).toEqual({
      bytes: MEASURED_BYTES,
      measuredAtContextTokens: MEASURED_CTX,
    });

    // The "0" arm of kalsa.bench.norepack prices the resident side WITH the
    // repack term (a forced repack-on load), making resident unaffordable
    // inside the band — the configuration where streaming is what makes the
    // model loadable. There the measured constant must win.
    const residentWithRepack = residentMiBWithRepack(model, MEASURED_CTX);
    expect(residentWithRepack).toBeGreaterThan(STREAMED_MIB);
    const between = ((residentWithRepack + STREAMED_MIB) / 2) * MiB;

    const inside = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: between,
      benchNoRepack: false,
    });
    expect(inside).toBe(STREAMED_MIB);
    expect(inside).not.toBe(residentWithRepack);

    const below = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: (STREAMED_MIB - 1) * MiB,
      benchNoRepack: false,
    });
    expect(below).toBe(residentWithRepack);
  });

  it("policy repack:false prices resident file-mapped and does not stream in the band", () => {
    // With the model's own policy (mmap on, repack off) a resident load keeps
    // the weights on the page cache: nearly nothing anonymous, so it fits long
    // before the streamed footprint would. Resident-mapped loading is the
    // point of the policy — the measured streamed figure must NOT win here.
    const model = lfm8b();
    const resident = residentMiB(model, MEASURED_CTX);
    expect(resident).toBeLessThan(STREAMED_MIB);
    const between = ((resident + STREAMED_MIB) / 2) * MiB;

    const result = gateNonEvictableMiB({
      model,
      contextTokens: MEASURED_CTX,
      availableMemoryBytes: between,
    });
    expect(result).toBe(resident);
    expect(result).not.toBe(STREAMED_MIB);
  });

  it("prices at the resident estimate when n_ctx does not match the measurement", () => {
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

  it("prices kexp at the policy-priced resident estimate — flag without a measurement is not permission", () => {
    const kexp = MODEL_REGISTRY.find((m) => m.id === "lfm2.5-8b-a1b-kexp");
    if (kexp == null) throw new Error("kexp missing from MODEL_REGISTRY");
    expect(kexp.canStreamExperts).toBe(true);
    expect(kexp.streamingResident).toBeUndefined();

    // mmap off → the WEIGHTS are read anonymous and count non-evictable, ON
    // TOP of the repack copy. The old constant-priced figure hid them; this
    // is the honest §7.45-class price of the kexp load mode.
    const resident = residentMiB(kexp, kexp.engineCtx);
    const evictableWeightsFloor = estimateModelNonEvictableMiB({
      sizeBytes: kexp.sizeBytes,
      contextTokens: kexp.engineCtx,
      kvBytesPerToken: kexp.kvBytesPerToken,
      mmap: true,
      repack: false,
    });
    expect(evictableWeightsFloor).not.toBeNull();
    expect(resident).toBeGreaterThan(evictableWeightsFloor!);

    const between = ((resident + STREAMED_MIB) / 2) * MiB;
    expect(
      gateNonEvictableMiB({
        model: kexp,
        contextTokens: kexp.engineCtx,
        availableMemoryBytes: between,
      }),
    ).toBe(resident);
  });

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
