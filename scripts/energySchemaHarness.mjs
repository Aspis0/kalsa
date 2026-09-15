#!/usr/bin/env node
/**
 * Offline harness for scripts/energySchema.mjs.
 *
 * Feeds synthetic sampler CSVs to parseEnergyCsv/integrate and asserts the
 * audit hardening (torn tail, 0-byte empty files, strict regex skip counts,
 * non-monotonic drop, hand-computed joules, sanity band), then the
 * CodeCarbon-compatible export (duration column name, kWh conversion, empty
 * vs KALSA_GRID_G_PER_KWH emissions, non-positive grid rejection) — including
 * end-to-end runs of energyAggregate.mjs in temp dirs: --emissions writes one
 * file per run (degenerate runs get a header-only file + stderr warning),
 * unparseable rows warn on stderr, degenerate measurements warn, the grid env
 * var is untouched without --emissions, and the stdout table is pinned
 * string-for-string against a golden snapshot.
 *
 * Zero npm deps. Exit 1 on any failure.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  emptyEmissionsCsv,
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

const REBOOT_ROW = [
  HEADER,
  "10.0,-100000,4000000,300,Discharging,500000:500000",
  "11.0,-150000,4000000,300,Discharging,800000:700000",
  "12.0,-100000,4000000,300,Discharging,600000:600000",
  "0.5,-999999,4000000,300,Discharging,600000:600000",
  "",
].join("\n");

// Golden stdout of energyAggregate.mjs over a fixed 3-arm fixture
// (healthy / non-monotonic / torn tail): exact snapshot, header included.
// Sorted dir order: golden_healthy, golden_reboot, golden_torn.
const GOLDEN = `| arm | n | s | mean W | J | J/rep | sumCPU kHz mean | min |
|---|---|---|---|---|---|---|---|
| golden_healthy | 3 | 2 | 0.47 | 1 | n/a | 1233333 | 1000000 |
  WARNING: golden_reboot dropped 1 non-monotonic row(s)
| golden_reboot | 4 | 2 | 0.47 | 1 | n/a | 1233333 | 1000000 |
| golden_torn | 3+torn | 2 | 0.47 | 1 | n/a | 1233333 | 1000000 |

Relative metric only: window includes load+prefill; power = |V*I| at the
battery terminal (gauge ~1 s smoothing). J/rep needs the per-rep txt files.
`;

function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

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

  // ── 2b. parseEnergyCsv: 0-byte file is empty, not torn ──────────────
  {
    const { rows, torn, empty, skipped } = parseEnergyCsv("");
    check("empty: 0-byte file flagged empty", empty === true);
    check("empty: 0-byte file NOT flagged torn", torn === false);
    check("empty: no rows, nothing skipped", rows.length === 0 && skipped === 0);
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
    const m = integrate(parseEnergyCsv(REBOOT_ROW).rows);
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
    check("emissions row: duration formatted", noGrid.duration === "2.00", noGrid.duration);
    check("emissions row: cpu_power formatted", noGrid.cpu_power === "0.50");
    check("emissions row: column 4 is CodeCarbon's `duration`", EMISSIONS_COLUMNS[3] === "duration", EMISSIONS_COLUMNS[3]);

    const grid = toEmissionsRow({ ...base, gridGPerKwh: 400 });
    // kgCO2eq = kWh * gCO2eq/kWh / 1000 → (1/3.6e6) * 400 / 1000
    check(
      "emissions row: grid factor filled (400 g/kWh)",
      grid.emissions === String(((1 / 3.6e6) * 400) / 1000),
      grid.emissions,
    );
    check("emissions row: columns all present", EMISSIONS_COLUMNS.every((c) => c in noGrid));
  }

  // ── 9. toEmissionsCsv + degenerate header-only export ───────────────
  {
    const csv = toEmissionsCsv([toEmissionsRow({ stem: "m_arm_P", duration_s: 2, mean_w: 0.5, joules: 1 })]);
    const lines = csv.split("\n");
    check("csv: header is EMISSIONS_COLUMNS", lines[0] === EMISSIONS_COLUMNS.join(","));
    check("csv: one data row + trailing newline", lines.length === 3 && lines[2] === "");
    const esc = toEmissionsCsv([toEmissionsRow({ stem: "a,b", duration_s: 1, mean_w: 1, joules: 1 })]);
    check("csv: comma stem quoted", esc.includes('"a,b"'));

    const deg = emptyEmissionsCsv().split("\n");
    check(
      "csv: degenerate export = header + all-empty row",
      deg[0] === EMISSIONS_COLUMNS.join(",") &&
        deg[1] === EMISSIONS_COLUMNS.map(() => "").join(",") &&
        deg[2] === "",
      emptyEmissionsCsv(),
    );
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
      check("e2e: column 4 is `duration`", hdr.split(",")[3] === "duration", hdr);
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

      const r3 = run({ KALSA_GRID_G_PER_KWH: "0" });
      const row3 = (readFileSyncSafe(out) ?? "").trim().split("\n")[1];
      check(
        "e2e: zero grid factor ignored with stderr warning",
        r3.status === 0 && /ignoring non-positive KALSA_GRID_G_PER_KWH=0/.test(r3.stderr),
        r3.stderr,
      );
      check("e2e: zero grid factor → empty emissions", row3.split(",")[6] === "", row3);

      const rNoEmit = spawnSync(
        process.execPath,
        [path.join(__dirname, "energyAggregate.mjs"), dir],
        { env: { ...process.env, KALSA_GRID_G_PER_KWH: "nope" }, encoding: "utf8" },
      );
      check(
        "e2e: grid env untouched without --emissions",
        rNoEmit.status === 0 && !rNoEmit.stderr.includes("KALSA_GRID"),
        rNoEmit.stderr,
      );
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  // ── 11. end-to-end: degenerate arms still export one file per run ───
  {
    const tmp = mkdtempSync(path.join(tmpdir(), "energyDegenerate-"));
    try {
      const dir = path.join(tmp, "campaign");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "d_empty.csv"), ""); // 0 bytes
      writeFileSync(path.join(dir, "d_single.csv"), HEADER + "\n0.0,-100000,4000000,300,Discharging,500000:500000\n");
      writeFileSync(
        path.join(dir, "d_nopower.csv"),
        HEADER + "\n0.0,0,4000000,300,Discharging,\n1.0,0,4000000,300,Discharging,\n",
      );
      writeFileSync(
        path.join(dir, "d_dirty.csv"),
        [
          HEADER,
          "",
          "garbage,line,here",
          "0.0,-100000,4000000,300,Discharging,500000:500000",
          "1.0,2",
          "1.0,-150000,4000000,300,Discharging,800000:700000",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(dir, "d_short.csv"), // 0.5 s window → degenerate measurement
        HEADER + "\n0.0,-100000,4000000,300,Discharging,500000:500000\n0.5,-150000,4000000,300,Discharging,800000:700000\n",
      );

      const r = spawnSync(
        process.execPath,
        [path.join(__dirname, "energyAggregate.mjs"), dir, "--emissions"],
        { encoding: "utf8" },
      );
      check("degenerate e2e: exits 0", r.status === 0, `status=${r.status} stderr=${r.stderr}`);
      const eDir = path.join(dir, "emissions");
      const wrote = readdirSync(eDir).sort();
      check(
        "degenerate e2e: one file per run (5/5)",
        wrote.length === 5 &&
          ["d_dirty", "d_empty", "d_nopower", "d_short", "d_single"].every((s) =>
            wrote.includes(`${s}_emissions.csv`),
          ),
        wrote.join(" "),
      );
      for (const stem of ["d_empty", "d_single", "d_nopower"]) {
        check(
          `degenerate e2e: ${stem} export is header + all-empty row`,
          readFileSyncSafe(path.join(eDir, `${stem}_emissions.csv`)) === emptyEmissionsCsv(),
        );
      }
      const dirtyRow = (readFileSyncSafe(path.join(eDir, "d_dirty_emissions.csv")) ?? "").trim().split("\n")[1];
      check("degenerate e2e: d_dirty export has real energy", (dirtyRow.split(",")[5] ?? "") !== "", dirtyRow);
      const shortRow = (readFileSyncSafe(path.join(eDir, "d_short_emissions.csv")) ?? "").trim().split("\n")[1];
      check("degenerate e2e: d_short export keeps its real duration", shortRow.split(",")[3] === "0.50", shortRow);
      check(
        "degenerate e2e: three header-only warnings on stderr",
        (r.stderr.match(/degenerate run, header-only export/g) ?? []).length === 3,
        r.stderr,
      );
      check(
        "degenerate e2e: skipped rows warn on stderr",
        r.stderr.includes("d_dirty: skipped 2 unparseable row(s)"),
        r.stderr,
      );
      check(
        "degenerate e2e: degenerate measurement warns on stderr",
        r.stderr.includes("d_short: degenerate measurement exported"),
        r.stderr,
      );
      check(
        "degenerate e2e: empty file labelled in the table",
        r.stdout.includes("| d_empty | 0 (empty file) | too few samples |"),
        r.stdout,
      );
      check("degenerate e2e: stdout stays table-only", !r.stdout.includes("emissions"), r.stdout);
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  // ── 12. golden test: the stdout table is pinned byte-for-byte ───────
  {
    const tmp = mkdtempSync(path.join(tmpdir(), "energyGolden-"));
    try {
      const dir = path.join(tmp, "campaign");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "golden_healthy.csv"), THREE_ROW);
      writeFileSync(path.join(dir, "golden_reboot.csv"), REBOOT_ROW);
      writeFileSync(path.join(dir, "golden_torn.csv"), THREE_ROW + "3.0,-100000,4000000,300,Disch");
      const r = spawnSync(
        process.execPath,
        [path.join(__dirname, "energyAggregate.mjs"), dir],
        { encoding: "utf8" },
      );
      check("golden: exits 0", r.status === 0, `status=${r.status}`);
      const i = firstDiffIndex(r.stdout, GOLDEN);
      check(
        "golden: stdout matches the snapshot string-for-string",
        i === -1,
        i === -1
          ? ""
          : `first diff at char ${i}: got ${JSON.stringify(r.stdout.slice(i, i + 48))} want ${JSON.stringify(GOLDEN.slice(i, i + 48))}`,
      );
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
