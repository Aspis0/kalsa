/**
 * Computer mode's strip words (bug: "Load failed" beside "could not
 * reach"): the bar speaks only the computer's own states — the
 * reachability error line alone, never the phone's load-failed label,
 * its retry promise, or its raw diagnostic.
 */
import { makeT, en } from "../i18n";
import type { ModelInfo } from "../engine/ModelRegistry";
import { modelBarStatus, modelErrorHint } from "./modelBar";

const t = makeT("en");

const MODEL = {
  sizeBytes: 1_700_000_000,
  mmproj: { sizeBytes: 300_000_000 },
} as unknown as ModelInfo;

function status(overrides: Partial<Parameters<typeof modelBarStatus>[0]> = {}) {
  return modelBarStatus({
    modelState: "checking",
    jsReady: false,
    activeMatches: false,
    hung: false,
    errorKind: null,
    percent: 0,
    model: MODEL,
    t,
    ...overrides,
  });
}

describe("computer mode: only the reachability message may be spoken", () => {
  it("the unreachable state says nothing local — no load-failed label, no retry promise", () => {
    const s = status({ modelState: "error", errorKind: "engine", remoteActive: true });
    expect(s).toEqual({ label: "", tone: "muted" });
    // The status row is silent so the error line alone carries
    // "Can't reach your computer…" — and no control promises a tap.
    expect(s.retryLabel).toBeUndefined();
  });

  it("every local lifecycle row stays silent while remote", () => {
    for (const modelState of ["missing", "downloading", "checking", "ready"] as const) {
      // checking/ready get their computer wording below; the rest are silent.
      const s = status({
        modelState,
        errorKind: null,
        remoteActive: true,
        ...(modelState === "ready" ? { jsReady: true, activeMatches: true } : null),
      });
      if (modelState === "checking") expect(s.label).toBe(en.download.computerChecking);
      else if (modelState === "ready") expect(s.label).toBe(en.download.readyRemote);
      else expect(s).toEqual({ label: "", tone: "muted" });
    }
    // The local load-failed sentence exists in the catalogue but the remote
    // bar never returns it.
    expect(status({ modelState: "error", errorKind: "engine", remoteActive: true }).label)
      .not.toBe(en.download.loadFailedRetry);
  });

  it("the hint row stays empty in computer mode, raw diagnostic included", () => {
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: en.errors.connectionLost,
        modelErrorDetail: "TypeError: llama load failed",
        remoteActive: true,
        t,
      }),
    ).toBeNull();
    // Local mode keeps the same hint — the gate is mode-scoped.
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: en.errors.connectionLost,
        modelErrorDetail: null,
        t,
      }),
    ).not.toBeNull();
  });
});
