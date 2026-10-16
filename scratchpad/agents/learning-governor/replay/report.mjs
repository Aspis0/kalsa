/**
 * Render the replay report's measurement sections: what each row did, the
 * derived wake, the freshness distributions, the forecast noise, the zones,
 * the battery probe and the heat fit (DESIGN 3.3).
 */
import { describe } from "./distributions.mjs";
import { condText, distLine, n, pct, s, table, tripText } from "./format.mjs";
import { HEAT_FEATURES } from "./perRow.mjs";
import { batterySection, speedCheck } from "./deviceChecks.mjs";
import { ages, forecastFields, forecastNoise, gateCounts, wakeBand } from "./openItems.mjs";
import { LEGS } from "./rows.mjs";

const wakeText = (index) => (index < 0 ? "-" : String(index));

const header = ({ source, lines, rows, droppedGap, measurements }) => [
  `# Learning-governor Stage 0 replay - ${rows[0].fp.model} on ${rows[0].fp.soc}`,
  "",
  `Source \`${source}\`: ${lines} rows, ${rows.length} used, ${droppedGap.length} gap rows dropped, ${measurements.reduce((sum, m) => sum + m.windows, 0)} window samples.`,
  `Producer: binding pin \`${rows[0].fp.pin}\`; state {${[...new Set(rows.map((r) => r.state))].join(", ")}}, source {${[...new Set(rows.map((r) => r.src))].join(", ")}}, rule {${[...new Set(rows.map((r) => s(r.rule)))].join(", ")}}.`,
  "",
  "## 1. Rows, legs and speed",
  "",
  table(
    ["row", "turn", "round", "pred_n", "win", "wall min", "paced tok", "decode tok/s", "pps", "wake win", "h_wake", "skin_wake C", "h_first", "h_last", "blind", "y C"],
    measurements.map((m) => [
      s(m.index),
      s(m.turn),
      s(m.round),
      s(m.predN),
      s(m.windows),
      n(m.wallMin, 2),
      s(m.pacedTokens),
      m.legSpeed.filter((leg) => leg.tokens > 0).map((leg) => `${leg.leg} ${n(leg.tokPerSec, 2)}`).join(", ") || "none",
      n(m.pps, 2),
      wakeText(m.wakeIndex),
      n(m.hWake, 4),
      n(m.skinWakeC, 1),
      n(m.hFirst, 4),
      n(m.hLast, 4),
      s(m.blindWindows),
      n(m.targetC, 2),
    ]),
  ),
  "",
  `Per-leg speed is \`tok x 1e6 / us\` (DESIGN 3.3). The ring's boundary steps across all rows: ${[...new Set(measurements.flatMap((m) => m.steps))].join(", ")} tokens.`,
  speedCheck(measurements),
].join("\n");

const wakeSection = (measurements) => {
  const sum = (leg) => measurements.reduce((total, m) => total + m.tokensFromWake[leg], 0);
  return [
    "",
    "## 2. Derived wake start and tokens from the wake",
    "",
    "The wake is the first window whose forecast headroom is `> 0`: `h == 0` is blind (a real reading) and `h == null` is an absent forecast, and only the transition out of blind defines a wake. A window's tokens are the difference of consecutive cumulative boundaries, attributed to the leg of its END boundary (`leg_prev`).",
    "",
    table(
      ["row", "wake win", "blind win", "absent win", "npu tok", "gpu tok", "cpu tok", "coolmode tok", "unattr tok", "window tok", "decode tok", "window coverage"],
      measurements.map((m) => [
        s(m.index),
        wakeText(m.wakeIndex),
        s(m.blindWindows),
        s(m.absentWindows),
        s(m.tokensFromWake.npu),
        s(m.tokensFromWake.gpu),
        s(m.tokensFromWake.cpu),
        s(m.tokensFromWake.coolmode),
        s(m.tokensFromWake.unattributed),
        s(m.tokensCoveredByWindows),
        s(m.decodeTokens),
        pct(m.decodeTokens > 0 ? m.tokensCoveredByWindows / m.decodeTokens : null),
      ]),
    ),
    "",
    `From the wake, all rows: ${sum("npu")} npu, ${sum("gpu")} gpu, ${sum("cpu")} cpu, ${sum("coolmode")} gpu-coolmode, ${sum("unattributed")} unattributed tokens. The ring stops at the last boundary, so a completion's last partial window is never in these counts - hence the coverage column below 100 %.`,
  ].join("\n");
};

