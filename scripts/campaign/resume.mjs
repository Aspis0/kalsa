/**
 * Resume plan: skip completed (arm,variant,conv,turn), continue SAME cell.
 * Conv ids are c{n}-{variantId}. Does not reshuffle.
 */
import { readFileSync, existsSync } from "node:fs";
import { readCheckpoint } from "./datastore.mjs";

function convId(n, variant) {
  return `c${n}-${variant}`;
}

function convNum(id) {
  const m = /^c(\d+)-/.exec(String(id || ""));
  return m ? Number(m[1]) : 0;
}

function cellIndex(cells, arm, variant) {
  return cells.findIndex((c) => c.arm === arm && c.variant === variant);
}

export function resumePlan({ cells, checkpoint, nPerVariant, nTurns }) {
  const checkpointConv = String(checkpoint?.conv || "");
  if (checkpoint && (checkpointConv.startsWith("dry-") || !/^c\d+-/.test(checkpointConv))) {
    checkpoint = null;
  }
  const rows = [];
  for (const cell of cells) {
    for (let n = 1; n <= nPerVariant; n++) {
      const id = convId(n, cell.variant);
      if (!checkpoint) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });
        continue;
      }
      const ci = cellIndex(cells, cell.arm, cell.variant);
      const cpi = cellIndex(cells, checkpoint.arm, checkpoint.variant);
      if (cpi < 0 || ci < cpi) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
        continue;
      }
      if (ci > cpi) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });
        continue;
      }
      const cn = convNum(checkpoint.conv);
      if (n < cn) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
      } else if (n > cn) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });
      } else {
        const next = Number(checkpoint.turn) + 1;
        if (next > nTurns) {
          rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
        } else {
          rows.push({
            arm: cell.arm,
            variant: cell.variant,
            conv: id,
            action: "resume",
            startTurn: next,
          });
        }
      }
    }
  }
  return rows;
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : "";
  if (i < 0 || !v || String(v).startsWith("-")) {
    throw new Error(`usage: resume.mjs --root DIR --cells FILE --nconv N --nturns N (missing ${flag})`);
  }
  return v;
}

if (process.argv[1] && process.argv[1].endsWith("resume.mjs")) {
  try {
    const root = arg("--root");
    const cellsFile = arg("--cells");
    const nPer = Number(arg("--nconv"));
    const nTurns = Number(arg("--nturns"));
    const cells = JSON.parse(readFileSync(cellsFile, "utf8")).cells;
    if (!Array.isArray(cells)) throw new Error("cells file missing cells[]");
    const checkpoint = existsSync(root + "/checkpoint.json") ? readCheckpoint(root) : null;
    for (const r of resumePlan({ cells, checkpoint, nPerVariant: nPer, nTurns })) {
      process.stdout.write(`${r.arm} ${r.variant} ${r.conv} ${r.action} ${r.startTurn}\n`);
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
}
