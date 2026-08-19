/**
 * Unit tests for bench tool_choice / toolgate knobs.
 * AsyncStorage is mocked — this file must stay loadable in node jest.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getEngineOverride,
  getToolChoiceMode,
  getToolGateEnabled,
  parseEngineArg,
  resolveCompletionToolChoice,
} from "./benchConfig";

const MAX_TOOL_ROUNDS = 3;

function sequence(benchMode: "auto" | "required" | "none", forceTextOnlyAt = -1) {
  return Array.from({ length: MAX_TOOL_ROUNDS }, (_, round) =>
    resolveCompletionToolChoice({
      hasTools: true,
      isFinalToolRound: round === MAX_TOOL_ROUNDS - 1,
      forceTextOnly: round === forceTextOnlyAt,
      round,
      benchMode,
    }),
  );
}

describe("resolveCompletionToolChoice", () => {
  test('absent pref yields exactly today\'s "auto"/"none" sequence per round', () => {
    expect(sequence("auto")).toEqual(["auto", "auto", "none"]);
  });

  test("required never lands on the final round", () => {
    expect(
      resolveCompletionToolChoice({
        hasTools: true,
        isFinalToolRound: true,
        forceTextOnly: false,
        round: 0,
        benchMode: "required",
      }),
    ).toBe("none");
    expect(sequence("required")).toEqual(["required", "auto", "none"]);
  });

  test("forceTextOnly wins over required", () => {
    expect(
      resolveCompletionToolChoice({
        hasTools: true,
        isFinalToolRound: false,
        forceTextOnly: true,
        round: 0,
        benchMode: "required",
      }),
    ).toBe("none");
  });

  test("rounds after the first stay auto under required", () => {
    expect(
      resolveCompletionToolChoice({
        hasTools: true,
        isFinalToolRound: false,
        forceTextOnly: false,
        round: 1,
        benchMode: "required",
      }),
    ).toBe("auto");
  });

  test("bench none offers tools but never chooses", () => {
    expect(sequence("none")).toEqual(["none", "none", "none"]);
  });

  test("no tools always none", () => {
    expect(
      resolveCompletionToolChoice({
        hasTools: false,
        isFinalToolRound: false,
        forceTextOnly: false,
        round: 0,
        benchMode: "required",
      }),
    ).toBe("none");
  });
});

describe("getToolChoiceMode / getToolGateEnabled defaults", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("absent toolchoice pref defaults to auto", async () => {
    await expect(getToolChoiceMode()).resolves.toBe("auto");
  });

  test("absent toolgate pref defaults to enabled", async () => {
    await expect(getToolGateEnabled()).resolves.toBe(true);
  });

  test("toolgate 0 disables", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("0");
    await expect(getToolGateEnabled()).resolves.toBe(false);
  });
});

/**
 * The persistence half of the Android GPU gate. applyEngineOverride is tested
 * in engine/engineParams.test.ts; what matters here is that a key written by a
 * bench run comes back out of storage with the field that unlocks offload, so
 * the round trip is visible rather than assumed.
 */
describe("engine override persistence", () => {
  test("a stale key carrying gpu+fa survives storage intact", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ nGpuLayers: 99, flashAttn: "off" }),
    );
    await expect(getEngineOverride()).resolves.toEqual({
      nGpuLayers: 99,
      flashAttn: "off",
    });
  });

  test("an old key written before flashAttn existed cannot unlock offload", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ nGpuLayers: 99 }),
    );
    const o = await getEngineOverride();
    expect(o).toEqual({ nGpuLayers: 99 });
    expect(o?.flashAttn).toBeUndefined();
  });

  test("a junk flashAttn value is dropped, not passed to native", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ nGpuLayers: 99, flashAttn: "disabled" }),
    );
    const o = await getEngineOverride();
    expect(o?.flashAttn).toBeUndefined();
  });

  test("parseEngineArg accepts fa alongside gpu and rejects junk", () => {
    expect(parseEngineArg("gpu=99,fa=off")).toEqual({
      nGpuLayers: 99,
      flashAttn: "off",
    });
    expect(parseEngineArg("fa=disabled")).toBeNull();
    expect(parseEngineArg("fa=")).toBeNull();
  });
});
