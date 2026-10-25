/** Schema tests for the load / engine-variant / prewarm / pairing / road tags. */
import { formatRecord, setLogModelIds } from "../schema";

function record(tag: string, json: string): Record<string, unknown> | null {
  const line = formatRecord(tag, JSON.parse(json));
  return line === null ? null : (JSON.parse(line.replace(/^[^ ]+ /, "")) as Record<string, unknown>);
}

beforeEach(() => {
  setLogModelIds(["qwen3.5-4b", "lfm2.5-2.6b"]);
});

describe("KALSA_LOAD (engineLoad.ts:160-167)", () => {
  it("keeps a catalog model id", () => {
    expect(
      record(
        "KALSA_LOAD",
        '{"phase":"fitGate","modelId":"qwen3.5-4b","refusedBy":"fit","reasonKey":"model.tooLarge","disposedResident":false,"source":"ensure"}',
      ),
    ).toEqual({
      phase: "fitGate",
      modelId: "qwen3.5-4b",
      refusedBy: "fit",
      reasonKey: "model.tooLarge",
      disposedResident: false,
      source: "ensure",
    });
  });

  it("keeps a null reasonKey (marker/disposeTimeout refusals)", () => {
    const out = record(
      "KALSA_LOAD",
      '{"phase":"fitGate","modelId":"lfm2.5-2.6b","refusedBy":"marker","reasonKey":null,"disposedResident":true,"source":"ensure"}',
    );
    expect(out).toEqual({
      phase: "fitGate",
      modelId: "lfm2.5-2.6b",
      refusedBy: "marker",
      reasonKey: null,
      disposedResident: true,
      source: "ensure",
    });
  });

  it("drops a model id that is not in the catalog", () => {
    const out = record(
      "KALSA_LOAD",
      '{"phase":"fitGate","modelId":"user-uploaded-secret.gguf","refusedBy":"fit","reasonKey":null,"disposedResident":false,"source":"ensure"}',
    );
    expect(out?.modelId).toBeUndefined();
    expect(out?.refusedBy).toBe("fit");
  });
});

describe("KALSA_GPU_FALLBACK (LlamaService.ts:2717-2720)", () => {
  it("keeps the layers and the flash-attention mode", () => {
    expect(
      record("KALSA_GPU_FALLBACK", '{"requestedGpuLayers":99,"flashAttn":"auto"}'),
    ).toEqual({ requestedGpuLayers: 99, flashAttn: "auto" });
  });

  it("drops an out-of-set flash mode", () => {
    const out = record(
      "KALSA_GPU_FALLBACK",
      '{"requestedGpuLayers":99,"flashAttn":"always /Users/marco"}',
    );
    expect(out).toEqual({ requestedGpuLayers: 99 });
  });
});

describe("KALSA_NATIVE_VARIANT (LlamaService.ts:2665-2674)", () => {
  it("keeps the governor object shape for nGpuLayers", () => {
    expect(
      record(
        "KALSA_NATIVE_VARIANT",
        '{"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}',
      ),
    ).toEqual({
      androidLib: "rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl",
      nGpuLayers: { prefill: 99, decode: 0 },
    });
  });

  it("keeps the plain number shape and null lib", () => {
    expect(
      record("KALSA_NATIVE_VARIANT", '{"androidLib":null,"nGpuLayers":0}'),
    ).toEqual({ androidLib: null, nGpuLayers: 0 });
  });

  it("drops a library name the loader never assigns", () => {
    const out = record(
      "KALSA_NATIVE_VARIANT",
      '{"androidLib":"libevil.so","nGpuLayers":99}',
    );
    expect(out).toEqual({ nGpuLayers: 99 });
  });

  it("drops an object with a non-numeric value", () => {
    const out = record(
      "KALSA_NATIVE_VARIANT",
      '{"nGpuLayers":{"prefill":99,"decode":"zero"}}',
    );
    expect(out).toEqual({});
  });
});

