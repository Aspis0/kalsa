/**
 * Fisher-Yates shuffle of arm×variant cells. Persist seed. Never run
 * monotone R1→R8: reshuffle if the arm sequence is sorted.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fisherYates(items, rng) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

export function cellsFrom(cfg) {
  const cells = [];
  for (const arm of cfg.arms) {
    for (const variant of cfg.variants) {
      cells.push({ arm: arm.id, variant: variant.id });
    }
  }
  return cells;
}

function armSequence(cells) {
  const seen = [];
  for (const c of cells) {
    if (seen[seen.length - 1] !== c.arm) seen.push(c.arm);
  }
  return seen;
}

export function isMonotoneArms(cells, armIds) {
  const seq = armSequence(cells);
  if (seq.length !== armIds.length) return false;
  return seq.every((id, i) => id === armIds[i]);
}

export function shuffleCells(cfg, seed) {
  const rng = mulberry32(seed >>> 0);
  const armIds = cfg.arms.map((a) => a.id);
  let cells = fisherYates(cellsFrom(cfg), rng);
  let guard = 0;
  while (isMonotoneArms(cells, armIds) && guard < 32) {
    cells = fisherYates(cells, rng);
    guard += 1;
  }
  if (isMonotoneArms(cells, armIds)) {
    throw new Error("runOrder produced monotone R1→R8 after reshuffle");
  }
  return cells;
}

export function persistOrder(dir, seed, cells) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "run-order.json");
  writeFileSync(file, JSON.stringify({ seed, cells }, null, 2) + "\n");
  return file;
}

export function loadOrder(dir) {
  const file = path.join(dir, "run-order.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function resolveSeed(explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return Number(explicit) >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

if (process.argv[1] && process.argv[1].endsWith("runOrder.mjs")) {
  const { loadCampaign } = await import("./config.mjs");
  const cfg = loadCampaign(process.argv[2]);
  const seed = resolveSeed(process.argv[3]);
  const cells = shuffleCells(cfg, seed);
  const dir = process.argv[4];
  persistOrder(dir, seed, cells);
  process.stdout.write(JSON.stringify({ seed, n: cells.length }) + "\n");
}
