import {
  iosBackgroundMarkAfterRelease,
  iosBackgroundPlan,
  type LocalReleaseOutcome,
} from "./iosBackgroundPlan";

const none = { stop: false, mark: false, release: false };

const plan = (over: Partial<Parameters<typeof iosBackgroundPlan>[0]> = {}) =>
  iosBackgroundPlan({
    platform: "ios",
    event: "background",
    sending: true,
    remote: false,
    nativeWork: true,
    loadInProgress: false,
    reloadPending: false,
    ...over,
  });

describe("iosBackgroundPlan", () => {
  test("stops and marks a local send the phone is about to suspend", () => {
    expect(plan()).toEqual({ stop: true, mark: true, release: false });
  });

  test("stops a local send even before its native completion registers", () => {
    expect(plan({ nativeWork: false })).toEqual({
      stop: true,
      mark: true,
      release: false,
    });
  });

  test("marks native work with no send of its own — a prewarm, an extraction", () => {
    expect(plan({ sending: false, nativeWork: true })).toEqual({
      stop: false,
      mark: true,
      release: false,
    });
  });

  test("marks a load building a context before its initLlama registers", () => {
    expect(plan({ sending: false, nativeWork: false, loadInProgress: true })).toEqual({
      stop: false,
      mark: true,
      release: false,
    });
  });

  test("leaves a remote send alone: no local GPU is in the way", () => {
    expect(plan({ remote: true, nativeWork: false })).toEqual(none);
  });

  test("marks a remote send's local background work but never stops it", () => {
    expect(plan({ remote: true, nativeWork: true })).toEqual({
      stop: false,
      mark: true,
      release: false,
    });
  });

  test("an engine resident and idle is not work: no mark", () => {
    expect(plan({ sending: false, nativeWork: false })).toEqual(none);
  });

  test("does nothing on inactive: Control Center and the app switcher fire it", () => {
    expect(plan({ event: "inactive" })).toEqual(none);
  });

  test("does nothing on Android, whatever the send is doing", () => {
    expect(plan({ platform: "android" })).toEqual(none);
    expect(
      plan({ platform: "android", event: "active", reloadPending: true }),
    ).toEqual(none);
  });

  test("releases while the mark is set", () => {
    expect(
      plan({
        event: "active",
        sending: false,
        nativeWork: false,
        reloadPending: true,
      }),
    ).toEqual({ stop: false, mark: false, release: true });
  });

  test("a later active with the mark already gone does nothing", () => {
    // The mark is not consumed here: it survives until the release lands and
    // clears it (`iosBackgroundGuard.ts`, epoch-guarded). An active event before
    // that starts a second release, which finds nothing resident and changes
    // nothing — this input is that state, after the clear.
    expect(
      plan({
        event: "active",
        sending: false,
        nativeWork: false,
        reloadPending: false,
      }),
    ).toEqual(none);
  });

  test("active without a mark does nothing", () => {
    expect(plan({ event: "active", sending: false, nativeWork: false })).toEqual(none);
  });
});

describe("iosBackgroundMarkAfterRelease", () => {
  const after = (
    outcome: LocalReleaseOutcome,
    markEpochAtStart = 7,
    markEpochNow = 7,
  ) => iosBackgroundMarkAfterRelease({ outcome, markEpochAtStart, markEpochNow });

  test("a real release ends the mark and is the only thing logged", () => {
    expect(after("released")).toEqual({ clearMark: true, released: true });
  });

  test("no context left to release ends the mark silently", () => {
    expect(after("absent")).toEqual({ clearMark: true, released: false });
  });

  test("a withheld release keeps the mark for the next active retry", () => {
    expect(after("withheld")).toEqual({ clearMark: false, released: false });
  });

  test("a mark that moved while the release ran is the later suspension's", () => {
    expect(after("released", 7, 8)).toEqual({ clearMark: false, released: true });
    expect(after("absent", 7, 8)).toEqual({ clearMark: false, released: false });
  });
});
