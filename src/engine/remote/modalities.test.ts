import { getRemoteVision, NO_MODALITIES, parseModalities, setRemoteVision } from "./modalities";

describe("parseModalities", () => {
  test("reads exactly what /props says", () => {
    expect(parseModalities({ modalities: { vision: true, audio: false, video: true } })).toEqual({
      vision: true,
      audio: false,
      video: true,
    });
  });

  test("fails closed on anything that is not exactly true", () => {
    expect(parseModalities(undefined)).toEqual(NO_MODALITIES);
    expect(parseModalities(null)).toEqual(NO_MODALITIES);
    expect(parseModalities("modalities")).toEqual(NO_MODALITIES);
    expect(parseModalities({})).toEqual(NO_MODALITIES);
    expect(parseModalities({ modalities: null })).toEqual(NO_MODALITIES);
    expect(parseModalities({ modalities: { vision: 1, audio: "yes", video: {} } })).toEqual(
      NO_MODALITIES,
    );
    // An answer from a door that answered something else entirely.
    expect(parseModalities({ default_generation_settings: { n_ctx: 4096 } })).toEqual(
      NO_MODALITIES,
    );
  });
});

describe("the remembered verdict", () => {
  test("is false until a probe says otherwise, and false again once cleared", () => {
    setRemoteVision(false);
    expect(getRemoteVision()).toBe(false);
    setRemoteVision(true);
    expect(getRemoteVision()).toBe(true);
    // Anything that is not exactly true clears it.
    setRemoteVision(undefined as unknown as boolean);
    expect(getRemoteVision()).toBe(false);
    setRemoteVision(true);
    setRemoteVision(false);
    expect(getRemoteVision()).toBe(false);
  });
});
