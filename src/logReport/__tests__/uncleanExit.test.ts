/**
 * The unclean-exit decision and its one-shot consumption: every mapped reason,
 * the foreground/visible importance boundary at 200/201, and the stored
 * timestamp that makes a second ask about the same exit impossible. The native
 * module and AsyncStorage are mocked; nothing here touches Android.
 */
const mockNative = { lastExitInfo: jest.fn() };

jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => mockNative,
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ExitInfo, ExitReason } from "../../../modules/kalsa-lifecycle/src";
import {
  CONSUMED_EXIT_AT_KEY,
  consumeUncleanExitAsk,
  isUncleanExit,
} from "../uncleanExit";

const CRASH_REASONS = ["crash", "crash_native", "anr"] as const;
const FOREGROUND_KILL_REASONS = ["low_memory", "signaled", "excessive_resource_usage"] as const;
const CLEAN_REASONS = ["user_requested", "user_stopped", "exit_self", "other"] as const;
const TIMESTAMP_MS = 1_700_000_000_000;

function record(
  reason: ExitReason,
  importance: number,
  timestampMs = TIMESTAMP_MS,
): ExitInfo {
  return { reason, importance, timestampMs };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.lastExitInfo = jest.fn();
  mockNative.lastExitInfo.mockReturnValue(null);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

describe("isUncleanExit", () => {
  it.each(CRASH_REASONS)("treats a %s death as unclean at any importance", (reason) => {
    expect(isUncleanExit(record(reason, 100))).toBe(true);
    expect(isUncleanExit(record(reason, 400))).toBe(true);
  });

  it.each(FOREGROUND_KILL_REASONS)(
    "treats a %s kill as unclean when the process was at least visible",
    (reason) => {
      expect(isUncleanExit(record(reason, 100))).toBe(true);
      expect(isUncleanExit(record(reason, 200))).toBe(true);
    },
  );

  it.each(FOREGROUND_KILL_REASONS)(
    "treats a %s kill as clean once the process dropped below visible",
    (reason) => {
      expect(isUncleanExit(record(reason, 201))).toBe(false);
      expect(isUncleanExit(record(reason, 400))).toBe(false);
    },
  );

  it.each(CLEAN_REASONS)("treats %s as clean", (reason) => {
    expect(isUncleanExit(record(reason, 100))).toBe(false);
    expect(isUncleanExit(record(reason, 400))).toBe(false);
  });
});

describe("consumeUncleanExitAsk", () => {
  it("asks nothing and stores nothing without a native record", async () => {
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("asks nothing and stores nothing when the native query throws", async () => {
    mockNative.lastExitInfo.mockImplementation(() => {
      throw new Error("bridge down");
    });
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("asks nothing when the native function is not linked", async () => {
    (mockNative as { lastExitInfo?: unknown }).lastExitInfo = undefined;
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("asks about an unclean record newer than the stored one", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("crash", 400));
    await expect(consumeUncleanExitAsk()).resolves.toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CONSUMED_EXIT_AT_KEY,
      String(TIMESTAMP_MS),
    );
  });

  it("does not ask again about a record it already consumed", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("crash", 400));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(String(TIMESTAMP_MS));
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CONSUMED_EXIT_AT_KEY,
      String(TIMESTAMP_MS),
    );
  });

  it("does not ask about an unclean record older than a newer consumed one", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("anr", 100, TIMESTAMP_MS - 1));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(String(TIMESTAMP_MS));
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
  });

  it("stores a clean record without asking", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("user_stopped", 400));
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CONSUMED_EXIT_AT_KEY,
      String(TIMESTAMP_MS),
    );
  });

  it("stores an unrecognized native reason as clean `other`", async () => {
    mockNative.lastExitInfo.mockReturnValue({
      reason: "REASON_FREEZER",
      importance: 100,
      timestampMs: TIMESTAMP_MS,
    });
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CONSUMED_EXIT_AT_KEY,
      String(TIMESTAMP_MS),
    );
  });

  it("asks nothing about a record with mistyped fields", async () => {
    mockNative.lastExitInfo.mockReturnValue({
      reason: "crash",
      importance: "400",
      timestampMs: null,
    });
    await expect(consumeUncleanExitAsk()).resolves.toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("still decides when the stored timestamp cannot be read", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("crash_native", 400));
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error("storage down"));
    await expect(consumeUncleanExitAsk()).resolves.toBe(true);
  });

  it("still answers when storing the consumed timestamp fails", async () => {
    mockNative.lastExitInfo.mockReturnValue(record("crash", 400));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("disk full"));
    await expect(consumeUncleanExitAsk()).resolves.toBe(true);
  });
});
