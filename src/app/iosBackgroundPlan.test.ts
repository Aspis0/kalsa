import { iosBackgroundPlan } from "./iosBackgroundPlan";

const none = { stop: false, mark: false, release: false };

const plan = (over: Partial<Parameters<typeof iosBackgroundPlan>[0]> = {}) =>
  iosBackgroundPlan({
    platform: "ios",
    event: "background",
    sending: true,
    remote: false,
    reloadPending: false,
    ...over,
  });

describe("iosBackgroundPlan", () => {
  test("stops and marks a local send the phone is about to suspend", () => {
    expect(plan()).toEqual({ stop: true, mark: true, release: false });
  });

  test("leaves a remote send alone: no local GPU is in the way", () => {
    expect(plan({ remote: true })).toEqual(none);
  });

  test("does nothing on inactive: Control Center and the app switcher fire it", () => {
    expect(plan({ event: "inactive" })).toEqual(none);
  });

  test("does nothing on Android, whatever the send is doing", () => {
    expect(plan({ platform: "android" })).toEqual(none);
    expect(plan({ platform: "android", event: "active", reloadPending: true })).toEqual(none);
  });

  test("background with no send in flight marks nothing", () => {
    expect(plan({ sending: false })).toEqual(none);
  });

  test("releases the marked context on the way back — once", () => {
    expect(plan({ event: "active", sending: false, reloadPending: true })).toEqual({
      stop: false,
      mark: false,
      release: true,
    });
    // The caller consumes the mark synchronously, so the next active event
    // (iOS may emit more than one) finds nothing pending.
    expect(plan({ event: "active", sending: false, reloadPending: false })).toEqual(none);
  });

  test("active without a mark does nothing", () => {
    expect(plan({ event: "active", sending: false })).toEqual(none);
  });
});
