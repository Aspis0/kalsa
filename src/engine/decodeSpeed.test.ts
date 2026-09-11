import {
  MIN_SAMPLES_BEFORE_EMA,
  __resetDecodeSpeedForTests,
  getDecodeTokPerSec,
  recordDecodeSample,
} from "./decodeSpeed";

describe("decodeSpeed", () => {
  beforeEach(() => {
    __resetDecodeSpeedForTests();
  });

  test("withholds the EMA until the minimum sample count is reached", () => {
    expect(MIN_SAMPLES_BEFORE_EMA).toBe(5);
    for (let i = 0; i < MIN_SAMPLES_BEFORE_EMA - 1; i += 1) {
      recordDecodeSample("lfm", 16, 1000);
      expect(getDecodeTokPerSec("lfm")).toBeNull();
    }
    recordDecodeSample("lfm", 16, 1000);
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(16);
  });

  test("records and blends a per-model EMA once published", () => {
    for (let i = 0; i < MIN_SAMPLES_BEFORE_EMA; i += 1) {
      recordDecodeSample("lfm", 16, 1000);
    }
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(16);
    recordDecodeSample("lfm", 32, 1000);
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(20.8, 5);
  });

  test("ignores samples below the 16-token minimum or with bad timing", () => {
    recordDecodeSample("lfm", 15, 1000);
    recordDecodeSample("lfm", 16, 0);
    recordDecodeSample("lfm", 16, -1);
    recordDecodeSample("lfm", 16, Number.NaN);
    expect(getDecodeTokPerSec("lfm")).toBeNull();

    for (let i = 0; i < MIN_SAMPLES_BEFORE_EMA; i += 1) {
      recordDecodeSample("lfm", 16, 1000);
    }
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(16);
  });

  test("rejected samples do not count toward the publish threshold", () => {
    recordDecodeSample("lfm", 16, 1000);
    recordDecodeSample("lfm", 16, 1000);
    recordDecodeSample("lfm", 15, 1000); // below floor: rejected
    expect(getDecodeTokPerSec("lfm")).toBeNull();
    // 2 accepted so far. One more would publish if the reject counted.
    for (let i = 0; i < MIN_SAMPLES_BEFORE_EMA - 3; i += 1) {
      recordDecodeSample("lfm", 16, 1000);
    }
    expect(getDecodeTokPerSec("lfm")).toBeNull();
    recordDecodeSample("lfm", 16, 1000);
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(16);
  });

  test("reset clears all model measurements", () => {
    for (let i = 0; i < MIN_SAMPLES_BEFORE_EMA; i += 1) {
      recordDecodeSample("lfm", 16, 1000);
    }
    __resetDecodeSpeedForTests();
    expect(getDecodeTokPerSec("lfm")).toBeNull();
  });
});
