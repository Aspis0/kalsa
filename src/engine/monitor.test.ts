/**
 * The live-decision memory reader (monitor.ts) on iOS: os_proc_available_memory
 * arrives uncached, 0 means zero headroom (app at/over its limit), null means
 * no platform read. Both paths — the cached memoryEstimate helper and this
 * uncached one — must agree on those semantics.
 */
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

const mockAvailableMemoryBytes = jest.fn<Promise<number | null>, []>();
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  getOsAvailableMemoryBytes: () => mockAvailableMemoryBytes(),
}));

import { getAvailableMemoryBytesUncached } from "./monitor";

describe("getAvailableMemoryBytesUncached on iOS", () => {
  beforeEach(() => {
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
