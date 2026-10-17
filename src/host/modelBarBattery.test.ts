/**
 * The advisory battery lines (`AppShell.tsx:2793-2830`), driven against the
 * shipped catalogues: the four gates (ready, API, percent, 50 %), the charging
 * and low-eta bands, and every battery key in both languages. Split out of
 * `modelBar.test.ts` by topic, under the file-size ratchet.
 */
import { makeT, en, it as italian } from "../i18n";
import type { BatteryEtaUiState } from "../hooks/useBatteryEta";
import { buildBatteryLines } from "./modelBar";

const t = makeT("en");

function eta(overrides: Partial<BatteryEtaUiState> = {}): BatteryEtaUiState {
  return {
    kind: "unknown",
    batteryPercent: 40,
    charging: false,
    sampledAt: 1,
    apiAvailable: true,
    ...overrides,
  };
}

describe("the advisory battery lines (App:2793-2830)", () => {
  it("four gates, each of which drops the line entirely", () => {
    // Not ready.
    expect(buildBatteryLines(eta(), "missing", t)).toEqual([]);
    // Native API unreachable.
    expect(buildBatteryLines(eta({ apiAvailable: false }), "ready", t)).toEqual([]);
    // Percent unknown.
    expect(buildBatteryLines(eta({ batteryPercent: null }), "ready", t)).toEqual([]);
    // Above 50 %: the advisory is for the risky half of the dial.
    expect(buildBatteryLines(eta({ batteryPercent: 51 }), "ready", t)).toEqual([]);
    // …and at exactly 50 it shows.
    expect(buildBatteryLines(eta({ batteryPercent: 50 }), "ready", t)).toHaveLength(1);
  });

  it("charging says charging, one muted line, even at a low percent", () => {
    const lines = buildBatteryLines(
      eta({ batteryPercent: 15, charging: true, kind: "charging" }),
      "ready",
      t,
    );
    expect(lines).toEqual([{ text: en.chat.batteryCharging, tone: "muted" }]);
  });

  it("a low eta renders the band AND the warning line, worst tone first", () => {
    const lines = buildBatteryLines(
      eta({
        batteryPercent: 15,
        kind: "eta",
        lowHours: 0.5,
        highHours: 1.5,
      }),
      "ready",
      t,
    );
    expect(lines).toHaveLength(2);
    // The controller COLLAPSES a sub-hour low end onto the upper bound rather
    // than rendering "less than 1 hour-1 h 30 min" (AppShell.tsx:2781-2787:
    // "when the low end is sub-hour but the high is a whole band, surface the
    // upper bound... rather than the awkward 'less than 1 h-1 h'"). An earlier
    // draft of this test asserted the opposite and was wrong about the port.
    expect(lines[0].text).toBe(
      en.chat.batteryEstimate.replace("{time}", `~1 h 30 min`),
    );
    expect(lines[0].tone).toBe("bad");
    expect(lines[1]).toEqual({ text: en.chat.batteryLowWarning, tone: "bad" });
  });

  it("a sub-hour band collapses to the upper bound, and both ends equal renders once", () => {
    const collapsed = buildBatteryLines(
      eta({ batteryPercent: 15, kind: "eta", lowHours: 0.4, highHours: 2 }),
      "ready",
      t,
    );
    expect(collapsed[0].text).toBe(en.chat.batteryEstimate.replace("{time}", "~2 h"));
    const single = buildBatteryLines(
      eta({ batteryPercent: 40, kind: "eta", lowHours: 0.5, highHours: 0.5 }),
      "ready",
      t,
    );
    expect(single[0].text).toBe(
      en.chat.batteryEstimate.replace("{time}", `~${en.chat.batteryLessThanHour}`),
    );
  });

  it("a non-low eta is one muted line; the warning needs eta, not just low", () => {
    const high = buildBatteryLines(
      eta({ batteryPercent: 30, kind: "eta", lowHours: 2, highHours: 2 }),
      "ready",
      t,
    );
    expect(high).toEqual([
      { text: en.chat.batteryEstimate.replace("{time}", "~2 h"), tone: "muted" },
    ]);
    const measuringLow = buildBatteryLines(
      eta({ batteryPercent: 15, kind: "measuring" }),
      "ready",
      t,
    );
    expect(measuringLow).toEqual([
      { text: en.chat.batteryMeasuring, tone: "muted" },
    ]);
  });

  it("the measuring and unknown fallbacks are the catalogue's own words", () => {
    expect(buildBatteryLines(eta({ kind: "measuring" }), "ready", t)[0].text).toBe(
      en.chat.batteryMeasuring,
    );
    expect(buildBatteryLines(eta({ kind: "unknown" }), "ready", t)[0].text).toBe(
      en.chat.batteryUnknown,
    );
    expect(buildBatteryLines(eta({ kind: "eta", lowHours: 0.2, highHours: 0.2 }), "ready", t)[0].text).toBe(
      en.chat.batteryEstimate.replace(
        "{time}",
        `~${en.chat.batteryLessThanHour}`,
      ),
    );
  });

  it("every battery key exists, non-empty, in BOTH catalogues", () => {
    for (const key of [
      "batteryEstimate",
      "batteryMeasuring",
      "batteryCharging",
      "batteryUnknown",
      "batteryLessThanHour",
      "batteryLowWarning",
    ] as const) {
      expect([key, typeof en.chat[key], typeof italian.chat[key]]).toEqual([
        key,
        "string",
        "string",
      ]);
      expect(en.chat[key].length).toBeGreaterThan(0);
      expect(italian.chat[key].length).toBeGreaterThan(0);
    }
  });
});