const ageSection = (measurements) => {
  const a = ages(measurements);
  const gates = gateCounts(measurements);
  const band = wakeBand(measurements);
  const fields = forecastFields(measurements);
  return [
    "",
    "## 3. Freshness distributions (OPEN 2) and the wake skin (OPEN 5)",
    "",
    "- " + distLine("`hf_age` per row, ms", a.hf),
    "- " + distLine("window `h_age`, ms", a.h),
    "- " + distLine("window `status_age`, ms", a.status),
    "- " + distLine("window `app_age`, ms", a.app),
    "",
    `Against the DESIGN 5.1 gates: window \`h_age\` above the 4000 ms forecast-read gate ${gates.forecast}; window \`status_age\` above the 10000 ms status gate ${gates.status}; window \`app_age\` above the old 120000 ms gate ${gates.appOldGate} and above the 1200000 ms backstop of DESIGN-ADDENDUM Item B ${gates.appBackstop}.`,
    "",
    `Wake skin (AOSP map skin = 36.5 + 30 h): ${distLine("skin at the wake sample, C", measurements.map((m) => m.skinWakeC), 1)}.`,
    `OPEN 5 test - rows with \`h_first == 0\` and \`h_last > 0\`: ${band.rows}/${measurements.length} rows, carrying ${band.windows} window(s) reading strictly between 0 and 0.083 (\`headroomAt(39.0 C, 66.5)\`, the Stage 0b start line).`,
    `The row field \`hl\` is the forecast the policy last read, and the policy keeps reading after the ring's last boundary: identical on ${fields.equal} of the ${fields.compared} comparable rows and within ${n(fields.maxDeltaC, 3)} C on every one of them${fields.compared < measurements.length ? ` (the other ${measurements.length - fields.compared} row(s) have no ring to compare against)` : ""} (the signs differ because the forecast keeps moving after the boundary).`,
  ].join("\n");
};

const noiseSection = (measurements) => {
  const { rows, sigmaValues, successiveValues } = forecastNoise(measurements);
  const sigma = describe(sigmaValues);
  return [
    "",
    "## 4. Forecast noise (OPEN 3)",
    "",
    `${distLine("Per-row detrended noise sigma, C (NPU-only rows)", sigmaValues, 4)} over ${rows} rows.`,
    `${distLine("Successive |delta h| per window, C (upper bound)", successiveValues, 4)}.`,
    "",
    `Blind (\`h == 0\`) and absent (\`h == null\`) windows are excluded from both lines: a floor is not a reading. ${successiveValues.length} of the windows supplied a successive difference.`,
    "",
    `The successive difference mixes real heating with forecast noise, so it is an upper bound and not a noise measurement; the detrended residual of each row's own trend is the noise. Over ${rows} NPU-only rows the median sigma is ${n(sigma.p50, 4)} C (worst row ${n(sigma.max, 4)} C) - ${
      sigma.p50 === null
        ? "not measurable here."
        : `${sigma.p50 <= 0.2 ? "at or under" : "above"} the DESIGN 5.6 residual-sigma floor of 0.2 C, as an ESTIMATE over ${rows} rows, not a determination of the forecast's true noise.`
    } Closing this item needs rows whose forecast is quiet - a cold or idle stretch, where the trend is small enough for the residual to mean what it says.`,
  ].join("\n");
};

const zoneSection = (rows, measurements) => {
  const perLeg = LEGS.map((leg) => {
    const legs = measurements.map((m) => m.rise[leg]);
    const finite = legs.filter((r) => r.pairs > 0);
    return {
      leg,
      pairs: legs.reduce((sum, r) => sum + r.pairs, 0),
      dark: legs.reduce((sum, r) => sum + r.dark, 0),
      min: finite.length > 0 ? Math.min(...finite.map((r) => r.min)) : null,
      max: finite.length > 0 ? Math.max(...finite.map((r) => r.max)) : null,
      hotMax: Math.max(
        ...rows.flatMap((row) => row.win.map((w) => w[{ cpu: 7, gpu: 9, npu: 8 }[leg]]))
          .filter((value) => typeof value === "number"),
      ),
    };
  });
  const trips = [...new Set(rows.map((row) => tripText(row.trips)))];
  return [
    "",
    "## 5. Zone hot temperatures and trip ranges",
    "",
    table(
      ["leg", "rise pairs", "dark-zone pairs dropped", "rise min C", "rise max C", "observed hot max C"],
      perLeg.map((r) => [r.leg, s(r.pairs), s(r.dark), n(r.min, 2), n(r.max, 2), n(r.hotMax, 1)]),
    ),
    "",
    "A null zone temperature is a dark zone (one dark zone makes the whole leg unknown), so that pair is dropped from zone statistics rather than counted as a zero rise. A row's first pair mixes the first decode step's own idle sample with the first loaded window, which is where the largest single rise comes from.",
    `Trip ranges \`[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]\` in C: ${trips.length === 1 ? `every row \`${trips[0]}\`` : `${trips.length} distinct vectors: ${trips.map((t) => `\`${t}\``).join(" ")}`}. A null entry is a leg whose zones the phone does not report.`,
  ].join("\n");
};

