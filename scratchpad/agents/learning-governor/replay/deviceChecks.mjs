/**
 * The DESIGN 3.4 device checks these rows can answer, each compared row by row
 * and each saying so when it has nothing to compare.
 */
import { n, pct, table } from "./format.mjs";

/**
 * DESIGN 3.4 criterion 3: on an unpaced 100 % NPU row the derived NPU tok/s
 * must sit within 10 % of the completion's own `pps`. The candidates are the
 * rows that are unpaced AND spent every decode token on the NPU; each one is
 * compared and given its own verdict, and the section says so when there is
 * nothing to compare rather than implying a pass.
 */
export const speedCheck = (measurements) => {
  const candidates = measurements.filter(
    (m) => m.pacedTokens === 0 && m.legSpeed[2].tokens > 0 && m.legSpeed[0].tokens === 0 && m.legSpeed[1].tokens === 0,
  );
  const paced = measurements.filter((m) => m.pacedTokens > 0).length;
  const compared = candidates
    .map((m) => {
      const derived = m.legSpeed[2].tokPerSec;
      const deltaPct = (derived - m.pps) / m.pps;
      return { row: m.index, derived, pps: m.pps, deltaPct, within: Math.abs(deltaPct) <= 0.1 };
    })
    .filter((entry) => typeof entry.deltaPct === "number" && Number.isFinite(entry.deltaPct));
  return [
    "",
    `**DESIGN 3.4 criterion 3 (speed attribution):** ${candidates.length}/${measurements.length} rows are unpaced 100 % NPU rows; ${paced}/${measurements.length} rows had \`paced.tok > 0\`.`,
    compared.length > 0
      ? table(
          ["row", "NPU tok/s", "pps", "delta", "within 10 %"],
          compared.map((e) => [
            String(e.row),
            n(e.derived, 2),
            n(e.pps, 2),
            `${e.deltaPct >= 0 ? "+" : ""}${(e.deltaPct * 100).toFixed(1)} %`,
            e.within ? "yes" : "NO",
          ]),
        )
      : "No unpaced 100 % NPU row exists in these rows, so the criterion is NOT TESTED here (a paced row's tok/s is below `pps` by construction and would refute nothing).",
    compared.length > 0
      ? `Verdict: ${compared.filter((e) => e.within).length}/${compared.length} candidate rows within 10 %; largest |delta| ${n(Math.max(...compared.map((e) => Math.abs(e.deltaPct))) * 100, 1)} %.`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
};

export const batterySection = (battery) => [
  "",
  "## 6. Battery sysfs vs BatteryManager (OPEN 4)",
  "",
  `Probe readable on ${battery.tempOk}/${battery.rows} rows for temp, ${battery.statusOk}/${battery.rows} for status. Compared: ${battery.tempCompared} temperatures, ${battery.statusCompared} statuses.`,
  battery.tempCompared > 0 || battery.statusCompared > 0
    ? `Within 0.5 C: ${battery.withinHalfC}/${battery.tempCompared} (max delta ${n(battery.maxTempDeltaC, 2)} C). Status agreeing with \`plugged\`: ${battery.statusAgreed}/${battery.statusCompared} (${pct(battery.agreementPct)}), pass needs >= 95 %.`
    : "Nothing to compare: the probe answered on no row, so the 0.5 C and 95 % criteria are untested rather than passed.",
  "",
  `**Verdict: ${battery.verdict}.**`,
].join("\n");

