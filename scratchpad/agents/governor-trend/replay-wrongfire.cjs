#!/usr/bin/env node
/*
 * replay-wrongfire.cjs - offline wrong-fire measurement for trend_c_per_min.
 *
 * DECLARATIONS (read before trusting a number below):
 * 1. Estimator = the REAL app code. src/engine/governorTrend.ts is compiled
 *    with tsc and required here; nothing is re-implemented on the estimation
 *    side. The sha256 of the compiled source is printed at startup.
 * 2. Engine rule = RE-IMPLEMENTATION, not the engine running. The decision is
 *    replayed from source as read at engine pin 1577495b:
 *      - k_trend_c_per_min = 1.5f                (policy.cpp L13)
 *      - thresholds struct order                 (policy.h L45-52:
 *        warm_enter, warm_exit, cool_enter, cool_exit, critical_enter, critical_exit)
 *      - unplugged {38.0, 36.0, 39.5, 36.5, 42.0, 34.0} (policy.cpp L44)
 *        -> trend line runs in WARM and escalates when
 *           temp >= warm_enter + 0.5 (38.5) && trend >= 1.5, and only if
 *           temp < cool_enter (39.5) can the trend change the decision
 *           (policy.cpp L140-143)
 *      - plugged band [t_idle+3.5, t_idle+4.5)   (policy.cpp L46-51 via h struct)
 *      - batt_level_pct < 25 preempts to LOWBAT, trend line unreachable (L128)
 * 3. Open loop. Each poll is judged on the same history; the closed-loop
 *    state machine (dwell, prior COOLMODE residency, Invalid recovery) is NOT
 *    simulated. An escalation is counted once per contiguous episode, not once
 *    per in-band poll.
 * 4. Verdict yardstick (mine, not the engine's): a flip is TRUE when the
 *    temperature reached cool_enter within 120 s after the flip (the absolute
 *    gate was imminent; the trend only front-ran it), FALSE when it fell back
 *    below warm_enter within 120 s without ever reaching cool_enter, else
 *    UNRESOLVED (raw numbers reported).
 * 5. Timestamps and flags come from each format as archived: qdc anchor_epoch,
 *    CSV uptime seconds, file mtimes for per-turn snapshots. Assumptions per
 *    loader are printed with the session.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ESTIMATOR = process.argv[2]; // compiled governorTrend.js
if (!ESTIMATOR || !fs.existsSync(ESTIMATOR)) {
  console.error("usage: node replay-wrongfire.cjs <compiled-governorTrend.js>");
  process.exit(2);
}
const srcSha = process.env.GOVERNOR_TREND_SHA || "unknown";
const { createTrendProducer } = require(ESTIMATOR);

const KALSA = process.env.KALSA_ROOT || "/Users/marco/Projects/kalsa";
const LAB = process.env.LAB_ROOT || "/Users/marco/Projects/kalsa-moe-experiments";

// Engine constants (re-implementation), pin 1577495b - see header.
const K_TREND = 1.5;
const UNPLUGGED_WARM_ENTER = 38.0;
const UNPLUGGED_COOL_ENTER = 39.5;
const LEVEL_GATE = 25;
const PLUGGED_WARM_ENTER_OFF = 3.0; // policy.cpp L46 first entry
const PLUGGED_COOL_ENTER_OFF = 4.5; // policy.cpp L48 third entry

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Each loader returns sessions: { id, assume, rows }
// row: { tS, tenths, valid, plugged|null, level|null, tIdleC|null }
const sessions = [];

function addSession(id, assume, rows) {
  rows.sort((a, b) => a.tS - b.tS);
  if (rows.length >= 2) sessions.push({ id, assume, rows });
}

function shortPath(p) {
  return p.replace(KALSA + "/", "kalsa:").replace(LAB + "/", "lab:");
}

// --- Loader A: qdc governor status snapshots (one line per turn) -----------
function loadQdc() {
  const files = [];
  for (const dir of fs.readdirSync(path.join(LAB, "scratchpad/agents"))) {
    if (!dir.startsWith("qdc-governor-s")) continue;
    const raw = path.join(LAB, "scratchpad/agents", dir, "raw");
    if (!fs.existsSync(raw)) continue;
    for (const f of walk(raw)) if (/_t\d+_status\.txt$/.test(f)) files.push(f);
  }
  const groups = new Map();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const thermo = /thermo=(\{[^{}]*\})/.exec(text);
    const epoch = /anchor_epoch=(\d+)/.exec(text);
    if (!thermo || !epoch) continue;
    let t;
    try {
      t = JSON.parse(thermo[1]);
    } catch {
      continue;
    }
    if (typeof t.batt_temp_tenths_c !== "number") continue;
    const m = /_t(\d+)_status\.txt$/.exec(f);
    const key = f.replace(/_t\d+_status\.txt$/, "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      tS: Number(epoch[1]),
      tenths: t.batt_temp_tenths_c,
      valid: t.sensor_valid === true,
      plugged: typeof t.plugged === "boolean" ? t.plugged : null,
      level: typeof t.batt_level_pct === "number" ? t.batt_level_pct : null,
      tIdleC: t.t_idle_valid && typeof t.t_idle_c === "number" ? t.t_idle_c : null,
      turn: m ? Number(m[1]) : 0,
    });
  }
  let n = 0;
  for (const [key, rows] of groups) {
    rows.sort((a, b) => a.turn - b.turn || a.tS - b.tS);
    n += rows.length;
    addSession(
      shortPath(key),
      "qdc status per turn: anchor_epoch as poll time; driver thermo values (its trend field ignored, recomputed)",
      rows.map(({ turn, ...r }) => r),
    );
  }
  return { files: files.length, rows: n };
}

// --- Loader B: energy-sample.sh CSVs (batt_temp_deciC) ---------------------
function loadEnergySample() {
  const roots = [KALSA, path.join(LAB, "scratchpad/agents/app-landing-audit/base-tree")];
  const seen = new Map(); // sha256 -> first path
  let dupes = 0;
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const f of walk(root)) {
      if (!f.endsWith(".csv") || f.includes(".phases.")) continue;
      const head = fs.readFileSync(f, "utf8").slice(0, 400);
      if (!head.includes("batt_temp_deciC")) continue;
      const sha = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
      if (seen.has(sha)) {
        dupes++;
        continue;
      }
      seen.set(sha, f);
      files.push(f);
    }
  }
  let rows = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    const hdr = lines.shift().split(",");
    const iT = hdr.indexOf("t_s");
    const iB = hdr.indexOf("batt_temp_deciC");
    const iS = hdr.indexOf("status");
    const rowsOut = [];
    for (const l of lines) {
      const c = l.split(",");
      const tS = Number(c[iT]);
      const bt = c[iB];
      if (!Number.isFinite(tS)) continue;
      const valid = bt !== undefined && bt !== "" && Number.isFinite(Number(bt));
      const st = (c[iS] || "").trim();
      const plugged =
        st === "Discharging" ? false : st === "Charging" || st === "Full" ? true : null;
      rowsOut.push({
        tS,
        tenths: valid ? Number(bt) : 0,
        valid,
        plugged,
        level: null,
        tIdleC: null,
      });
    }
    rows += rowsOut.length;
    addSession(
      shortPath(f),
      "energy-sample.sh ~1 s cadence; level unknown (assumed >= 25); plugged from status col",
      rowsOut,
    );
  }
  return { files: files.length, dupes, rows };
}

// --- Loader C: host dumpsys energy-trace (t20c) ----------------------------
function loadHostTrace() {
  const f = path.join(KALSA, "out/t20c-gate-20260916/energy-trace.csv");
  if (!fs.existsSync(f)) return { files: 0, rows: 0 };
  const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  const hdr = lines.shift().split(",");
  const iT = hdr.indexOf("t_s");
  const iL = hdr.indexOf("level_pct");
  const iP = hdr.indexOf("batt_temp_deci_c");
  const iPl = hdr.indexOf("plugged");
  const iOk = hdr.indexOf("ok");
  const rows = [];
  for (const l of lines) {
    const c = l.split(",");
    const tS = Number(c[iT]);
    const temp = Number(c[iP]);
    const ok = (c[iOk] || "").trim() === "true";
    if (!Number.isFinite(tS)) continue;
    rows.push({
      tS,
      tenths: ok && Number.isFinite(temp) ? temp : 0,
      valid: ok && Number.isFinite(temp),
      plugged: (c[iPl] || "").trim() === "true",
      level: Number.isFinite(Number(c[iL])) ? Number(c[iL]) : null,
      tIdleC: null,
    });
  }
  addSession(
    shortPath(f),
    "host dumpsys ~10 s poll, values refresh on broadcast 30-90 s; level+plugged from file",
    rows,
  );
  return { files: 1, rows: rows.length };
}

// --- Loader D: s23 native gpu bench (batt_temp_dC) -------------------------
function loadGpuBench() {
  const dir = path.join(LAB, "scratchpad/agents/s23-native-gpu-bench/raw/q2");
  if (!fs.existsSync(dir)) return { files: 0, rows: 0 };
  let n = 0;
  for (const f of walk(dir)) {
    if (!f.endsWith(".csv")) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    const hdr = lines.shift().split(",");
    if (!hdr.includes("batt_temp_dC")) continue;
    const iT = hdr.indexOf("t_s");
    const iC = hdr.indexOf("current_mA");
    const iB = hdr.indexOf("batt_temp_dC");
    const rows = [];
    for (const l of lines) {
      const c = l.split(",");
      const tS = Number(c[iT]);
      const bt = Number(c[iB]);
      const cur = Number(c[iC]);
      if (!Number.isFinite(tS) || !Number.isFinite(bt)) continue;
      rows.push({
        tS,
        tenths: bt,
        valid: true,
        plugged: Number.isFinite(cur) ? (cur < 0 ? false : cur > 0 ? true : null) : null,
        level: null,
        tIdleC: null,
      });
    }
    n += rows.length;
    addSession(shortPath(f), "~5 s cadence; plugged inferred from current sign; level unknown", rows);
  }
  return { files: 1, rows: n };
}

// --- Loader E: s23 plugged idle reference ----------------------------------
function loadPluggedRef() {
  const f = path.join(LAB, "scratchpad/agents/s23-plugged-baseline/raw/plugged_idle_reference.csv");
  if (!fs.existsSync(f)) return { files: 0, rows: 0 };
  const lines = fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim());
  const hdr = lines.shift().split(",").map((h) => h.replace(/"/g, ""));
  const iT = hdr.indexOf("device_epoch");
  const iL = hdr.indexOf("level");
  const iB = hdr.indexOf("battery_temp_C");
  const rows = [];
  for (const l of lines) {
    const c = l.split(",").map((v) => v.replace(/"/g, ""));
    const tS = Number(c[iT]);
    const bt = Number(c[iB]);
    if (!Number.isFinite(tS) || !Number.isFinite(bt)) continue;
    rows.push({
      tS,
      tenths: Math.round(bt * 10),
      valid: true,
      plugged: true,
      level: Number.isFinite(Number(c[iL])) ? Number(c[iL]) : null,
      tIdleC: null, // set below: engine latches the first plugged sample
    });
  }
  if (rows.length) rows[0].tIdleC = rows[0].tenths / 10;
  addSession(
    shortPath(f),
    "plugged series; t_idle latched from first plugged sample (engine rule); ~40 s cadence",
    rows,
  );
  return { files: rows.length ? 1 : 0, rows: rows.length };
}

// --- Loader F: per-turn sysprobe snapshots (in-file epoch= stamp) ----------
// NOTE: file mtimes on disk are all identical (one bulk copy, 1789052062),
// so mtimes are NOT usable. thermal.txt has no in-file stamp and is dropped.
// sysprobe_pre.txt / sysprobe_post.txt carry `ts=... epoch=NNN ...` on line 1.
function loadTurnDirs() {
  const bases = [
    [path.join(KALSA, "out/bench"), "bench"],
    [path.join(KALSA, "out/device/kill-campaign"), null],
    // root device-kill-campaign/ is a duplicate of out/device/kill-campaign/
    // (same 167 turn dirs) - skipped.
  ];
  let nFiles = 0;
  let nRows = 0;
  for (const [base, tag] of bases) {
    if (!fs.existsSync(base)) continue;
    const bySession = new Map();
    const turnDirs = [];
    const entries = fs.readdirSync(base, { withFileTypes: true });
    if (entries.some((e) => /^turn\d+$/.test(e.name))) {
      for (const d of entries.filter((e) => /^turn\d+$/.test(e.name)).map((e) => e.name)) {
        turnDirs.push([base, d, tag || path.basename(base)]);
      }
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const armDir = path.join(base, e.name);
      const turns = fs.readdirSync(armDir).filter((d) => /^turn\d+$/.test(d));
      for (const d of turns) turnDirs.push([armDir, d, tag || e.name]);
    }
    for (const [dir, turn, sess] of turnDirs) {
      if (!bySession.has(sess)) bySession.set(sess, []);
      for (const name of ["sysprobe_pre.txt", "sysprobe_post.txt"]) {
        const f = path.join(dir, turn, name);
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, "utf8");
        const stamp = /\bepoch=(\d+)/.exec(text);
        const m = /battery_deci_c=(\d+)/.exec(text);
        if (!stamp || !m) continue;
        nFiles++;
        const lvl = /battery_level_pct=(\d+)/.exec(text);
        const ac = /battery_ac_powered=(true|false)/.exec(text);
        const usb = /battery_usb_powered=(true|false)/.exec(text);
        const wl = /battery_wireless_powered=(true|false)/.exec(text);
        const flags = [ac, usb, wl].filter(Boolean).map((x) => x[1] === "true");
        bySession.get(sess).push({
          tS: Number(stamp[1]),
          tenths: Number(m[1]),
          valid: true,
          plugged: flags.length ? flags.some(Boolean) : null,
          level: lvl ? Number(lvl[1]) : null,
          tIdleC: null,
        });
      }
    }
    for (const [sess, rows] of bySession) {
      nRows += rows.length;
      addSession(
        sess.replace(base, shortPath(base)),
        "per-turn sysprobe pre/post; timestamps = in-file epoch= stamp (declared); mtimes unusable",
        rows,
      );
    }
  }
  return { files: nFiles, rows: nRows };
}

// --- Rule (re-implementation) ----------------------------------------------
function bandFor(r) {
  if (r.plugged === true) {
    if (r.tIdleC == null) return null; // plugged without a latched baseline: no band
    return { lo: r.tIdleC + PLUGGED_WARM_ENTER_OFF + 0.5, hi: Math.min(r.tIdleC + PLUGGED_COOL_ENTER_OFF, 42),
             warmExit: r.tIdleC + PLUGGED_WARM_ENTER_OFF };
  }
  // plugged === false, or null (declared assumption: unplugged benchmark)
  return { lo: UNPLUGGED_WARM_ENTER + 0.5, hi: UNPLUGGED_COOL_ENTER, warmEnter: UNPLUGGED_WARM_ENTER, warmExit: 36.0 };
}

function bandForVerdict(r) {
  const b = bandFor(r);
  if (!b) return null;
  if (r.plugged === true) return { ...b, warmEnter: r.tIdleC + PLUGGED_WARM_ENTER_OFF };
  return b;
}

function wouldFlip(r) {
  if (!r.valid) return false;
  if (r.level != null && r.level < LEVEL_GATE) return false;
  const b = bandFor(r);
  if (!b) return false;
  const tempC = r.tenths / 10;
  return tempC >= b.lo && tempC < b.hi && r.trend >= K_TREND;
}

// --- Replay ----------------------------------------------------------------
function replay(rows, cadenceS) {
  const producer = createTrendProducer();
  const polls = [];
  let lastT = -Infinity;
  for (const r of rows) {
    if (Number.isFinite(cadenceS) && r.tS - lastT < cadenceS) continue;
    lastT = r.tS;
    const tMs = Math.round(r.tS * 1000);
    producer.observe("battery", r.valid ? r.tenths : 0, r.valid, tMs);
    const trend = r.valid ? producer.trend(tMs) : 0;
    polls.push({ ...r, trend });
  }
  return polls;
}

function verdictAt(rows, i) {
  const r = rows[i];
  const b = bandForVerdict(r);
  if (!b) return { verdict: "UNRESOLVED", note: "no band" };
  const t0 = r.tS;
  let max120 = -Infinity;
  let max300 = -Infinity;
  let reachedCool = false;
  let fellBelowWarm120 = false;
  for (let j = i; j < rows.length && rows[j].tS - t0 <= 300; j++) {
    const tc = rows[j].tenths / 10;
    if (rows[j].tS - t0 <= 120) {
      max120 = Math.max(max120, tc);
      if (tc >= b.hi) reachedCool = true;
      if (tc < b.warmEnter) fellBelowWarm120 = true;
    }
    max300 = Math.max(max300, tc);
  }
  let verdict;
  if (reachedCool) verdict = "TRUE";
  else if (fellBelowWarm120) verdict = "FALSE";
  else verdict = "UNRESOLVED";
  return { verdict, max120: max120 === -Infinity ? null : max120, max300: max300 === -Infinity ? null : max300, coolEnter: b.hi };
}

// --- Main -------------------------------------------------------------------
console.log("estimator:", ESTIMATOR, "sha256(governorTrend.ts at worktree):", srcSha);
console.log("engine rule: RE-IMPLEMENTATION of policy.cpp@1577495b L13/L44/L128/L140-143 (see header)");
console.log("");

const a = loadQdc();
const b = loadEnergySample();
const c = loadHostTrace();
const d = loadGpuBench();
const e = loadPluggedRef();
const g = loadTurnDirs();
console.log("CORPUS LOAD:");
console.log("  qdc status:", a.files, "files,", a.rows, "rows");
console.log("  energy-sample csv:", b.files, "unique files (", b.dupes, "duplicate copies skipped ),", b.rows, "rows");
console.log("  host trace:", c.files, "file,", c.rows, "rows");
console.log("  s23 gpu bench:", d.files, "files,", d.rows, "rows");
console.log("  s23 plugged ref:", e.files, "file,", e.rows, "rows");
console.log("  turn snapshots:", g.files, "files,", g.rows, "rows");
console.log("");

const CADENCES = [
  ["native", null],
  ["grid-280s", 280],
];

const totals = {};
const allEpisodes = [];
let grandRows = 0;
for (const s of sessions) grandRows += s.rows.length;

const lines = [];
const skippedNoValid = [];
lines.push("PER-SESSION REPLAY");
for (const s of sessions) {
  const temps = s.rows.filter((r) => r.valid).map((r) => r.tenths / 10);
  if (!temps.length) {
    skippedNoValid.push(s.id);
    continue;
  }
  const span = s.rows[s.rows.length - 1].tS - s.rows[0].tS;
  const summary = {
    id: s.id,
    polls: s.rows.length,
    spanS: Math.round(span),
    tempMin: Math.min(...temps),
    tempMax: Math.max(...temps),
    cadences: {},
  };
  for (const [name, cad] of CADENCES) {
    const polls = replay(s.rows, cad);
    let bandPolls = 0;
    let nearMiss = 0;
    let maxTrend = 0;
    const episodes = [];
    let prev = false;
    polls.forEach((p, idx) => {
      if (p.valid) maxTrend = Math.max(maxTrend, p.trend);
      const b = bandFor(p);
      const inBand =
        p.valid && b && p.tenths / 10 >= b.lo && p.tenths / 10 < b.hi &&
        !(p.level != null && p.level < LEVEL_GATE);
      if (inBand) {
        bandPolls++;
        if (p.trend >= 1.0 && p.trend < K_TREND) nearMiss++;
      }
      const flip = wouldFlip(p);
      if (flip && !prev) {
        // find index in native rows for verdict (search by time)
        let i = s.rows.findIndex((r) => r.tS === p.tS);
        const v = i >= 0 ? verdictAt(s.rows, i) : { verdict: "UNRESOLVED" };
        episodes.push({
          tOffsetS: Math.round(p.tS - s.rows[0].tS),
          tempC: p.tenths / 10,
          trend: Number(p.trend.toFixed(4)),
          ...v,
        });
        allEpisodes.push({ session: s.id, cadence: name, ...episodes[episodes.length - 1] });
      }
      prev = flip;
    });
    const flips = episodes.length;
    totals[name] = totals[name] || { sessions: 0, polls: 0, band: 0, flips: 0, TRUE: 0, FALSE: 0, UNRESOLVED: 0 };
    totals[name].sessions++;
    totals[name].polls += polls.length;
    totals[name].band += bandPolls;
    totals[name].flips += flips;
    for (const ep of episodes) totals[name][ep.verdict]++;
    summary.cadences[name] = { polls: polls.length, bandPolls, flips, nearMiss, maxTrend: Number(maxTrend.toFixed(3)), episodes };
  }
  lines.push(JSON.stringify(summary));
}
console.log(lines.join("\n"));
console.log("");
console.log("ALL EPISODES:");
for (const ep of allEpisodes) console.log(JSON.stringify(ep));
console.log("");
console.log("TOTALS (corpus sessions replayed at each cadence):");
for (const [name, t] of Object.entries(totals)) console.log(name, JSON.stringify(t));
console.log("");
console.log("CORPUS SIZE: sessions loaded =", sessions.length, " rows =", grandRows);
console.log("sessions skipped (no sensor-valid sample):", JSON.stringify(skippedNoValid));
console.log("sessions replayed =", sessions.length - skippedNoValid.length);
