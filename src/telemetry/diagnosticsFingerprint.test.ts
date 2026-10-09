/**
 * Local dedupe keeps distinct native failures apart: same code, detail and
 * stage, but a different engine signature or backend, is a different report.
 */
import type { RawDiagnosticInput } from "./diagnosticsSanitize";
import { localFingerprint, sanitizeReport } from "./pure";

function failure(message: string, engineDecode: string): RawDiagnosticInput {
  return {
    component: "engine",
    stage: "decode",
    rawMessage: message,
    breadcrumbs: [],
    sinceStartSeconds: 5,
    turn: { engineDecode },
  };
}

function fingerprintOf(diagnostics: RawDiagnosticInput) {
  const report = sanitizeReport({
    code: "chat.generation",
    detail: "native_crash",
    platform: "android",
    diagnostics,
  });
  if (!report) throw new Error("sanitizeReport rejected a valid report");
  return localFingerprint(report);
}

describe("local fingerprint", () => {
  test("different engine signatures in the same stage are not collapsed", () => {
    const oom = fingerprintOf(failure("out of memory", "GPU"));
    const segfault = fingerprintOf(failure("segmentation fault", "GPU"));
    expect(oom).not.toBe(segfault);
  });

  test("different backends in the same stage are not collapsed", () => {
    const gpu = fingerprintOf(failure("out of memory", "GPU"));
    const cpu = fingerprintOf(failure("out of memory", "CPU"));
    expect(gpu).not.toBe(cpu);
  });

  test("an identical failure still collapses", () => {
    expect(fingerprintOf(failure("out of memory", "GPU"))).toBe(fingerprintOf(failure("out of memory", "GPU")));
  });
});
