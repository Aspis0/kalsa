import {
  __resetDecodeSpeedForTests,
  getDecodeTokPerSec,
  recordDecodeSample,
} from "./decodeSpeed";

describe("decodeSpeed", () => {
  beforeEach(() => {
    __resetDecodeSpeedForTests();
  });

  test("records and blends a per-model EMA", () => {
    recordDecodeSample("lfm", 16, 1000);
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

    recordDecodeSample("lfm", 16, 1000);
    expect(getDecodeTokPerSec("lfm")).toBeCloseTo(16);
  });

  test("reset clears all model measurements", () => {
    recordDecodeSample("lfm", 16, 1000);
    __resetDecodeSpeedForTests();
    expect(getDecodeTokPerSec("lfm")).toBeNull();
  });
});
