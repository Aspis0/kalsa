/**
 * Append-only jsonl store:
 *   results/<name>-campaign/<YYYY-MM-DD>/<arm>/<conv>.jsonl
 * Resume checkpoint {arm,variant,conv,turn}. Retried turns are flagged.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export function campaignRoot(repoRoot, cfg, date = todayStamp()) {
  const rel = cfg.resultsDir || path.join("results", `${cfg.name}-campaign`);
  return path.join(repoRoot, rel, date);
}

export function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function convPath(root, armId, convId) {
  return path.join(root, armId, `${convId}.jsonl`);
}

export function appendTurn(root, armId, convId, record) {
  const file = convPath(root, armId, convId);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

export function readTurns(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export function checkpointPath(root) {
  return path.join(root, "checkpoint.json");
}

export function writeCheckpoint(root, { arm, variant, conv, turn }) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    checkpointPath(root),
    JSON.stringify({ arm, variant, conv, turn, at: new Date().toISOString() }, null, 2),
  );
}

export function readCheckpoint(root) {
  const p = checkpointPath(root);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function flagRetried(record) {
  return { ...record, retried: true };
}

export function evictionPath(root, armId, convId) {
  return path.join(root, armId, `${convId}.eviction.json`);
}

/** First turn with KALSA_DIGEST corpusSize>0 wins. Sidecar + field on the record. */
export function stampEviction(root, armId, convId, rec) {
  const rows = rec?.telemetry?.KALSA_DIGEST || [];
  const hit = rows.some((d) => (d.corpusSize || 0) > 0);
  const file = evictionPath(root, armId, convId);
  if (existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, "utf8"));
    return { ...rec, evictionTurn: prev.evictionTurn };
  }
  if (!hit) return rec;
  const evictionTurn = rec.i ?? rec.turn;
  writeJson(file, { evictionTurn, conv: convId, arm: armId });
  return { ...rec, evictionTurn };
}

export function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function datastoreCli(argv) {
  if (argv[2] === "--append") {
    const root = argv[3];
    const arm = argv[4];
    const conv = argv[5];
    const recFile = argv[6];
    const rec = JSON.parse(readFileSync(recFile, "utf8"));
    const file = appendTurn(root, arm, conv, rec);
    process.stdout.write(file + "\n");
    return;
  }
  if (argv[2] === "--checkpoint") {
    writeCheckpoint(argv[3], {
      arm: argv[4],
      variant: argv[5],
      conv: argv[6],
      turn: Number(argv[7]),
    });
    return;
  }
  if (argv[2] === "--read-checkpoint") {
    const cp = readCheckpoint(argv[3]);
    process.stdout.write(cp ? JSON.stringify(cp) + "\n" : "");
    return;
  }
  if (argv[2] === "--stamp-eviction") {
    const root = argv[3];
    const arm = argv[4];
    const conv = argv[5];
    const recFile = argv[6];
    const rec = JSON.parse(readFileSync(recFile, "utf8"));
    const stamped = stampEviction(root, arm, conv, rec);
    writeFileSync(recFile, `${JSON.stringify(stamped)}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("datastore.mjs")) {
  datastoreCli(process.argv);
}
