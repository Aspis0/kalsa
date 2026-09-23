import {
  TREND_WINDOW_MS,
  createTrendProducer,
  trendCPerMin,
} from "./governorTrend";

const at = (tMs: number, tempTenthsC: number) => ({ tMs, tempTenthsC });

describe("trendCPerMin", () => {
  it("reports a rising synthetic series in C per minute", () => {
    const samples = [at(0, 320), at(60_000, 326), at(120_000, 332)];
    expect(trendCPerMin(samples, 120_000)).toBeCloseTo(0.6, 9);
  });

  it("reports a falling series as negative", () => {
    expect(trendCPerMin([at(0, 340), at(120_000, 328)], 120_000)).toBeCloseTo(
      -0.6,
      9,
    );
  });

  it("reports exactly zero for a flat series", () => {
    expect(trendCPerMin([at(0, 320), at(60_000, 320)], 60_000)).toBe(0);
  });

  it("reports zero when there is no second sample (absence)", () => {
    expect(trendCPerMin([], 60_000)).toBe(0);
    expect(trendCPerMin([at(0, 320)], 60_000)).toBe(0);
  });

  it("reports zero when the span is below the quantisation floor", () => {
    // 0.9 C in 30 s would read 1.8 C/min and escalate the engine; the span
    // is too short for the 0.1 C battery-temperature step to be a rate.
    expect(trendCPerMin([at(0, 320), at(30_000, 329)], 30_000)).toBe(0);
  });

  it("reports zero when every sample fell out of the window", () => {
    const nowMs = 10 * 60_000;
    expect(TREND_WINDOW_MS).toBe(5 * 60_000);
    expect(trendCPerMin([at(0, 300), at(30_000, 340)], nowMs)).toBe(0);
  });

  it("drops a stale anchor even when a fresh sample exists", () => {
    const nowMs = 400_000;
    // The old sample is outside the window, so only one fresh sample is
    // left and no honest slope exists.
    expect(trendCPerMin([at(0, 300), at(nowMs, 340)], nowMs)).toBe(0);
  });

  it("anchors on the newest sample old enough, not the oldest", () => {
    const samples = [at(0, 300), at(60_000, 320), at(120_000, 330)];
    // Anchor at 60 s gives 1.0 C/min; the staler pair at 0 would give 1.5.
    expect(trendCPerMin(samples, 120_000)).toBeCloseTo(1.0, 9);
  });

  it("never returns a non-finite trend", () => {
    expect(
      trendCPerMin(
        [{ tMs: Number.NaN, tempTenthsC: 320 }, at(60_000, 330)],
        60_000,
      ),
    ).toBe(0);
    expect(trendCPerMin([at(0, 320), at(60_000, 330)], Number.NaN)).toBe(0);
    expect(
      trendCPerMin([at(0, 320), at(60_000, Number.POSITIVE_INFINITY)], 60_000),
    ).toBe(0);
  });
});

describe("createTrendProducer", () => {
  it("ignores observations from an invalid sensor", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    producer.observe("battery", 0, false, 90_000);
    producer.observe("battery", 326, true, 150_000);
    // The invalid reading never entered the series: 0.6 C over 2.5 min.
    // Had it entered, the anchor would sit on the 0-reading and the slope
    // would read 32.6 C/min.
    expect(producer.trend(150_000)).toBeCloseTo(0.24, 9);
  });

  it("restarts the series when the source changes", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    producer.observe("battery", 326, true, 60_000);
    expect(producer.trend(60_000)).toBeCloseTo(0.6, 9);
    producer.observe("bench-skin", 400, true, 60_000);
    expect(producer.trend(60_000)).toBe(0);
  });

  it("restarts the series when the wall clock goes backwards", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 1_000_000);
    producer.observe("battery", 326, true, 1_090_000);
    expect(producer.trend(1_090_000)).toBeCloseTo(0.4, 9);
    producer.observe("battery", 310, true, 500_000);
    expect(producer.trend(500_000)).toBe(0);
    producer.observe("battery", 316, true, 560_000);
    expect(producer.trend(560_000)).toBeCloseTo(0.6, 9);
  });

  it("drops samples outside the window while observing", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 300, true, 0);
    producer.observe("battery", 340, true, 400_000);
    expect(producer.trend(400_000)).toBe(0);
  });
});
