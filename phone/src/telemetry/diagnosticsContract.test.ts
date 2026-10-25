/**
 * Pins the phone's copy of the v2 diagnostics contract to the Worker's
 * contract-v2.ts. A value this app can send must be one the Worker accepts.
 */
import { V2 } from "../../workers/telemetry/contract-v2";
import {
  DIAG_COMPONENTS,
  DIAG_CPU_MODEL_PATTERN,
  DIAG_MODEL_IDS,
  DIAG_STAGES,
  type DiagBackend,
  type DiagOffload,
  type DiagThermal,
} from "./diagnosticsContract";
import {
  contextTokensBucket,
  promptTokensBucket,
  sinceStartBucket,
  tokensPerSecondBucket,
} from "./diagnosticsBuckets";

const BACKENDS: DiagBackend[] = ["metal", "opencl", "cpu", "unknown"];
const OFFLOADS: DiagOffload[] = ["gpu", "cpu"];
const THERMALS: DiagThermal[] = ["nominal", "fair", "serious", "critical", "unknown"];

describe("phone enums are a subset of the Worker contract", () => {
  test.each([
    ["component", DIAG_COMPONENTS, V2.enums.component],
    ["stage", DIAG_STAGES, V2.enums.stage],
    ["backend", BACKENDS, V2.enums.backend],
    ["offload", OFFLOADS, V2.enums.offload],
    ["thermal", THERMALS, V2.enums.thermal],
    ["modelId", DIAG_MODEL_IDS, V2.enums.modelId],
  ])("%s", (_name, phone, worker) => {
    for (const value of phone) expect(worker as readonly string[]).toContain(value);
  });

  test("cpuModel pattern is the Worker's, verbatim", () => {
    expect(DIAG_CPU_MODEL_PATTERN).toBe(V2.patterns.cpuModel);
  });
});

describe("bucket labels are the Worker's", () => {
  test("every label the phone can emit exists in the contract", () => {
    const samples: [readonly string[], string][] = [
      [V2.buckets.ctxTokens.labels, contextTokensBucket(1)],
      [V2.buckets.ctxTokens.labels, contextTokensBucket(1_000_000)],
      [V2.buckets.promptTokens.labels, promptTokensBucket(0)],
      [V2.buckets.promptTokens.labels, promptTokensBucket(1_000_000)],
      [V2.buckets.tokensPerSecond.labels, tokensPerSecondBucket(0.5)],
      [V2.buckets.tokensPerSecond.labels, tokensPerSecondBucket(500)],
      [V2.buckets.sinceStart.labels, sinceStartBucket(0)],
      [V2.buckets.sinceStart.labels, sinceStartBucket(86_400)],
    ];
    for (const [labels, value] of samples) expect(labels).toContain(value);
  });

  test("upper edges are exclusive", () => {
    expect(promptTokensBucket(512)).toBe("512-2k");
    expect(contextTokensBucket(65536)).toBe("ge-64k");
    expect(tokensPerSecondBucket(30)).toBe("ge-30");
    expect(sinceStartBucket(600)).toBe("ge-10m");
  });
});
