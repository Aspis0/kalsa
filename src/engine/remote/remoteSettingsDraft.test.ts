import {
  canCommitField,
  canCommitRemoteSettings,
  shouldHydrateField,
  type RemoteSettingsField,
} from "./remoteSettingsDraft";

const dirty = (...fields: RemoteSettingsField[]) => new Set(fields);

describe("remote settings draft guards", () => {
  test("unhydrated form cannot commit (would wipe stored URL and token)", () => {
    expect(canCommitRemoteSettings(false)).toBe(false);
    expect(canCommitRemoteSettings(true)).toBe(true);
  });

  test("hydration skips only the fields the user already edited", () => {
    const edited = dirty("serverModel");
    expect(
      shouldHydrateField({ cancelled: false, dirty: edited, field: "serverModel" }),
    ).toBe(false);
    expect(
      shouldHydrateField({ cancelled: false, dirty: edited, field: "url" }),
    ).toBe(true);
    expect(
      shouldHydrateField({ cancelled: false, dirty: edited, field: "token" }),
    ).toBe(true);
    expect(
      shouldHydrateField({ cancelled: false, dirty: edited, field: "maxTokens" }),
    ).toBe(true);
  });

  test("a clean field is hydrated even when another one is dirty", () => {
    expect(
      shouldHydrateField({
        cancelled: false,
        dirty: dirty("url", "maxTokens"),
        field: "token",
      }),
    ).toBe(true);
  });

  test("an unmounted form hydrates nothing, even with a clean draft", () => {
    expect(
      shouldHydrateField({ cancelled: true, dirty: dirty(), field: "url" }),
    ).toBe(false);
  });

  test("a field whose hydration failed is not writable", () => {
    expect(
      canCommitField({ field: "token", hydrated: {}, dirty: dirty() }),
    ).toBe(false);
    expect(
      canCommitField({
        field: "url",
        hydrated: { url: false },
        dirty: dirty(),
      }),
    ).toBe(false);
  });

  test("a field the user edited is writable even when its hydration failed", () => {
    expect(
      canCommitField({ field: "token", hydrated: {}, dirty: dirty("token") }),
    ).toBe(true);
  });

  test("a hydrated field is writable even when untouched", () => {
    expect(
      canCommitField({
        field: "url",
        hydrated: { url: true },
        dirty: dirty(),
      }),
    ).toBe(true);
  });
});
