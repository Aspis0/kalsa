/**
 * The live-decision memory reader (monitor.ts) on iOS: os_proc_available_memory
 * arrives uncached, 0 means zero headroom (app at/over its limit), null means
 * no platform read. Both paths — the cached memoryEstimate helper and this
 * uncached one — must agree on those semantics. On Android the /proc/meminfo
 * path is unchanged from origin/main and still passes a (pathological) 0 kB
 * reading through as 0 — the zero-is-real scope lives in the gates, not here.
 */
const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

const mockAvailableMemoryBytes = jest.fn<Promise<number | null>, []>();
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  getOsAvailableMemoryBytes: () => mockAvailableMemoryBytes(),
}));

const mockReadAsString = jest.fn<Promise<string>, [string]>();
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: (uri: string) => mockReadAsString(uri),
}));

import { getAvailableMemoryBytesUncached } from "./monitor";

describe("getAvailableMemoryBytesUncached on iOS", () => {
  beforeEach(() => {
    mockPlatform.OS = "ios";
    mockAvailableMemoryBytes.mockReset();
  });

  it("passes a 0 reading through as 0", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(0);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(0);
  });

  it("passes a positive reading through unchanged", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(3_141_592_653);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(3_141_592_653);
  });

  it("passes null through when the module is not linked", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(null);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBeNull();
  });

  it("re-reads on every call (no process cache)", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(1_000);
    mockAvailableMemoryBytes.mockResolvedValueOnce(2_000);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(1_000);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(2_000);
    expect(mockAvailableMemoryBytes).toHaveBeenCalledTimes(2);
  });
});

describe("getAvailableMemoryBytesUncached on Android (unchanged /proc path)", () => {
  beforeEach(() => {
    mockPlatform.OS = "android";
    mockReadAsString.mockReset();
  });

  it("parses MemAvailable bytes", async () => {
    mockReadAsString.mockResolvedValue(
      "MemTotal:        8000000 kB\nMemAvailable:     868000 kB\n",
    );
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(868_000 * 1024);
  });

  it("passes a 0 kB reading through as 0, exactly as origin/main", async () => {
    mockReadAsString.mockResolvedValue("MemAvailable:         0 kB\n");
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(0);
  });

  it("re-reads /proc on every call (no process cache)", async () => {
    mockReadAsString.mockResolvedValue("MemAvailable:       100000 kB\n");
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(100_000 * 1024);
    await expect(getAvailableMemoryBytesUncached()).resolves.toBe(100_000 * 1024);
    expect(mockReadAsString).toHaveBeenCalledTimes(2);
  });

  it("returns null on a read failure", async () => {
    mockReadAsString.mockRejectedValue(new Error("no /proc"));
    await expect(getAvailableMemoryBytesUncached()).resolves.toBeNull();
  });
});
