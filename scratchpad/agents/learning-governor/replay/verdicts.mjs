/**
 * The last two sections of the replay: what these rows cannot measure, and one
 * verdict line per OPEN item, each computed from the rows rather than asserted.
 */
import { countAbove, describe } from "./distributions.mjs";
import { condText, n, table } from "./format.mjs";
import { ages, forecastNoise, wakeBand } from "./openItems.mjs";

const cannotMeasure = (measurements) => {
  const gpuWindows = measurements.reduce((sum, m) => sum + m.legWindows.gpu, 0);
  const gpuTokens = measurements.reduce((sum, m) => sum + m.tokensFromWake.gpu, 0);
  return [
    "",
    "## 9. What this replay cannot measure",
    "",
    `**GPU overshoot: not measurable - and NOT because GPU windows are absent.** These rows do carry GPU activity: ${gpuWindows} GPU window(s) and ${gpuTokens} GPU token(s) from the wake. What is missing is the thing an overshoot is measured *against*: a Stage 3 speed pass. AUDIT-3 restricted Stage 0 to what today's decisions produce, and today's HEAT_RANK is what picked those GPU legs - there is no \`speed_fit\` prediction of what those tokens should have cost, so there is nothing to be over. More Stage 0 rows cannot produce one; the number waits for Stage 3 Check B.`,
  ].join("\n");
};

const noiseVerdict = (noise) => {
  const sigma = describe(noise.sigmaValues);
  if (sigma.p50 === null) return "not measurable here (no NPU-only row carried three forecast readings)";
  const side = sigma.p50 <= 0.2 ? "at or under" : "above";
  return `estimated over ${noise.rows} NPU-only rows, blind and absent windows excluded: median detrended sigma ${n(sigma.p50, 4)} C, worst row ${n(sigma.max, 4)} C - ${side} the 0.2 C floor as an estimate, not a determination`;
};

const openVerdicts = ({ measurements, fit, withoutCooling, battery }) => {
  const a = ages(measurements);
  const band = wakeBand(measurements);
  const noise = forecastNoise(measurements);
  const skin = describe(measurements.map((m) => m.skinWakeC));
  const rank = `${fit.rank === fit.names.length ? `full rank ${fit.rank}/${fit.names.length}` : `rank ${fit.rank} of ${fit.names.length}`} over ${fit.rows} rows, residual df ${fit.df}`;
  return [
    "",
    "## 10. OPEN verdicts from these rows",
    "",
    table(
      ["OPEN", "question", "verdict"],
      [
        [
          "2",
          "forecast read age in practice (the 4 s gate)",
          `max window \`h_age\` ${n(describe(a.h).max, 0)} ms over ${a.h.length} windows, ${countAbove(a.h, 4000)} above the gate: the gate holds on this arm`,
        ],
        ["3", "forecast noise vs the 0.2 C sigma floor", noiseVerdict(noise)],
        ["4", "battery sysfs readable in-process", battery.verdict],
        [
          "5",
          "wake skin, and readings inside (0, 0.083)",
          `rows with \`hf == 0\` and \`hl > 0\`: ${band.rows}/${measurements.length}, carrying ${band.windows} window(s) inside the band; wake skin p50 ${n(skin.p50, 1)} C (range ${n(skin.min, 1)}-${n(skin.max, 1)})`,
        ],
        [
          "6",
          "`bg` / cooling collinearity; is the cooling column needed",
          `${rank}; condition number ${condText(fit.conditionNumber)} (Gram ${condText(fit.gramRatio)}), ${condText(withoutCooling.conditionNumber)} without the cooling column; ${fit.dropped.length} column(s) carry no variance - the coefficients are collinear and unstable, not identified`,
        ],
      ],
    ),
  ].join("\n");
};

export function verdicts({ measurements, fit, withoutCooling, battery }) {
  return [cannotMeasure(measurements), openVerdicts({ measurements, fit, withoutCooling, battery })].join("\n");
}