import * as fs from "fs";
import * as path from "path";
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

  it("sorts unsorted input before anchoring (exported contract)", () => {
    // Same three points, three orders. The answer is 2.0 C/min in every
    // order; an unsorted caller must not get 1.0 or 0.
    const last = 120_000;
    expect(
      trendCPerMin(
        [at(120_000, 350), at(0, 320), at(60_000, 330)],
        last,
      ),
    ).toBeCloseTo(2.0, 9);
    expect(
      trendCPerMin(
        [at(120_000, 350), at(60_000, 330), at(0, 320)],
        last,
      ),
    ).toBeCloseTo(2.0, 9);
  });

  it("reports the floor margins: resolution vs the measured chords", () => {
    // Resolution: one 0.1 C code across the 60 s floor.
    expect(trendCPerMin([at(0, 320), at(60_000, 321)], 60_000)).toBeCloseTo(
      0.1,
      9,
    );
    // Measured on disk (files cited in the source comment): idle flat,
    // load chords +2.0 C and +3.7 C over 60 s - real ramps, above the
    // threshold, intended direction.
    expect(trendCPerMin([at(0, 320), at(60_000, 340)], 60_000)).toBeCloseTo(
      2.0,
      9,
    );
    expect(trendCPerMin([at(0, 320), at(60_000, 357)], 60_000)).toBeCloseTo(
      3.7,
      9,
    );
    // A hypothetical 0.9 C step, kept only as a scaling demo and honestly
    // labelled: it was never a measurement (retired from the source).
    // Derivations: scratchpad/agents/governor-trend-numeric/REPORT.md.
    const step = trendCPerMin([at(0, 320), at(60_000, 329)], 60_000);
    expect(step).toBeCloseTo(0.9, 9);
    expect(1.5 / step).toBeCloseTo(1.67, 2);
  });

  it("describes the estimate as a chord over observed endpoints", () => {
    // Behaviour kept: a chord across a gap with no poll at all reports the
    // true mean rate between the two observed endpoints (+7.2 C / 285 s).
    expect(trendCPerMin([at(0, 320), at(285_000, 392)], 285_000)).toBeCloseTo(
      1.516,
      3,
    );
    const source = fs.readFileSync(
      path.join(__dirname, "governorTrend.ts"),
      "utf8",
    );
    // The over-broad claim is gone; chord semantics and their consequence
    // are stated instead (round-3 item 1).
    expect(source).not.toContain(
      "can never anchor a slope across an interval that was not observed",
    );
    expect(source).toContain("chord between two observed endpoints");
    expect(source).toContain("early escalation");
  });

  it("states measured jiggle with the files it was measured from", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "governorTrend.ts"),
      "utf8",
    );
    // Measured numbers and their files live in the comment...
    expect(source).toContain("out/jelly-energy-baseline-20260916/idle-floor.csv");
    expect(source).toContain("out/t20c-gate-20260916/energy-trace.csv");
    expect(source).toContain("3.7");
    // ...the hypothetical is retired, the derivations stay cited...
    expect(source).not.toContain("this file cites");
    expect(source).not.toContain("sensor excursion");
    expect(source).toContain("scratchpad/agents/governor-trend-numeric/REPORT.md");
    expect(source).not.toContain("far below");
  });

  it("names the true lever: a temperature feed on the poll path", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "governorTrend.ts"),
      "utf8",
    );
    expect(source).toContain("temperature feed on the poll path");
    expect(source).toContain("no temperature column");
    expect(source).not.toContain("real lever is the sampler's cadence");
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
  it("does not anchor a slope across an interval the sensor reported invalid", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    producer.observe("battery", 0, false, 90_000);
    // The invalid poll broke the series: this reading stands alone, so no
    // slope may span the gap in which the sensor reported nothing.
    producer.observe("battery", 335, true, 150_000);
    expect(producer.trend(150_000)).toBe(0);
    // The series rebuilds from observed samples only.
    producer.observe("battery", 350, true, 240_000);
    expect(producer.trend(240_000)).toBeCloseTo(1.0, 9);
  });

  it("keeps a valid series when the other source reports an invalid observation", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    // Foreign AND invalid: not applicable to the battery sensor, must not
    // wipe what battery observed (numeric review probe E4 reported 0).
    producer.observe("bench-skin", 0, false, 30_000);
    producer.observe("battery", 335, true, 60_000);
    expect(producer.trend(60_000)).toBeCloseTo(1.5, 9);
  });

  it("still switches the series on a valid observation from the other source", () => {
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    producer.observe("battery", 335, true, 60_000);
    // Two different sensors must never form one series.
    producer.observe("bench-skin", 400, true, 60_000);
    expect(producer.trend(60_000)).toBe(0);
  });

  it("keeps the chord across a foreign invalid period, with the judgement pinned", () => {
    // Round-3 item 3: foreign invalids do not clear, so the chord spans the
    // bench period. Judged CORRECT; the argument is pinned in the source.
    const producer = createTrendProducer();
    producer.observe("battery", 320, true, 0);
    producer.observe("bench-skin", 0, false, 60_000);
    producer.observe("bench-skin", 0, false, 120_000);
    producer.observe("bench-skin", 0, false, 180_000);
    producer.observe("battery", 380, true, 240_000);
    expect(producer.trend(240_000)).toBeCloseTo(1.5, 9);
    const second = createTrendProducer();
    second.observe("battery", 320, true, 0);
    second.observe("bench-skin", 0, false, 60_000);
    second.observe("bench-skin", 0, false, 120_000);
    second.observe("bench-skin", 0, false, 180_000);
    second.observe("battery", 392, true, 240_000);
    expect(second.trend(240_000)).toBeCloseTo(1.8, 9);
    const source = fs.readFileSync(
      path.join(__dirname, "governorTrend.ts"),
      "utf8",
    );
    expect(source).toContain("as if it never happened");
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
