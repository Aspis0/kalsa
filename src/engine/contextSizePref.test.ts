jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CONTEXT_SIZE_KEY,
  CONTEXT_SIZE_OPTIONS,
  contextSizeChoices,
  contextSizeOutcome,
  nearestOfferedContextSize,
  readUserContextSize,
  resolveRequestedContextTokens,
  writeUserContextSize,
} from "./contextSizePref";

describe("context size preference", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  test("unset reads as null, so the catalog keeps winning", async () => {
    expect(await readUserContextSize()).toBeNull();
  });

  test("round-trips a chosen size under its own key", async () => {
    await writeUserContextSize(32768);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(CONTEXT_SIZE_KEY, "32768");
  });

  test("a malformed stored value reads as unset, never as 0 or NaN", async () => {
    for (const raw of ["banana", "", "  ", "0", "-4096", "1.5", "NaN"]) {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
      expect(await readUserContextSize()).toBeNull();
    }
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("16384");
    expect(await readUserContextSize()).toBe(16384);
  });

  test("a failed write reports false and never throws", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("volume full"));
    await expect(writeUserContextSize(16384)).resolves.toBe(false);
  });

  test("refuses to store a size the ladder does not offer", async () => {
    await expect(writeUserContextSize(99999)).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expect(writeUserContextSize(16384)).resolves.toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(CONTEXT_SIZE_KEY, "16384");
  });

  test("accepts a size only when this model offers it", async () => {
    // LFM's own maximum (131072) is on ITS list; the same number is not a size
    // a 4k model offers.
    await expect(writeUserContextSize(131072, 131072)).resolves.toBe(true);
    await expect(writeUserContextSize(131072, 4096)).resolves.toBe(false);
  });

  test("clamps an off-ladder stored value on read when the model is known", async () => {
    expect(nearestOfferedContextSize(99999, 131072)).toBe(65536);
    expect(nearestOfferedContextSize(4096, 4096)).toBe(4096);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("99999");
    expect(await readUserContextSize()).toBe(99999);
    expect(await readUserContextSize(131072)).toBe(65536);
    expect(await readUserContextSize(4096)).toBe(4096);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("131072");
    expect(await readUserContextSize(131072)).toBe(131072);
    expect(await readUserContextSize(262144)).toBe(102400);
  });

  test("choices never offer more than the model's own maximum", () => {
    expect(contextSizeChoices(131072)).toEqual([...CONTEXT_SIZE_OPTIONS, 131072]);
    expect(contextSizeChoices(262144)).toEqual([...CONTEXT_SIZE_OPTIONS, 262144]);
    // A model shorter than the first rung gets only its own maximum.
    expect(contextSizeChoices(4096)).toEqual([4096]);
    expect(contextSizeChoices(8192)).toEqual([8192]);
    // No model context known → the plain ladder.
    expect(contextSizeChoices(undefined)).toEqual([...CONTEXT_SIZE_OPTIONS]);
  });
});

describe("contextSizeOutcome", () => {
  test("asked more than the phone can hold is reported with the reason", () => {
    expect(
      contextSizeOutcome({
        requested: 102400,
        loaded: 16384,
        ctxSource: "memory-budget",
        nonEvictableMiB: 2530.4,
        availableMiB: 1800.2,
      }),
    ).toEqual({
      kind: "phone-could-not-hold",
      requested: 102400,
      loaded: 16384,
      neededMiB: 2530,
      availableMiB: 1800.2,
    });
  });

  test("a floor-limited load counts as the phone's limit too", () => {
    expect(
      contextSizeOutcome({
        requested: 65536,
        loaded: 8192,
        ctxSource: "floor:8192",
        nonEvictableMiB: 4000,
        availableMiB: 900,
      }).kind,
    ).toBe("phone-could-not-hold");
  });

  test("a request the model itself caps is not blamed on memory", () => {
    expect(
      contextSizeOutcome({
        requested: 262144,
        loaded: 131072,
        ctxSource: "request",
        nonEvictableMiB: 4000,
        availableMiB: 8000,
      }),
    ).toEqual({ kind: "model-max", requested: 262144, loaded: 131072 });
  });

  test("an honoured request stays as-requested", () => {
    expect(
      contextSizeOutcome({
        requested: 32768,
        loaded: 32768,
        ctxSource: "request",
        nonEvictableMiB: 2000,
        availableMiB: 6000,
      }).kind,
    ).toBe("as-requested");
  });
});

describe("resolveRequestedContextTokens", () => {
  const base = {
    catalogContextTokens: 8192,
    modelContextLength: 131072,
  };

  test("the bench lever outranks the setting and the catalog", () => {
    expect(
      resolveRequestedContextTokens({ ...base, benchNCtx: 32768, storedUserContextSize: 16384 }),
    ).toBe(32768);
  });

  test("the stored choice outranks the catalog, clamped to what the model offers", () => {
    expect(resolveRequestedContextTokens({ ...base, storedUserContextSize: 262144 })).toBe(131072);
    expect(
      resolveRequestedContextTokens({
        catalogContextTokens: 8192,
        modelContextLength: 262144,
        storedUserContextSize: 262144,
      }),
    ).toBe(262144);
  });

  test("nothing chosen anywhere → the catalog / RAM-resolved value", () => {
    expect(resolveRequestedContextTokens({ catalogContextTokens: 16384 })).toBe(16384);
  });
});
