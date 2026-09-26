/**
 * Unit tests for the kalsa.bench.eager_delay_ms parse/persist knob.
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
  BENCH_EAGER_DELAY_KEY,
  EAGER_DELAY_MS_MAX,
  getBenchEagerDelayMs,
  parseBenchEagerDelayMs,
  setBenchEagerDelayMs,
} from "./eagerDelay";

describe("parseBenchEagerDelayMs", () => {
  test("absent, empty and non-integer tokens read as 0 (today's kick)", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "  ",
      "abc",
      "1.5",
      "10ms",
      "-5",
      "+5",
    ]) {
      expect(parseBenchEagerDelayMs(raw)).toBe(0);
    }
  });

  test("in-range integers pass through", () => {
    expect(parseBenchEagerDelayMs("0")).toBe(0);
    expect(parseBenchEagerDelayMs("1")).toBe(1);
    expect(parseBenchEagerDelayMs("30000")).toBe(30000);
  });

  test("anything above the max clamps to it", () => {
    expect(parseBenchEagerDelayMs("30001")).toBe(EAGER_DELAY_MS_MAX);
    expect(parseBenchEagerDelayMs("999999999")).toBe(EAGER_DELAY_MS_MAX);
  });
});

describe("getBenchEagerDelayMs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("absent pref reads 0; a stored value reads back", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(getBenchEagerDelayMs()).resolves.toBe(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("8000");
    await expect(getBenchEagerDelayMs()).resolves.toBe(8000);
  });

  test("a seeded out-of-range value still clamps on read", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("60000");
    await expect(getBenchEagerDelayMs()).resolves.toBe(EAGER_DELAY_MS_MAX);
  });

  test("storage failure reads 0", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(getBenchEagerDelayMs()).resolves.toBe(0);
  });
});

describe("setBenchEagerDelayMs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("digits persist canonically under the bench key", async () => {
    await expect(setBenchEagerDelayMs("8000")).resolves.toBe(8000);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      BENCH_EAGER_DELAY_KEY,
      "8000",
    );
  });

  test("0 removes the key instead of storing it", async () => {
    await expect(setBenchEagerDelayMs("0")).resolves.toBe(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(BENCH_EAGER_DELAY_KEY);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test("clear and default remove the key", async () => {
    await expect(setBenchEagerDelayMs("clear")).resolves.toBe(0);
    await expect(setBenchEagerDelayMs("default")).resolves.toBe(0);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(BENCH_EAGER_DELAY_KEY);
  });

  test("invalid tokens return null and write nothing", async () => {
    for (const arg of ["soon", "-5", "1.5", ""]) {
      await expect(setBenchEagerDelayMs(arg)).resolves.toBeNull();
    }
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});