const coefficient = (result, name) => {
  if (result.dropped.includes(name)) return "not identifiable";
  const index = result.names.indexOf(name);
  return index < 0 ? "-" : n(result.coefficients[index], 3);
};

/**
 * OPEN 6 is two questions: is the design collinear, and is the cooling column
 * needed. Rank answers the first honestly - a full rank says nothing about
 * conditioning - and the drop-column comparison answers the second by showing
 * how far a coefficient moves when one column leaves.
 */
const openSix = (fit, withoutCooling) => {
  const fullRank = fit.rank === fit.names.length;
  const rank = fullRank
    ? `The design is FULL RANK (${fit.rank} of ${fit.names.length} columns, ${fit.rows} rows, ${fit.df} residual degrees of freedom) - no column is mathematically unidentifiable here - but it is ILL-CONDITIONED: condition number ${condText(fit.conditionNumber)} against ${condText(withoutCooling.conditionNumber)} without the cooling column.`
    : `The design is RANK DEFICIENT (rank ${fit.rank} of ${fit.names.length} columns over ${fit.rows} rows): the collinear columns cannot be told apart at all.`;
  const dropped = fit.dropped.length > 0
    ? ` ${fit.dropped.join(", ")} carry no variance on these rows and are reported as not identifiable; Stage 0 rows do not spend those tokens, so no Stage 0 row set will fix that.`
    : "";
  return `${rank} Dropping the cooling column moves \`npu_k\` from ${coefficient(fit, "npu_k")} to ${coefficient(withoutCooling, "npu_k")} C per 1k tokens and \`wall_min\` from ${coefficient(fit, "wall_min")} to ${coefficient(withoutCooling, "wall_min")} C per minute, so the cooling term and the token/time columns are fighting over the same variance: the individual coefficients are UNSTABLE ESTIMATES and none of them should be read as a heat number yet.${dropped}`;
};

