// Tables from result files (one responsibility: aggregate rows into markdown).
// usage: node report.mjs gemma-default [more-run-names...]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}% (${k}/${n})` : "–");
const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null;
};

function guideTable(rows, variant) {
  const out = [];
  for (const width of [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a)) {
    const rs = rows.filter((r) => r.variant === variant && r.width === width && r.score);
    if (!rs.length) continue;
    const n = rs.length;
    out.push(`| ${width} | ${n} | ${pct(rs.filter((r) => r.score.strict).length, n)} | ${pct(rs.filter((r) => r.score.tolerant).length, n)} | ${pct(rs.filter((r) => r.score.gridOk).length, n)} | ${pct(rs.filter((r) => r.score.labelOk).length, n)} | ${pct(rs.filter((r) => r.score.refused).length, n)} | ${pct(rs.filter((r) => r.score.wrongElement).length, n)} | ${median(rs.map((r) => r.timings?.promptMs))} | ${median(rs.map((r) => r.wallMs))} |`);
  }
  return out;
}

function zoomTable(rows) {
  const out = [];
  for (const width of [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a)) {
    const zs = rows.filter((r) => r.variant === "A-it-zoom" && r.width === width && r.score);
    const firsts = rows.filter((r) => r.variant === "A-it" && r.width === width && r.score);
    if (!zs.length) continue;
    const byKey = (r) => `${r.image}|${r.task}`;
    const fmap = new Map(firsts.map((r) => [byKey(r), r]));
    const pairs = zs.filter((z) => fmap.has(byKey(z)));
    const fixed = pairs.filter((z) => !fmap.get(byKey(z)).score.tolerant && z.score.tolerant).length;
    const broken = pairs.filter((z) => fmap.get(byKey(z)).score.tolerant && !z.score.tolerant).length;
    const n = zs.length;
    out.push(`| ${width} | ${n} | ${pct(zs.filter((r) => r.score.strict).length, n)} | ${pct(zs.filter((r) => r.score.tolerant).length, n)} | ${pct(zs.filter((r) => r.score.labelOk).length, n)} | ${fixed} fixed / ${broken} broken | ${median(zs.map((r) => r.zoom?.cropMs))} + ${median(zs.map((r) => r.wallMs))} |`);
  }
  return out;
}

function readTable(rows, variant, kind) {
  const out = [];
  for (const width of [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a)) {
    const rs = rows.filter((r) => r.variant === variant && r.width === width && r.score);
    if (!rs.length) continue;
    const n = rs.length;
    const sim = (rs.reduce((a, r) => a + (r.score.similarity ?? 0), 0) / n).toFixed(2);
    const ok = kind === "contains" ? rs.filter((r) => r.score.contains).length : rs.filter((r) => r.score.exact).length;
    out.push(`| ${width} | ${n} | ${pct(ok, n)} | ${sim} | ${median(rs.map((r) => r.timings?.promptMs))} |`);
  }
  return out;
}

function tokenTable(rows) {
  const out = [];
  for (const width of [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a)) {
    const per = [];
    for (const r of rows.filter((x) => x.variant === "A-it" && x.width === width && x.timings?.totalN)) {
      const twin = rows.find((x) => x.variant === "twin-A" && x.image === r.image && x.task === r.task && x.width === width);
      if (twin?.timings?.totalN) per.push({ image: r.image, img: r.timings.totalN - twin.timings.totalN, cls: r.class });
    }
    if (!per.length) continue;
    const vals = per.map((p) => p.img);
    out.push(`| ${width} | ${per.length} | ${Math.min(...vals)} | ${median(vals)} | ${Math.max(...vals)} |`);
  }
  return out;
}

function cacheLine(rows) {
  const a = rows.find((r) => r.variant === "cache-repeat-1");
  const b = rows.find((r) => r.variant === "cache-repeat-2");
  if (!a || !b) return "not run";
  return `repeat 1: prompt_n ${a.timings.promptN}, cache_n ${a.timings.cacheN}; repeat 2 (same image, same request): prompt_n ${b.timings.promptN}, cache_n ${b.timings.cacheN}, prompt_ms ${Math.round(b.timings.promptMs)}`;
}

for (const runName of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(join(here, "results", `${runName}.json`), "utf8"));
  const rows = file.rows;
  console.log(`\n## ${runName} — ${file.model}, thinking ${file.thinking ? "on" : "off"}, rows ${rows.length}\n`);
  console.log("### Task A, Italian first pass\n");
  console.log("| width | n | strict point | tolerant point (±2%) | grid cell | label | refusals | wrong element | prompt_ms med | wall ms med |");
  console.log("|---|---:|---|---|---|---|---|---|---:|---:|");
  guideTable(rows, "A-it").forEach((l) => console.log(l));
  console.log("\n### Task A, English first pass\n");
  console.log("| width | n | strict point | tolerant point (±2%) | grid cell | label | refusals | wrong element | prompt_ms med | wall ms med |");
  console.log("|---|---:|---|---|---|---|---|---|---:|---:|");
  guideTable(rows, "A-en").forEach((l) => console.log(l));
  console.log("\n### Zoom second pass (Italian; same goal on the 2x crop)\n");
  console.log("| width | n | strict point | tolerant point | label | paired vs first pass | crop ms + 2nd-pass wall ms (median) |");
  console.log("|---|---:|---|---|---|---|---|");
  zoomTable(rows).forEach((l) => console.log(l));
  console.log("\n### Task B, reading\n");
  console.log("| width | n | B-std exact | B-std similarity | prompt_ms med |");
  console.log("|---|---:|---|---|---:|");
  readTable(rows, "B-std", "exact").forEach((l) => console.log(l));
  console.log("\n| width | n | B-lines contains | B-lines similarity | prompt_ms med |");
  console.log("|---|---:|---|---|---:|");
  readTable(rows, "B-lines", "contains").forEach((l) => console.log(l));
  console.log("\n### Image tokens (total prompt tokens with image minus the text-only twin, Italian task A)\n");
  console.log("| width | n | min | median | max |");
  console.log("|---|---:|---:|---:|---:|");
  tokenTable(rows).forEach((l) => console.log(l));
  console.log(`\nCache check: ${cacheLine(rows)}\n`);
}
