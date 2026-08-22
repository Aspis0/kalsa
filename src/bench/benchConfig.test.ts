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
  BENCH_THINKING_KEY,
  formatBenchStatus,
  getEngineOverride,
  getThinkingMode,
  getToolChoiceMode,
  getToolGateEnabled,
  parseEngineArg,
  registerActiveEngineKnobGetter,
  resolveCompletionToolChoice,
  tryHandleBenchCommand,
} from "./benchConfig";

const MAX_TOOL_ROUNDS = 3;

describe("retired thinking off value", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async (key: string) => (key === BENCH_THINKING_KEY ? "off" : null),
    );
  });

  test("stored off falls back to default", async () => {
    await expect(getThinkingMode()).resolves.toBe("default");
    await expect(formatBenchStatus()).resolves.toContain("thinking=default");
  });

  test("/bench thinking off is rejected with the live-mode usage", async () => {
    const reply = await tryHandleBenchCommand("/bench thinking off");
    expect(reply).toContain(
      "bench usage: /bench thinking <default|budget256|budget512>",
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

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

  test("parseEngineArg accepts the measured MoE streaming recipe", () => {
    const expected = {
      moeStream: {
        enabled: true,
        cache_mb: 2000,
        cache_auto: false,
        io_threads: 4,
        overlap: true,
        dense_weights: "anon",
      },
    };
    const command = "moe=on,cacheMb=2000,ioThreads=4,overlap=on,dense=anon";
    expect(parseEngineArg(command)).toEqual(expected);
    // tryHandleBenchCommand lowercases its argument before parsing.
    expect(parseEngineArg(command.toLowerCase())).toEqual(expected);
  });

  test("parseEngineArg accepts cacheMb=0, 1500, and 2000", () => {
    for (const value of [0, 1500, 2000]) {
      expect(parseEngineArg(`cacheMb=${value}`)).toEqual({
        moeStream: { cache_mb: value, cache_auto: false },
      });
    }
  });

  test("parseEngineArg rejects cacheMb values from 1 through 1499", () => {
    for (const value of [1, 1499]) {
      expect(parseEngineArg(`cacheMb=${value}`)).toBeNull();
    }
  });

  test("parseEngineArg accepts ioThreads at both bounds", () => {
    expect(parseEngineArg("ioThreads=1")).toEqual({
      moeStream: { io_threads: 1 },
    });
    expect(parseEngineArg("ioThreads=8")).toEqual({
      moeStream: { io_threads: 8 },
    });
  });

  test("parseEngineArg rejects out-of-range ioThreads", () => {
    expect(parseEngineArg("ioThreads=0")).toBeNull();
    expect(parseEngineArg("ioThreads=9")).toBeNull();
  });

  test("parseEngineArg validates all non-numeric MoE values", () => {
    expect(parseEngineArg("dense=anon-gpu")).toEqual({
      moeStream: { dense_weights: "anon-gpu" },
    });
    expect(parseEngineArg("dense=bogus")).toBeNull();
    expect(parseEngineArg("moe=maybe")).toBeNull();
    expect(parseEngineArg("overlap=maybe")).toBeNull();
  });

  test("parseEngineArg accepts independent prefill threads", () => {
    expect(parseEngineArg("threads=2,threadsPrefill=4")).toEqual({
      nThreads: 2,
      nThreadsPrefill: 4,
    });
    expect(parseEngineArg("threadsPrefill=9999")).toEqual({
      nThreadsPrefill: 9999,
    });
    expect(parseEngineArg("threads=2")).not.toHaveProperty("nThreadsPrefill");
  });

  test("parseEngineArg rejects invalid prefill thread values", () => {
    for (const value of ["", "0", "-1", "abc", "2.5", "9007199254740992"]) {
      expect(parseEngineArg(`threadsPrefill=${value}`)).toBeNull();
    }
  });

  test("prefill thread persistence uses the existing engine key", async () => {
    const getItem = AsyncStorage.getItem as jest.Mock;
    const previous = getItem.getMockImplementation();
    getItem.mockResolvedValue(
      JSON.stringify({ nThreads: 2, nThreadsPrefill: 4 }),
    );
    try {
      await expect(getEngineOverride()).resolves.toEqual({
        nThreads: 2,
        nThreadsPrefill: 4,
      });
    } finally {
      if (previous) getItem.mockImplementation(previous);
      else getItem.mockReset();
    }
  });

  test("a full parsed MoE override survives the storage round trip", async () => {
    const command = "moe=on,cacheMb=2000,ioThreads=4,overlap=on,dense=anon";
    const parsed = parseEngineArg(command);
    if (!parsed || parsed === "clear") {
      throw new Error("expected a parsed override");
    }
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify(parsed),
    );
    await expect(getEngineOverride()).resolves.toEqual(parsed);
  });

  test("pending and active labels both show the MoE override", async () => {
    const command = "moe=on,cacheMb=2000,ioThreads=4,overlap=on,dense=anon";
    const parsed = parseEngineArg(command);
    if (!parsed || parsed === "clear") {
      throw new Error("expected a parsed override");
    }
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify(parsed),
    );
    registerActiveEngineKnobGetter(
      () => JSON.stringify({ moeStream: { enabled: false } }),
    );
    try {
      await expect(formatBenchStatus()).resolves.toContain(
        "engine=moe:on,cacheMb:2000,ioThreads:4,overlap:on,dense:anon (ACTIVE: moe:off",
      );
    } finally {
      registerActiveEngineKnobGetter(() => undefined);
    }
  });

  test("stored invalid MoE values are not passed to native", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ moeStream: { cache_mb: 1499 } }),
    );
    await expect(getEngineOverride()).resolves.toBeUndefined();
  });
});