const fitSection = ({ measurements, fit, withoutCooling }) => {
  const excluded = measurements.filter((m) => m.fitExclusion !== null);
  return [
    "",
    "## 7. Heat fit of DESIGN 5.6, and the collinearity of OPEN 6",
    "",
    `Rows entering the fit: ${fit.rows}/${measurements.length}. Excluded: ${excluded.length}${
      excluded.length > 0 ? ` - ${[...new Set(excluded.map((m) => m.fitExclusion))].join("; ")}` : ""
    }.`,
    "",
    "Target `y = 30 x (h_last - h_wake)` in C (the platform forecast's implied skin change over the observed span), with per-leg tokens counted from the wake, per DESIGN 5.6's \"observation from the wake sample\". `prefill_gpu_k` counts the prompt tokens only when every prefill chunk named a GPU device; with the device labels absent it is 0, which is why it is not identifiable below.",
    "",
    table(
      ["column", "unit", "coefficient", "same fit without cool"],
      HEAT_FEATURES.map(({ name, unit }) => [name, unit, coefficient(fit, name), coefficient(withoutCooling, name)]),
    ),
    "",
    `- rank ${fit.rank} of ${fit.names.length} columns over ${fit.rows} rows; dropped as identically zero: ${fit.dropped.join(", ") || "none"}; residual df ${fit.df}`,
    `- condition number of the scaled design matrix (s(max)/s(min)): ${condText(fit.conditionNumber)} with the cooling column, ${condText(withoutCooling.conditionNumber)} without it (Gram ratio, its square: ${condText(fit.gramRatio)} and ${condText(withoutCooling.gramRatio)})`,
    `- residual sigma ${n(fit.residualSigmaC, 4)} C, max |residual| ${n(fit.maxAbsResidualC, 4)} C (sigma floor 0.2 C, outlier cut max(1.0 C, 3 sd), both from DESIGN 5.6)`,
    "",
    "**The condition-number convention**, because the number is meaningless without it: each predictor column is scaled to unit L2 norm and the intercept column is left at 1; the reported figure is the 2-norm condition number of THAT design matrix. The Gram ratio printed beside it is its square - an eigen-decomposition of X'X yields squared singular values, so a reader comparing against a design-matrix figure wants the square root.",
    "",
    `**OPEN 6 verdict.** ${openSix(fit, withoutCooling)}`,
  ].join("\n");
};

const prefillSection = (prefill) => {
  const lines = [
    "",
    "## 8. Per-device prefill attribution (M4 row fields)",
    "",
    `${prefill.rowsWithM4}/${prefill.rows} rows carry \`prefill_ms\`; the other ${prefill.rowsMissingM4} were written before the M4 builder and name no prefill time or device. Device cases over all rows: ${Object.entries(prefill.deviceCases).map(([name, count]) => `${name} ${count}`).join(", ")}.`,
  ];
  if (prefill.devices.length > 0) {
    lines.push(
      "",
      "Per DEVICE, because the device is what the heat question asks about. Each row contributes only its own \`prompt_n\` and its own \`prefill_ms\`:",
      "",
      table(
        ["device", "rows", "prompt tok", "prefill ms", "prefill tok/s"],
        prefill.devices.map((device) => [
          device.device,
          String(device.rows),
          String(device.promptTokens),
          n(device.prefillMs, 0),
          n(device.prefillTokPerSec, 1),
        ]),
      ),
    );
  } else {
    lines.push("", "No row carries both a prefill time and a device label, so there is no per-device rate to report: an absent rate is not a zero rate.");
  }
  if (prefill.perRow.length > 0) {
    lines.push(
      "",
      "The rows that carry the fields, each on its own:",
      "",
      table(
        ["row", "turn", "route label", "device(s)", "prompt tok", "prefill ms", "prefill tok/s"],
        prefill.perRow.map((row) => [
          String(row.index),
          String(row.turn),
          row.route ?? "-",
          (row.devices ?? []).join(",") || "-",
          String(row.promptTokens),
          n(row.prefillMs, 0),
          n(row.prefillTokPerSec, 1),
        ]),
      ),
    );
  }
  if (prefill.unattributable.length > 0) {
    lines.push(
      "",
      `Rows whose device label names no single device (${prefill.unattributable.map((row) => row.index).join(", ")}): their prompt tokens are not attributed to any device.`,
    );
  }
  lines.push(
    "",
    ...prefill.agreements.map((text) => `- ${text}`),
    "",
    "`engine_prefill` is the ROUTE's label and `prefill_dev` the device that ran the layers: a phone NPU load reads `GPU` on the route while Hexagon runs the matmuls, so the heat question needs the device column. `prompt_n` is what each completion reported, so a cached prefix is counted once per round.",
  );
  return lines.join("\n");
};

export function render({ source, lines, rows, droppedGap, measurements, fit, withoutCooling, battery, prefill, verdicts }) {
  return [
    header({ source, lines, rows, droppedGap, measurements }),
    wakeSection(measurements),
    ageSection(measurements),
    noiseSection(measurements),
    zoneSection(rows, measurements),
    batterySection(battery),
    fitSection({ measurements, fit, withoutCooling }),
    prefillSection(prefill),
    verdicts,
  ].join("\n");
}