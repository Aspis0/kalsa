/**
 * The probes the OPEN items are closed with: what the measured rows say about
 * input freshness, the wake band, forecast noise, the forecast's own two
 * headroom fields, and the trip ranges. Plain numbers in, plain numbers out -
 * the report and the verdict block both quote these, so they are computed once.
 */
import { countAbove, describe } from "./distributions.mjs";

/** Every age the rows carry, pooled: the row's first-step forecast age plus
 *  the three per-window ages. */
export function ages(measurements) {
  return {
    hf: measurements.map((m) => m.hfAge),
    h: measurements.flatMap((m) => m.hAge),
    status: measurements.flatMap((m) => m.statusAge),
    app: measurements.flatMap((m) => m.appAge),
  };
}

/** OPEN 5: DESIGN.md:355 closes it on "rows with `hf == 0` and `hl > 0`" -
 *  the row's first-step forecast and the row's own last-read forecast, not the
 *  ring's last window. Counts how many of those rows' windows read inside
 *  (0, 0.083), the band the Stage 0b start line sits in. */
export function wakeBand(measurements) {
  const rows = measurements.filter(
    (m) => m.hFirst === 0 && typeof m.hLastFromRow === "number" && m.hLastFromRow > 0,
  );
  return {
    rows: rows.length,
    windows: rows.reduce(
      (count, m) =>
        count + m.headroom.filter((value) => typeof value === "number" && value > 0 && value < 0.083).length,
      0,
    ),
  };
}

/** OPEN 3: the forecast noise of the NPU-only rows, where no leg change can
 *  move a zone under the reading. Two numbers: the detrended sigma (the
 *  noise) and the successive difference (an upper bound that also carries the
 *  row's real heating). Blind (`h == 0`) and absent (`h == null`) readings
 *  drop out of both, for the same reason they drop out of the fit: they are
 *  not readings. */
export function forecastNoise(measurements) {
  const npuOnly = measurements.filter((m) => m.legSpeed[0].tokens === 0 && m.legSpeed[1].tokens === 0);
  const reading = (value) => typeof value === "number" && value !== 0;
  const successive = [];
  for (const m of npuOnly) {
    for (let i = 1; i < m.headroom.length; i += 1) {
      if (reading(m.headroom[i - 1]) && reading(m.headroom[i])) {
        successive.push(Math.abs(m.headroom[i] - m.headroom[i - 1]) * 30);
      }
    }
  }
  return {
    rows: npuOnly.length,
    sigmaValues: npuOnly.map((m) => m.noise.sigmaC),
    successiveValues: successive,
  };
}

/** The row's `hl` is the forecast the policy last read, which keeps reading
 *  after the ring's last boundary; this measures how far apart the two are.
 *  Only rows where both are numbers are comparable, and only those count
 *  towards the "identical" tally. */
export function forecastFields(measurements) {
  const comparable = measurements.filter(
    (m) => typeof m.hLastFromRow === "number" && typeof m.hLast === "number",
  );
  return {
    compared: comparable.length,
    equal: comparable.filter((m) => m.hLast === m.hLastFromRow).length,
    maxDeltaC: describe(comparable.map((m) => Math.abs(m.hLastFromRow - m.hLast) * 30)).max,
  };
}

/** Each OPEN item's gate result in one place, so the verdict block and the
 *  distribution sections cannot disagree. */
export function gateCounts(measurements) {
  const a = ages(measurements);
  return {
    forecast: `${countAbove(a.h, 4000)}/${a.h.length}`,
    status: `${countAbove(a.status, 10000)}/${a.status.length}`,
    appOldGate: `${countAbove(a.app, 120000)}/${a.app.length}`,
    appBackstop: `${countAbove(a.app, 1200000)}/${a.app.length}`,
  };
}