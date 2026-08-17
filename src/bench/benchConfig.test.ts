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
  getKvTranscriptEnabled,
  getToolChoiceMode,
  getToolGateEnabled,
  parseBenchKvTranscript,
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
  afterEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
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

describe("parseBenchKvTranscript / getKvTranscriptEnabled", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });
  afterEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("absent / null defaults to off", async () => {
    expect(parseBenchKvTranscript(null)).toBe(false);
    expect(parseBenchKvTranscript(undefined)).toBe(false);
    await expect(getKvTranscriptEnabled()).resolves.toBe(false);
  });

  test('"1" is on', async () => {
    expect(parseBenchKvTranscript("1")).toBe(true);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    await expect(getKvTranscriptEnabled()).resolves.toBe(true);
  });

  test('"0" / garbage is off', () => {
    expect(parseBenchKvTranscript("0")).toBe(false);
    expect(parseBenchKvTranscript("on")).toBe(false);
    expect(parseBenchKvTranscript("yes")).toBe(false);
  });
});
