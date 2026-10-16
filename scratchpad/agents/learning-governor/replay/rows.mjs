/**
 * Read a Stage 0 observation JSONL into rows the derivations can trust.
 * Responsibility: parse the lines, refuse a window ring this replay cannot
 * read, and drop the gap rows the replay must not measure across.
 */
import { readFileSync } from "node:fs";

/** decode_window_samples column order (llama.rn src/types.ts:378-383).
 *  WHY the width is checked: DESIGN 3.2 sketches 11 cells, the wire carries
 *  13 (applied_headroom, applied_status and duty_last ride beside the zone
 *  temps per coordinator note 1). A ring of another width is a different
 *  producer, so guessing its columns would invent measurements. */
const WINDOW_CELLS = 13;

export const WIN = {
  tokens: 0,
  leg: 1,
  headroom: 2,
  headroomAge: 3,
  status: 4,
  statusAge: 5,
  appAge: 6,
  hotCpu: 7,
  hotNpu: 8,
  hotGpu: 9,
  appliedHeadroom: 10,
  appliedStatus: 11,
  dutyLast: 12,
};

export const HOT_CELL = { cpu: WIN.hotCpu, gpu: WIN.hotGpu, npu: WIN.hotNpu };

/** WHY the leg code doubles as the column index: the row's tok/us triples are
 *  [cpu, gpu, npu] and the binding codes leg_prev 0 cpu, 1 gpu, 2 npu. */
export const LEGS = ["cpu", "gpu", "npu"];

/** The binding's gpu-coolmode marker (types.ts:382): the engine books those
 *  tokens under decode_tokens_cpu and excludes them from Stage 0 learning. */
export const COOLMODE_LEG = 3;

const cellCount = (value) => (Array.isArray(value) ? value.length : "no");

const checkRing = (ring, where) => {
  if (!Array.isArray(ring)) throw new Error(`${where}: win is not an array`);
  ring.forEach((sample, index) => {
    if (cellCount(sample) !== WINDOW_CELLS) {
      throw new Error(
        `${where}: win[${index}] has ${cellCount(sample)} cells, this replay reads ${WINDOW_CELLS}`,
      );
    }
  });
};

const parseRow = (line, where) => {
  let row;
  try {
    row = JSON.parse(line);
  } catch (error) {
    throw new Error(`${where}: ${error.message}`);
  }
  checkRing(row.win, where);
  // `first` is one sample, not a ring of them.
  if (cellCount(row.first) !== WINDOW_CELLS) {
    throw new Error(`${where}: first has ${cellCount(row.first)} cells, this replay reads ${WINDOW_CELLS}`);
  }
  if (!Array.isArray(row.wall) || row.wall.length !== 2) {
    throw new Error(`${where}: wall is not a [first_ms, last_ms] pair`);
  }
  return row;
};

/**
 * `droppedGap` counts the gap:1 rows the replay refuses to measure across: a
 * gap row's deltas span two completions (DESIGN 3.2), so its tokens, times
 * and window ring describe none of the completions it is filed under.
 */
export function readObservations(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const rows = [];
  const droppedGap = [];
  let read = 0;
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    read += 1;
    const where = `${path}:${index + 1}`;
    const row = parseRow(line, where);
    if (row.gap === 1) droppedGap.push(row);
    else rows.push(row);
  });
  return { rows, droppedGap, lines: read };
}