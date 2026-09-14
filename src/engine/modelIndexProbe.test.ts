import {
  canEagerInitLocal,
  decideModelIndexProbe,
  shouldNoopLocalSelect,
  shouldReprobeAfterSwitch,
  switchDisposeUi,
  afterRemoteSwitchDispose,
} from "./modelIndexProbe";

describe("decideModelIndexProbe", () => {
  test("remote→local interleaving: persistence await then effect, local wins", () => {
    // selectModel sync: switch in flight, backendCache still remote, intent local.
    expect(
      decideModelIndexProbe({
        switchInFlight: true,
        backendRemote: true,
        intentRemote: false,
      }),
    ).toEqual({ action: "skip" });
    expect(
      canEagerInitLocal({ switchInFlight: true, backendRemote: true }),
    ).toBe(false);

    // Session persistence await resolves; modelIndex effect fires. Even if the
    // switch flag were already cleared, a remote cache must not reassert.
    const afterPersist = decideModelIndexProbe({
      switchInFlight: false,
      backendRemote: true,
      intentRemote: false,
    });
    expect(afterPersist).toEqual({ action: "skip" });
    expect(afterPersist.action).not.toBe("ensure-remote");
    expect(
      canEagerInitLocal({ switchInFlight: false, backendRemote: true }),
    ).toBe(false);

    // Switch finished: backend is local, intent local → probe the local model.
    expect(
      decideModelIndexProbe({
        switchInFlight: false,
        backendRemote: false,
        intentRemote: false,
      }),
    ).toEqual({ action: "probe-local" });
    expect(
      canEagerInitLocal({ switchInFlight: false, backendRemote: false }),
    ).toBe(true);
  });

  test("boot remote: no switch, intent remote → ensure remote", () => {
    expect(
      decideModelIndexProbe({
        switchInFlight: false,
        backendRemote: true,
        intentRemote: true,
      }),
    ).toEqual({ action: "ensure-remote" });
  });
});

describe("shouldNoopLocalSelect", () => {
  test("select A local -> Mac -> A again is not a no-op", () => {
    expect(
      shouldNoopLocalSelect({ nextIndex: 0, currentIndex: 0, remoteActive: false }),
    ).toBe(true);
    expect(
      shouldNoopLocalSelect({ nextIndex: 0, currentIndex: 0, remoteActive: true }),
    ).toBe(false);
  });
});

describe("shouldReprobeAfterSwitch", () => {
  test("disposal timeout does not reprobe", () => {
    expect(shouldReprobeAfterSwitch(false)).toBe(false);
    expect(shouldReprobeAfterSwitch(true)).toBe(true);
  });
});

describe("switchDisposeUi", () => {
  test("dispose rejects -> error surfaced, no reprobe, remoteActive cleared", () => {
    const ui = switchDisposeUi(false);
    expect(ui.surfaceError).toBe(true);
    expect(ui.reprobe).toBe(false);
    expect(ui.remoteActive).toBe(false);
  });
});

describe("afterRemoteSwitchDispose", () => {
  test("hanging native dispose on remote switch -> error, in-flight released", () => {
    const ui = afterRemoteSwitchDispose(false);
    expect(ui.surfaceError).toBe(true);
    expect(ui.remoteActive).toBe(false);
    expect(ui.reprobe).toBe(false);
    expect(ui.inFlightReleased).toBe(true);
  });
});