describe("KALSA_PREWARM (LlamaService.ts:855-1574, :4633; useHostEngine.ts:142)", () => {
  it("keeps the start line and drops the prefix hash", () => {
    expect(
      record(
        "KALSA_PREWARM",
        '{"op":"start","hash":"9f86d081884c7d65","systemChars":1832,"toolCount":2}',
      ),
    ).toEqual({ op: "start", systemChars: 1832, toolCount: 2 });
  });

  it("keeps the skip line with a known reason", () => {
    expect(
      record("KALSA_PREWARM", '{"op":"skip","reason":"kv_holds_chat"}'),
    ).toEqual({ op: "skip", reason: "kv_holds_chat" });
  });

  it("drops the native error text (err) and unknown eval fields", () => {
    const out = record(
      "KALSA_PREWARM",
      '{"op":"skip","reason":"eval-failed","err":"prompt was: tell me a secret","hash":"x","promptMs":12,"promptN":100}',
    );
    expect(out).toEqual({ op: "skip", reason: "eval-failed", promptMs: 12, promptN: 100 });
  });

  it("drops the composite restore reasons and the hash on restore lines", () => {
    const out = record(
      "KALSA_PREWARM",
      '{"op":"restore","ok":false,"reason":"meta_mismatch:modelId","deleted":true,"hash":"x"}',
    );
    expect(out).toEqual({ op: "restore", ok: false, deleted: true });
  });

  it("keeps the match:false send line and drops both hashes", () => {
    const out = record(
      "KALSA_PREWARM",
      '{"match":false,"reason":"prefix_miss","prewarm":"aaa","send":"bbb"}',
    );
    expect(out).toEqual({ match: false, reason: "prefix_miss" });
  });

  it("keeps the done line with timing counters", () => {
    expect(
      record(
        "KALSA_PREWARM",
        '{"op":"done","promptMs":1820.5,"promptN":1832,"hash":"x"}',
      ),
    ).toEqual({ op: "done", promptMs: 1820.5, promptN: 1832 });
  });
});

describe("KALSA_PAIRING_FAIL (pairingFailLog.ts:27)", () => {
  it("keeps stage and status", () => {
    expect(
      record("KALSA_PAIRING_FAIL", '{"stage":"claim_network","status":503}'),
    ).toEqual({ stage: "claim_network", status: 503 });
    expect(record("KALSA_PAIRING_FAIL", '{"stage":"seal","status":null}')).toEqual({
      stage: "seal",
      status: null,
    });
  });

  it("drops an unknown stage", () => {
    const out = record(
      "KALSA_PAIRING_FAIL",
      '{"stage":"claim_network?url=https://evil","status":503}',
    );
    expect(out).toEqual({ status: 503 });
  });
});

describe("KALSA_ROAD (road.ts:79-120)", () => {
  it("keeps the iroh dial line and drops node8", () => {
    expect(
      record(
        "KALSA_ROAD",
        '{"road":"iroh","lane":"door","stage":"dial","reason":"deadline","ms":37,"node8":"deadbeef"}',
      ),
    ).toEqual({ road: "iroh", lane: "door", stage: "dial", reason: "deadline", ms: 37 });
  });

  it("keeps the https decision line", () => {
    expect(record("KALSA_ROAD", '{"road":"https","reason":"no_node"}')).toEqual({
      road: "https",
      reason: "no_node",
    });
  });

  it("keeps iroh bridge lifecycle decisions", () => {
    expect(record("KALSA_ROAD", '{"road":"iroh","stage":"background_stop","reason":"tunnels_open"}')).toEqual({
      road: "iroh",
      stage: "background_stop",
      reason: "tunnels_open",
    });
    expect(record("KALSA_ROAD", '{"road":"iroh","stage":"start","reason":"stop_timeout"}')).toEqual({
      road: "iroh",
      stage: "start",
      reason: "stop_timeout",
    });
  });
});
