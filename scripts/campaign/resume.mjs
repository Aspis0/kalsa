/**
 * Resume plan — N2/N3-correct (re-audit GLM-5.3):
 * - CELL WITH HOLES (anywhere): action "invalid" -> quarantine jsonl + wipe
 *   device + restart from turn 1. NEVER resume a hole inside an existing
 *   conversation: resuming would RE-SEND turns that already have real records
 *   (duplicates, N3) and, for cells behind the checkpoint, would run in the
 *   WRONG on-device chat (cross-cell restore, N2).
 * - CHECKPOINT CELL with NO holes and turn < nTurns: "resume" (on-device chat
 *   IS this conversation). If complete: "skip".
 * - Cells before the checkpoint (complete): "skip".
 * - Everything else: "new" (arm_begin wipes the chat anyway).
 * Conv ids are c{n}-{variantId}. Does not reshuffle.
 */
import { readFileSync, existsSync } from "node:fs";
import { readCheckpoint, readTurns } from "./datastore.mjs";

function convPath(root, arm, conv) {
  return `${root}/${arm}/${conv}.jsonl`;
}

/**
 * First missing turn in [1..nTurns] for a conversation, or null if the jsonl
 * covers every turn with a non-RECOVERY record. RECOVERY/COLLECT_FAIL rows are
 * markers and do not fill a hole (recovery rows are retries of real turns; a
 * COLLECT_FAIL is a turn with a partial record — treat as real so the turn is
 * not re-sent; see N3).
 */
export function firstMissingTurn(root, arm, conv, nTurns) {
  const file = convPath(root, arm, conv);
  if (!existsSync(file)) return 1; // N8: no data at all => start from 1
  const turns = new Set();
  for (const r of readTurns(file)) {
    if (r && r.event !== "RECOVERY" && Number.isFinite(r.i)) turns.add(Number(r.i));
  }
  for (let i = 1; i <= nTurns; i++) {
    if (!turns.has(i)) return i;
  }
  return null;
}

function convStarted(root, arm, conv) {
  return existsSync(convPath(root, arm, conv));
}

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

export function resumePlan({ cells, checkpoint, nPerVariant, nTurns, root }) {
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
      // A conversation that never started (no jsonl) is "new" — no holes to
      // fill, nothing to quarantine (N8 fixed but must not turn fresh cells
      // into invalid).
      if (!convStarted(root, cell.arm, id)) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });
        continue;
      }
      const hole = firstMissingTurn(root, cell.arm, id, nTurns);
      const cn = convNum(checkpoint.conv);
      const sameCell = cpi === ci && cn === n;

      if (hole !== null && !sameCell) {
        // N2/N3: only cells BEHIND the checkpoint with holes are quarantined
        // (their on-device chat is the wrong conversation — restoring would
        // poison both). The CHECKPOINT cell itself is never invalid: its jsonl
        // is the ground truth of the live chat, resume-from-hole fills the
        // missing turns without re-sending landed ones.
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "invalid", startTurn: 1 });
        continue;
      }

      if (hole === null && !sameCell && (cpi < 0 || ci < cpi || cn > n)) {
        // Complete conversation behind the checkpoint.
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
        continue;
      }
      if (!sameCell && (ci > cpi || cn < n)) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });
        continue;
      }

      // Checkpoint cell: resume from the first hole (if any) — the on-device
      // chat is this conversation, so restore_same_conv is correct and landed
      // turns are never re-sent (campaign_user_landed guard).
      const startTurn = hole !== null ? hole : Number(checkpoint.turn) + 1;
      if (startTurn > nTurns) {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
      } else {
        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "resume", startTurn });
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
    for (const r of resumePlan({ cells, checkpoint, nPerVariant: nPer, nTurns, root })) {
      process.stdout.write(`${r.arm} ${r.variant} ${r.conv} ${r.action} ${r.startTurn}\n`);
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
}