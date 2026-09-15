#!/usr/bin/env node
/**
 * Offline harness for scripts/energySchema.mjs.
 *
 * Feeds synthetic sampler CSVs to parseEnergyCsv/integrate and asserts the
 * audit hardening (torn tail, strict regex skip counts, non-monotonic drop,
 * hand-computed joules, sanity band), then the CodeCarbon-compatible export
 * (kWh conversion, empty vs KALSA_GRID_G_PER_KWH emissions) — including an
 * end-to-end run of energyAggregate.mjs --emissions in a temp dir.
 *
 * Zero npm deps. Exit 1 on any failure.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseEnergyCsv,
  integrate,
  EMISSIONS_COLUMNS,
  toEmissionsRow,
  toEmissionsCsv,
} from "./energySchema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const HEADER = "t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz";

// 0.4 W, 0.6 W, 0.4 W at 1 s spacing → 1 J; mean 1.4/3 W.
const THREE_ROW = [
  HEADER,
  "0.0,-100000,4000000,300,Discharging,500000:500000",
  "1.0,-150000,4000000,300,Discharging,800000:700000",
  "2.0,-100000,4000000,300,Discharging,600000:600000",
  "",
].join("\n");

function main() {
  // ── 1. parseEnergyCsv: valid rows ───────────────────────────────────
  {
    const { rows, torn, skipped } = parseEnergyCsv(THREE_ROW);
    check("parse: all rows kept", rows.length === 3, `n=${rows.length}`);
    check("parse: not torn", torn === false);
    check("parse: nothing skipped", skipped === 0, `skipped=${skipped}`);
    check("parse: t parsed as number", rows[0].t === 0 && close(rows[2].t, 2));
    check("parse: i/v kept as raw strings", rows[1].i === "-150000" && rows[1].v === "4000000");
    check("parse: f kept as colon-joined string", rows[1].f === "800000:700000");
  }

  // ── 2. parseEnergyCsv: torn tail (pull during write) ────────────────
  {
    const text = THREE_ROW + "3.0,-100000,4000000,300,Disch"; // no trailing \n
    const { rows, torn, skipped } = parseEnergyCsv(text);
    check("torn: partial last line dropped", rows.length === 3, `n=${rows.length}`);
    check("torn: flagged", torn === true);
    check("torn: nothing counted as skipped", skipped === 0, `skipped=${skipped}`);
  }

  // ── 3. parseEnergyCsv: dirty rows counted, header/blank ignored ─────
  {
    const text = [
      HEADER,
      "",
      "garbage,line,here",
      "0.0,-100000,4000000,300,Discharging,500000:500000",
      "1.0,2",
      "1.0,-150000,4000000,300,Discharging,800000:700000",
      "",
    ].join("\n");
    const { rows, skipped } = parseEnergyCsv(text);
    check("dirty: valid rows survive", rows.length === 2, `n=${rows.length}`);
    check("dirty: two bad rows counted", skipped === 2, `skipped=${skipped}`);
  }

  // ── 4. integrate: hand-computed joules / mean / clocks ──────────────
  {
    const m = integrate(parseEnergyCsv(THREE_ROW).rows);
    check("integrate: joules = 1 (hand-computed)", close(m.joules, 1.0), `joules=${m.joules}`);
    check("integrate: mean W = 1.4/3", close(m.mean_w, 1.4 / 3), `mean_w=${m.mean_w}`);
    check("integrate: duration = 2 s", close(m.duration_s, 2), `duration_s=${m.duration_s}`);
    check("integrate: n_power = 3", m.n_power === 3, `n_power=${m.n_power}`);
    check(
      "integrate: sum kHz mean = 3.7e6/3",
      close(m.sum_cpu_khz_mean, 3700000 / 3),
      `mean=${m.sum_cpu_khz_mean}`,
    );
    check("integrate: sum kHz min = 1e6", m.sum_cpu_khz_min === 1000000, `min=${m.sum_cpu_khz_min}`);
    check("integrate: no warnings in band", m.warnings.length === 0, JSON.stringify(m.warnings));
  }

  // ── 5. integrate: non-monotonic t (reboot) dropped with warning ─────
  {
    const text = [
      HEADER,
      "10.0,-100000,4000000,300,Discharging,500000:500000",
      "11.0,-150000,4000000,300,Discharging,800000:700000",
      "12.0,-100000,4000000,300,Discharging,600000:600000",
      "0.5,-999999,4000000,300,Discharging,600000:600000",
      "",
    ].join("\n");
    const m = integrate(parseEnergyCsv(text).rows);
    check("reboot: duration unaffected", close(m.duration_s, 2), `duration_s=${m.duration_s}`);
    check("reboot: joules unaffected", close(m.joules, 1.0), `joules=${m.joules}`);
    check(
      "reboot: warning names the dropped count",
      m.warnings.includes("dropped 1 non-monotonic row(s)"),
      JSON.stringify(m.warnings),
    );
  }

  // ── 6. integrate: 0.1-20 W sanity band warning ──────────────────────
  {
    const text = [
      HEADER,
      "0.0,-5000000,5000000,300,Discharging,500000:500000",
      "1.0,-5000000,5000000,300,Discharging,500000:500000",
      "",
    ].join("\n");
    const m = integrate(parseEnergyCsv(text).rows); // 25 W
    check("band: 25 W mean computed", close(m.mean_w, 25), `mean_w=${m.mean_w}`);
    check(
      "band: warning fires outside 0.1-20 W",
      m.warnings.some((w) => w.includes("25.00 outside the 0.1-20 W sanity band")),
      JSON.stringify(m.warnings),
    );
  }

  // ── 7. integrate: zero-valid-power rows ─────────────────────────────
  {
    const text = [
      HEADER,
      "0.0,0,4000000,300,Discharging,",
      "1.0,0,4000000,300,Discharging,",
      "",
    ].join("\n");
    const m = integrate(parseEnergyCsv(text).rows);
    check("no-power: n_power = 0", m.n_power === 0);
    check("no-power: mean W is NaN", Number.isNaN(m.mean_w));
    check("no-power: sum kHz mean is NaN", Number.isNaN(m.sum_cpu_khz_mean));
    check("no-power: sum kHz min stays Infinity", m.sum_cpu_khz_min === Infinity);
    check("no-power: band check skipped on NaN", m.warnings.length === 0);
  }

  // ── 8. toEmissionsRow: kWh conversion + grid factor ─────────────────
  {
    const base = { stem: "m_arm_P", duration_s: 2, mean_w: 0.5, joules: 1 };
    const noGrid = toEmissionsRow({ ...base });
    check("emissions row: kWh = J / 3.6e6", noGrid.cpu_energy === String(1 / 3.6e6), noGrid.cpu_energy);
    check("emissions row: emissions empty without grid", noGrid.emissions === "");
    check("emissions row: project_name = kalsa", noGrid.project_name === "kalsa");
    check("emissions row: os = Android", noGrid.os === "Android");
    check("emissions row: run_id = stem", noGrid.run_id === "m_arm_P");
    check("emissions row: cpu_count/cpu_model empty", noGrid.cpu_count === "" && noGrid.cpu_model === "");
    check(
      "emissions row: timestamp is ISO8601",
      !Number.isNaN(Date.parse(noGrid.timestamp)),
      noGrid.timestamp,
    );
    check("emissions row: duration formatted", noGrid.duration_seconds === "2.00");
    check("emissions row: cpu_power formatted", noGrid.cpu_power === "0.50");

    const grid = toEmissionsRow({ ...base, gridGPerKwh: 400 });
    // kgCO2eq = kWh * gCO2eq/kWh / 1000 → (1/3.6e6) * 400 / 1000
    check(
      "emissions row: grid factor filled (400 g/kWh)",
      grid.emissions === String(((1 / 3.6e6) * 400) / 1000),
      grid.emissions,
    );
    check("emissions row: columns all present", EMISSIONS_COLUMNS.every((c) => c in noGrid));
  }

  // ── 9. toEmissionsCsv ───────────────────────────────────────────────
  {
    const csv = toEmissionsCsv([toEmissionsRow({ stem: "m_arm_P", duration_s: 2, mean_w: 0.5, joules: 1 })]);
    const lines = csv.split("\n");
    check("csv: header is EMISSIONS_COLUMNS", lines[0] === EMISSIONS_COLUMNS.join(","));
    check("csv: one data row + trailing newline", lines.length === 3 && lines[2] === "");
    const esc = toEmissionsCsv([toEmissionsRow({ stem: "a,b", duration_s: 1, mean_w: 1, joules: 1 })]);
    check("csv: comma stem quoted", esc.includes('"a,b"'));
  }

  // ── 10. end-to-end: energyAggregate.mjs --emissions ─────────────────
  {
    const tmp = mkdtempSync(path.join(tmpdir(), "energySchema-"));
    try {
      const dir = path.join(tmp, "campaign");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "m_arm_P.csv"), THREE_ROW);
      const run = (env) =>
        spawnSync(process.execPath, [path.join(__dirname, "energyAggregate.mjs"), dir, "--emissions"], {
          env: { ...process.env, ...env },
          encoding: "utf8",
        });
      const out = path.join(dir, "emissions", "m_arm_P_emissions.csv");

      const r0 = run({ KALSA_GRID_G_PER_KWH: "" });
      check("e2e: exits 0", r0.status === 0, `status=${r0.status} stderr=${r0.stderr}`);
      check("e2e: emissions csv written", !!readFileSyncSafe(out));
      const csv0 = readFileSyncSafe(out) ?? "";
      const [hdr, row0] = csv0.trim().split("\n");
      check("e2e: header matches EMISSIONS_COLUMNS", hdr === EMISSIONS_COLUMNS.join(","), hdr);
      check("e2e: emissions column empty without grid", row0.split(",")[6] === "", row0);
      check("e2e: stdout stays table-only", !r0.stdout.includes("emissions"), r0.stdout);

      const kWh = Number(row0.split(",")[5]);
      const r1 = run({ KALSA_GRID_G_PER_KWH: "400" });
      const row1 = (readFileSyncSafe(out) ?? "").trim().split("\n")[1];
      check(
        "e2e: KALSA_GRID_G_PER_KWH fills emissions (kgCO2eq)",
        row1.split(",")[6] === String((kWh * 400) / 1000),
        row1,
      );
      check("e2e: grid note on stderr", /grid factor 400/.test(r1.stderr), r1.stderr);

      const r2 = run({ KALSA_GRID_G_PER_KWH: "nope" });
      check(
        "e2e: non-numeric grid ignored with stderr warning",
        r2.status === 0 && /ignoring non-numeric KALSA_GRID_G_PER_KWH=nope/.test(r2.stderr),
        r2.stderr,
      );
      const row2 = (readFileSyncSafe(out) ?? "").trim().split("\n")[1];
      check("e2e: non-numeric grid → empty emissions", row2.split(",")[6] === "", row2);
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  console.log("");
  console.log(
    `=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed) ===`,
  );
  if (failed > 0) process.exit(1);
}

function readFileSyncSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

main();
