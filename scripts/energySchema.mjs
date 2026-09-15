// Shared energy-metric schema: CSV parsing, power integration, and the
// CodeCarbon-compatible export row. Extracted from energyAggregate.mjs so the
// reserved per-rep phase splitter (energyPhaseSplit.mjs) and any future
// aggregator parse the same bytes the same way.
//
// Sampler CSV v1 (scripts/energy-sample.sh, on-device, ~1 Hz nominal):
//   t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz
// t_s is /proc/uptime on the device: monotonic within one boot, so durations
// are exact but t is NOT wall-clock — exported timestamps are the host-side
// generation time, not the sample time. cpu_freqs_kHz is colon-joined across
// CPUs.
//
// Audit hardening (deepseek-v4.1 audit of c5fae2f) moved here verbatim:
// torn last line (pull during write) is dropped; strict field regex, rows
// that do not parse are dropped and counted in `skipped`; monotonic t is
// enforced (a row with t <= previous — device reboot — is dropped with a
// warning instead of yielding negative durations); per-metric valid counts so
// a failed read cannot dilute a mean; power sanity band 0.1-20 W.
//
// METRIC IS RELATIVE: power = |V*I| at the battery terminal with ~1 s gauge
// smoothing, and the sampling window includes load+prefill. Compare BETWEEN
// ARMS of the same (model, prompt) only; never quote absolute J/token.
//
// Provenance: CodeCarbon column NAMES are adopted for export compatibility
// only — this file is written from scratch, no code from the AGPL
// LLM-energy-benchmark repository (see docs/ENERGY-SCHEMA.md).

const ROW = /^(\d+\.\d+),(-?\d*),(-?\d*),(-?\d*),([^,]*),([:\d]*)$/;

export function parseEnergyCsv(text) {
  const torn = !text.endsWith("\n");
  if (torn) text = text.slice(0, text.lastIndexOf("\n") + 1); // drop torn tail
  const rows = [];
  let skipped = 0;
  for (const l of text.split("\n")) {
    if (!l || l.startsWith("t_s,")) continue;
    const m = l.match(ROW);
    if (m) rows.push({ t: parseFloat(m[1]), i: m[2], v: m[3], f: m[6] });
    else skipped++;
  }
  return { rows, torn, skipped };
}

// Right-Riemann integration over the ~1 Hz samples; i/v stay raw strings in
// rows and are parsed here so a failed read (empty field) can be skipped per
// metric. sum_cpu_khz_min is Infinity when no CPU clock was ever read —
// callers render that as n/a.
export function integrate(rows) {
  let joules = 0, wsum = 0, nP = 0, fwsum = 0, nF = 0, fmin = Infinity;
  let dur = 0, tPrev = rows.length ? rows[0].t : 0, tReg = 0;
  for (const r of rows) {
    if (r.t < tPrev) { tReg++; continue; } // non-monotonic (reboot): drop
    const dt = r.t - tPrev;
    tPrev = r.t;
    dur += dt;
    const cur = Math.abs(parseFloat(r.i));
    const volt = Math.abs(parseFloat(r.v));
    if (Number.isFinite(cur) && Number.isFinite(volt) && cur !== 0 && volt !== 0) {
      const p = (cur * volt) / 1e12; // uA*uV -> W
      joules += p * dt;
      wsum += p;
      nP++;
    }
    const freqSum = (r.f || "").split(":").reduce((s, x) => s + (parseInt(x) || 0), 0);
    if (freqSum > 0) { fwsum += freqSum; nF++; if (freqSum < fmin) fmin = freqSum; }
  }
  const meanW = nP ? wsum / nP : NaN;
  const warnings = [];
  if (Number.isFinite(meanW) && (meanW < 0.1 || meanW > 20)) {
    warnings.push(`mean W ${meanW.toFixed(2)} outside the 0.1-20 W sanity band (unit mismatch?)`);
  }
  if (tReg) warnings.push(`dropped ${tReg} non-monotonic row(s)`);
  return {
    duration_s: dur,
    mean_w: meanW,
    joules,
    n_power: nP,
    sum_cpu_khz_mean: nF ? fwsum / nF : NaN,
    sum_cpu_khz_min: fmin,
    warnings,
  };
}

// CodeCarbon-compatible export subset: column names follow CodeCarbon's
// emissions CSV so the files can be ingested by tooling that expects it.
// cpu_power/cpu_energy cover the whole SoC (battery-terminal measurement —
// there is no separate ram/gpu column; do not invent one).
export const EMISSIONS_COLUMNS = [
  "timestamp", "project_name", "run_id", "duration_seconds",
  "cpu_power", "cpu_energy", "emissions",
  "os", "cpu_count", "cpu_model",
];

// gridGPerKwh: grid intensity in gCO2eq/kWh. Battery-powered runs pass
// undefined → the emissions column stays empty (no grid factor to apply).
// cpu_energy is kWh, CodeCarbon's unit: J / 3.6e6.
export function toEmissionsRow({ stem, duration_s, mean_w, joules, now = new Date(), gridGPerKwh }) {
  const kwh = Number.isFinite(joules) ? joules / 3.6e6 : NaN;
  return {
    timestamp: now.toISOString(), // generation time; CSV t_s is device uptime
    project_name: "kalsa",
    run_id: stem,
    duration_seconds: Number.isFinite(duration_s) ? duration_s.toFixed(2) : "",
    cpu_power: Number.isFinite(mean_w) ? mean_w.toFixed(2) : "",
    cpu_energy: Number.isFinite(kwh) ? String(kwh) : "",
    emissions:
      Number.isFinite(kwh) && Number.isFinite(gridGPerKwh)
        ? String((kwh * gridGPerKwh) / 1000) // gCO2eq/kWh -> kgCO2eq
        : "",
    os: "Android",
    cpu_count: "",
    cpu_model: "",
  };
}

export function toEmissionsCsv(rows) {
  const esc = (x) => (/[",\n]/.test(x) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
  return [
    EMISSIONS_COLUMNS.join(","),
    ...rows.map((r) => EMISSIONS_COLUMNS.map((c) => esc(r[c] ?? "")).join(",")),
  ].join("\n") + "\n";
}
