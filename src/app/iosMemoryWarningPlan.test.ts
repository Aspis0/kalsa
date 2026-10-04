/**
 * The memory-warning decision: release only when there is a local engine and
 * nothing native is running, defer while a turn (or a load) is in flight,
 * skip on anything else — and never release on a platform that does not emit
 * the event.
 */
import {
  iosMemoryWarningPlan,
  type IosMemoryWarningAction,
} from "./iosMemoryWarningPlan";

function plan(over: Partial<Parameters<typeof iosMemoryWarningPlan>[0]> = {}): IosMemoryWarningAction {
  return iosMemoryWarningPlan({
    platform: "ios",
    remote: false,
    sending: false,
    nativeWork: false,
    loadInProgress: false,
    resident: true,
    ...over,
  });
}

describe("iosMemoryWarningPlan", () => {
  it("releases a resident idle engine: the release is the whole point of the warning", () => {
    expect(plan()).toEqual({ op: "release" });
  });

  it("defers while a send is in flight — the turn is never killed, only owed", () => {
    expect(plan({ sending: true })).toEqual({ op: "deferred" });
    // A claimed send counts before its native completion registers.
    expect(plan({ sending: true, resident: false })).toEqual({ op: "deferred" });
  });

  it("defers while any native op runs, not only a completion", () => {
    expect(plan({ nativeWork: true })).toEqual({ op: "deferred" });
    expect(plan({ nativeWork: true, sending: true })).toEqual({ op: "deferred" });
  });

  it("defers while a load is building the context a release would take away", () => {
    expect(plan({ loadInProgress: true, resident: false })).toEqual({ op: "deferred" });
  });

  it("skips with the reason when there is nothing local to release", () => {
    expect(plan({ remote: true })).toEqual({ op: "skip", reason: "remote" });
    // Remote wins over residency: the remote engine is the resident one.
    expect(plan({ remote: true, resident: true })).toEqual({ op: "skip", reason: "remote" });
    expect(plan({ resident: false })).toEqual({ op: "skip", reason: "no-engine" });
  });

  it("skips on every platform that does not emit the event", () => {
    expect(plan({ platform: "android" })).toEqual({ op: "skip", reason: "platform" });
    // Android with a resident engine and no work must not fall through to a
    // release: the platform check comes first.
    expect(plan({ platform: "android", resident: true })).toEqual({
      op: "skip",
      reason: "platform",
    });
  });
});
