/**
 * What the model bar SAYS — the controller's own derivations
 * (`AppShell.tsx:6720-6788` status/hint, `:2793-2830` battery) driven
 * against the SHIPPED catalogues, so a key that leaves a catalogue or a
 * placeholder that drifts fails here. What a rewrite could break silently:
 * the hung embedder's restart hint replacing "tap to retry", the
 * ready/reload residency split, and the hint's friendly-text dedupe. The
 * battery lines are pinned in `modelBarBattery.test.ts`.
 */
import { makeT, en, it as italian } from "../i18n";
import { readFileSync } from "fs";
import { join } from "path";
import type { ModelInfo } from "../engine/ModelRegistry";
import { modelBarStatus, modelErrorHint, progressPercent } from "./modelBar";

const t = makeT("en");
const tIt = makeT("it");
const MODEL_BAR_HOOK = readFileSync(join(__dirname, "useModelBar.ts"), "utf8");

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

describe("progress percent (App:6720)", () => {
  it("rounds the fraction, and an absent download reads 0", () => {
    expect(progressPercent(null)).toBe(0);
    expect(progressPercent(0.427)).toBe(43);
    expect(progressPercent(1)).toBe(100);
  });
});

describe("the status label, one case per bar kind", () => {
  it("checking is muted and says the controller's word", () => {
    expect(status({ modelState: "checking" })).toEqual({
      label: en.download.checking,
      tone: "muted",
    });
  });

  it("missing prices the WHOLE bundle (main + mmproj) into the label", () => {
    const s = status({ modelState: "missing" });
    expect(s.tone).toBe("accent");
    expect(s.label).toBe(
      en.download.missing.replace("{size}", "2.0 GB"),
    );
    expect(s.label).toContain("2.0 GB");
    // The row is the control the sentence promises: a tap downloads.
    expect(s.retryLabel).toBe(en.common.download);
  });

  it("a missing model names no control while the embedder is hung (the tap is inert)", () => {
    expect(status({ modelState: "missing", hung: true }).retryLabel).toBeUndefined();
  });

  it("downloading carries the live percent", () => {
    expect(status({ modelState: "downloading", percent: 42 })).toEqual({
      label: en.download.downloading.replace("{percent}", "42"),
      tone: "accent",
    });
  });

  it("loading is muted", () => {
    expect(status({ modelState: "loading" })).toEqual({
      label: en.download.loading,
      tone: "muted",
    });
  });

  it("a download error says retry, an engine error says load-failed — and both name the control", () => {
    expect(status({ modelState: "error", errorKind: "download" })).toEqual({
      label: en.download.failedRetry,
      tone: "bad",
      // The row this sentence sits in IS the control it promises.
      retryLabel: en.shell.action.retry,
    });
    expect(status({ modelState: "error", errorKind: "engine" })).toEqual({
      label: en.download.loadFailedRetry,
      tone: "bad",
      retryLabel: en.shell.action.retry,
    });
    // errorKind null counts as a download failure, as the controller did.
    expect(status({ modelState: "error", errorKind: null }).label).toBe(
      en.download.failedRetry,
    );
  });

  it("HUNG outranks the retry copy: restart is the only honest action", () => {
    for (const errorKind of ["download", "engine", null] as const) {
      const s = status({ modelState: "error", errorKind, hung: true });
      expect([errorKind, s.label, s.tone]).toEqual([
        errorKind,
        en.embedding.restartHint,
        "bad",
      ]);
    }
    // The retry words must be gone while hung — they promise a working tap.
    expect(status({ modelState: "error", errorKind: "download", hung: true }).label).not.toContain(
      "tap",
    );
    // …and so must the control's name: a hung row is not tappable.
    for (const errorKind of ["download", "engine", null] as const) {
      expect(status({ modelState: "error", errorKind, hung: true }).retryLabel).toBeUndefined();
    }
  });

  it("ready needs BOTH the JS wrapper and the matching active id", () => {
    expect(
      status({ modelState: "ready", jsReady: true, activeMatches: true }),
    ).toEqual({ label: en.download.readyLocal, tone: "good" });
    expect(status({ modelState: "ready", jsReady: false, activeMatches: true })).toEqual({
      label: en.chat.lazyReload,
      tone: "accent",
      retryLabel: en.shell.action.loadModel,
    });
    expect(status({ modelState: "ready", jsReady: true, activeMatches: false })).toEqual({
      label: en.chat.lazyReload,
      tone: "accent",
      retryLabel: en.shell.action.loadModel,
    });
  });

  it("a reload row is the control its sentence promises", () => {
    expect(status({ modelState: "ready", jsReady: false }).retryLabel).toBe(en.shell.action.loadModel);
  });

  it("a reload row while hung shows the restart sentence, never a reload promise", () => {
    expect(status({ modelState: "ready", jsReady: false, hung: true })).toEqual({
      label: en.embedding.restartHint,
      tone: "bad",
    });
  });

  it("announces the remote ready state through the backend-specific label", () => {
    expect(status({ modelState: "ready", jsReady: true, activeMatches: true, remoteActive: true })).toEqual({
      label: en.download.readyRemote,
      tone: "good",
    });
    expect(MODEL_BAR_HOOK).toContain("remoteActive: modelHost.remoteActive");
    expect(status({ modelState: "ready", jsReady: true, activeMatches: true, remoteActive: false }).label)
      .toBe(en.download.readyLocal);
  });

  it("draws the same words from the Italian catalogue", () => {
    const s = status({ modelState: "error", errorKind: "download", t: tIt });
    expect(s.label).toBe(italian.download.failedRetry);
    expect(s.label).not.toBe(en.download.failedRetry);
  });
});

describe("the error hint (App:6725-6745)", () => {
  const connectivity = en.errors.connectionLost;
  const keepOpen = en.download.keepOpenHint;

  it("is null unless the state is a failure", () => {
    expect(
      modelErrorHint({
        modelState: "ready",
        modelError: connectivity,
        modelErrorDetail: "TypeError: boom",
        t,
      }),
    ).toBeNull();
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: en.download.failed,
        modelErrorDetail: null,
        t,
      }),
    ).toBeNull();
  });

  it("a connectivity failure without raw detail shows the keep-open hint", () => {
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: connectivity,
        modelErrorDetail: null,
        t,
      }),
    ).toBe(keepOpen);
  });

  it("raw detail leads, so the ellipsis keeps the diagnostic", () => {
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: connectivity,
        modelErrorDetail: "ECONNRESET: socket hang up",
        t,
      }),
    ).toBe(`ECONNRESET: socket hang up — ${keepOpen}`);
  });

  it("a raw that only restates the friendly text after its prefix is dropped", () => {
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: connectivity,
        modelErrorDetail: `NetError: ${connectivity}`,
        t,
      }),
    ).toBe(keepOpen);
  });

  it("a non-connectivity failure shows only the raw diagnostic", () => {
    expect(
      modelErrorHint({
        modelState: "error",
        modelError: en.download.failed,
        modelErrorDetail: "Sha256VerificationUnavailableError: no checker",
        t,
      }),
    ).toBe("Sha256VerificationUnavailableError: no checker");
  });
});

