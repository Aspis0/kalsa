/**
 * What the model bar SAYS — the controller's own derivations
 * (`AppShell.tsx:6720-6788` status/hint, `:2793-2830` battery) driven
 * against the SHIPPED catalogues, so a key that leaves a catalogue or a
 * placeholder that drifts fails here. What a rewrite could break silently:
 * the hung embedder's restart hint replacing "tap to retry", the
 * ready/reload residency split, the hint's friendly-text dedupe, and the
 * battery line's four gates (ready, API, percent, 50 %).
 */
import { makeT, en, it as italian } from "../i18n";
import type { ModelInfo } from "../engine/ModelRegistry";
import type { BatteryEtaUiState } from "../hooks/useBatteryEta";
import {
  buildBatteryLines,
  modelBarStatus,
  modelErrorHint,
  progressPercent,
} from "./modelBar";

const t = makeT("en");
const tIt = makeT("it");

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
    });
    expect(status({ modelState: "ready", jsReady: true, activeMatches: false })).toEqual({
      label: en.chat.lazyReload,
      tone: "accent",
    });
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

function eta(overrides: Partial<BatteryEtaUiState> = {}): BatteryEtaUiState {
  return {
    kind: "unknown",
    batteryPercent: 40,
    charging: false,
    sampledAt: 1,
    apiAvailable: true,
    ...overrides,
  };
}

describe("the advisory battery lines (App:2793-2830)", () => {
  it("four gates, each of which drops the line entirely", () => {
    // Not ready.
    expect(buildBatteryLines(eta(), "missing", t)).toEqual([]);
    // Native API unreachable.
    expect(buildBatteryLines(eta({ apiAvailable: false }), "ready", t)).toEqual([]);
    // Percent unknown.
    expect(buildBatteryLines(eta({ batteryPercent: null }), "ready", t)).toEqual([]);
    // Above 50 %: the advisory is for the risky half of the dial.
    expect(buildBatteryLines(eta({ batteryPercent: 51 }), "ready", t)).toEqual([]);
    // …and at exactly 50 it shows.
    expect(buildBatteryLines(eta({ batteryPercent: 50 }), "ready", t)).toHaveLength(1);
  });

  it("charging says charging, one muted line, even at a low percent", () => {
    const lines = buildBatteryLines(
      eta({ batteryPercent: 15, charging: true, kind: "charging" }),
      "ready",
      t,
    );
    expect(lines).toEqual([{ text: en.chat.batteryCharging, tone: "muted" }]);
  });

  it("a low eta renders the band AND the warning line, worst tone first", () => {
    const lines = buildBatteryLines(
      eta({
        batteryPercent: 15,
        kind: "eta",
        lowHours: 0.5,
        highHours: 1.5,
      }),
      "ready",
      t,
    );
    expect(lines).toHaveLength(2);
    // The controller COLLAPSES a sub-hour low end onto the upper bound rather
    // than rendering "less than 1 hour-1 h 30 min" (AppShell.tsx:2781-2787:
    // "when the low end is sub-hour but the high is a whole band, surface the
    // upper bound... rather than the awkward 'less than 1 h-1 h'"). An earlier
    // draft of this test asserted the opposite and was wrong about the port.
    expect(lines[0].text).toBe(
      en.chat.batteryEstimate.replace("{time}", `~1 h 30 min`),
    );
    expect(lines[0].tone).toBe("bad");
    expect(lines[1]).toEqual({ text: en.chat.batteryLowWarning, tone: "bad" });
  });

  it("a sub-hour band collapses to the upper bound, and both ends equal renders once", () => {
    const collapsed = buildBatteryLines(
      eta({ batteryPercent: 15, kind: "eta", lowHours: 0.4, highHours: 2 }),
      "ready",
      t,
    );
    expect(collapsed[0].text).toBe(en.chat.batteryEstimate.replace("{time}", "~2 h"));
    const single = buildBatteryLines(
      eta({ batteryPercent: 40, kind: "eta", lowHours: 0.5, highHours: 0.5 }),
      "ready",
      t,
    );
    expect(single[0].text).toBe(
      en.chat.batteryEstimate.replace("{time}", `~${en.chat.batteryLessThanHour}`),
    );
  });

  it("a non-low eta is one muted line; the warning needs eta, not just low", () => {
    const high = buildBatteryLines(
      eta({ batteryPercent: 30, kind: "eta", lowHours: 2, highHours: 2 }),
      "ready",
      t,
    );
    expect(high).toEqual([
      { text: en.chat.batteryEstimate.replace("{time}", "~2 h"), tone: "muted" },
    ]);
    const measuringLow = buildBatteryLines(
      eta({ batteryPercent: 15, kind: "measuring" }),
      "ready",
      t,
    );
    expect(measuringLow).toEqual([
      { text: en.chat.batteryMeasuring, tone: "muted" },
    ]);
  });

  it("the measuring and unknown fallbacks are the catalogue's own words", () => {
    expect(buildBatteryLines(eta({ kind: "measuring" }), "ready", t)[0].text).toBe(
      en.chat.batteryMeasuring,
    );
    expect(buildBatteryLines(eta({ kind: "unknown" }), "ready", t)[0].text).toBe(
      en.chat.batteryUnknown,
    );
    expect(buildBatteryLines(eta({ kind: "eta", lowHours: 0.2, highHours: 0.2 }), "ready", t)[0].text).toBe(
      en.chat.batteryEstimate.replace(
        "{time}",
        `~${en.chat.batteryLessThanHour}`,
      ),
    );
  });

  it("every battery key exists, non-empty, in BOTH catalogues", () => {
    for (const key of [
      "batteryEstimate",
      "batteryMeasuring",
      "batteryCharging",
      "batteryUnknown",
      "batteryLessThanHour",
      "batteryLowWarning",
    ] as const) {
      expect([key, typeof en.chat[key], typeof italian.chat[key]]).toEqual([
        key,
        "string",
        "string",
      ]);
      expect(en.chat[key].length).toBeGreaterThan(0);
      expect(italian.chat[key].length).toBeGreaterThan(0);
    }
  });
});
