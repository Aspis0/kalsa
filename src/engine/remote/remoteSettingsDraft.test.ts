import {
  canCommitRemoteSettings,
  shouldApplyRemoteHydration,
} from "./remoteSettingsDraft";

describe("remote settings draft guards", () => {
  test("unhydrated form cannot commit (would wipe stored URL and token)", () => {
    expect(canCommitRemoteSettings(false)).toBe(false);
    expect(canCommitRemoteSettings(true)).toBe(true);
  });

  test("late hydration does not overwrite a dirty draft", () => {
    expect(
      shouldApplyRemoteHydration({ cancelled: false, dirty: true }),
    ).toBe(false);
  });

  test("hydration applies only when still mounted and clean", () => {
    expect(
      shouldApplyRemoteHydration({ cancelled: false, dirty: false }),
    ).toBe(true);
    expect(
      shouldApplyRemoteHydration({ cancelled: true, dirty: false }),
    ).toBe(false);
  });
});
