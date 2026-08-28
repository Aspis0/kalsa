import {
  isSwapDistressed,
  majfltGrewBy,
  parseProcessMajflt,
  parseProcessMemorySample,
  residentHeadroomBytes,
  swapGrewBy,
  SWAP_DISTRESS_BYTES,
} from "../memoryPressure";

/** Shape of a real /proc/self/status, trimmed to the fields we read. */
const STATUS = [
  "Name:\tcom.kalsa.app",
  "VmRSS:\t  171088 kB",
  "RssAnon:\t   95000 kB",
  "RssFile:\t  136000 kB",
  "RssShmem:\t       0 kB",
  "VmSwap:\t   26000 kB",
].join("\n");

/** /proc/self/stat with a process name containing a space. */
const STAT_WITH_SPACED_NAME =
  "12345 (kalsa worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13";

describe("parseProcessMemorySample", () => {
  it("reads the status fields and majflt", () => {
    expect(parseProcessMemorySample(STATUS, STAT_WITH_SPACED_NAME)).toEqual({
      rssFileBytes: 136000 * 1024,
      rssAnonBytes: 95000 * 1024,
      vmSwapBytes: 26000 * 1024,
      majflt: 9,
    });
  });

  it("does not confuse RssAnon with RssShmem or VmRSS", () => {
    const s = parseProcessMemorySample(STATUS);
    expect(s.rssAnonBytes).toBe(95000 * 1024);
    expect(s.rssFileBytes).not.toBe(171088 * 1024);
  });

  it("yields the other fields when one is absent", () => {
    const noSwap = STATUS.split("\n")
      .filter((l) => !l.startsWith("VmSwap:"))
      .join("\n");
    const s = parseProcessMemorySample(noSwap);
    expect(s.vmSwapBytes).toBeNull();
    expect(s.rssFileBytes).toBe(136000 * 1024);
    expect(s.majflt).toBeNull();
  });

  it("is null on garbage rather than NaN", () => {
    expect(parseProcessMemorySample("RssFile:\tnope kB")).toEqual({
      rssFileBytes: null,
      rssAnonBytes: null,
      vmSwapBytes: null,
      majflt: null,
    });
    expect(parseProcessMemorySample("")).toEqual({
      rssFileBytes: null,
      rssAnonBytes: null,
      vmSwapBytes: null,
      majflt: null,
    });
  });
});

describe("parseProcessMajflt", () => {
  it("handles a process name with spaces inside the parentheses", () => {
    expect(parseProcessMajflt(STAT_WITH_SPACED_NAME)).toBe(9);
  });

  it("returns null for malformed, short, or negative counters", () => {
    expect(parseProcessMajflt("garbage")).toBeNull();
    expect(parseProcessMajflt("12345 (kalsa worker) S 1 2")).toBeNull();
    expect(
      parseProcessMajflt(STAT_WITH_SPACED_NAME.replace(" 7 8 9 ", " 7 8 -1 ")),
    ).toBeNull();
  });
});

describe("residentHeadroomBytes", () => {
  it("subtracts the model's own page cache from MemAvailable", () => {
    // 4.02 GB available, 3.0 GB of it is this process's mapped weights.
    expect(residentHeadroomBytes(4_020_000_000, 3_000_000_000)).toBe(
      1_020_000_000,
    );
  });

  it("never goes negative", () => {
    expect(residentHeadroomBytes(1_000, 5_000)).toBe(0);
  });

  it("is null when either input is unknown — never substitutes a guess", () => {
    expect(residentHeadroomBytes(null, 1)).toBeNull();
    expect(residentHeadroomBytes(1, null)).toBeNull();
    expect(residentHeadroomBytes(Number.NaN, 1)).toBeNull();
  });

  it("is the point of the module: the un-subtracted number flatters", () => {
    // §7.44: MemAvailable counts the model's resident weights as headroom.
    const memAvailable = 3_190_000_000;
    const modelResident = 3_000_000_000;
    expect(memAvailable).toBeGreaterThan(2_000_000_000); // looks roomy
    expect(residentHeadroomBytes(memAvailable, modelResident)).toBeLessThan(
      200_000_000, // actually is not
    );
  });
});

describe("swapGrewBy / isSwapDistressed", () => {
  it("measures growth against the baseline", () => {
    // §7.18: VmSwap went 26 MB -> 1.02 GB during a GPU offload turn.
    const grown = swapGrewBy(26 * 1024 * 1024, 1_020 * 1024 * 1024);
    expect(grown).toBe(994 * 1024 * 1024);
    expect(isSwapDistressed(grown)).toBe(true);
  });

  it("does not report negative growth when swap is reclaimed", () => {
    expect(swapGrewBy(500, 100)).toBe(0);
  });

  it("is null when either sample is unknown", () => {
    expect(swapGrewBy(null, 100)).toBeNull();
    expect(swapGrewBy(100, null)).toBeNull();
  });

  it("is not distressed below the threshold, nor on null", () => {
    expect(isSwapDistressed(SWAP_DISTRESS_BYTES - 1)).toBe(false);
    expect(isSwapDistressed(SWAP_DISTRESS_BYTES)).toBe(true);
    expect(isSwapDistressed(null)).toBe(false);
  });
});

describe("majfltGrewBy", () => {
  it("measures major-fault growth against the session baseline", () => {
    expect(majfltGrewBy(10, 25)).toBe(15);
  });

  it("does not report negative growth when the counter goes backwards", () => {
    expect(majfltGrewBy(25, 10)).toBe(0);
  });

  it("is null when either sample is unknown", () => {
    expect(majfltGrewBy(null, 10)).toBeNull();
    expect(majfltGrewBy(10, null)).toBeNull();
  });
});
