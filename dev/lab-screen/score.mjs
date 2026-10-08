// Scoring for the screen-guide lab (one responsibility: reply vs ground truth).
// Task A: a strict point inside the target box, a tolerant point within TOL of
// it, the grid cell of the target centre, and the label named.
// Task B: exact text and character similarity. B-lines joins the model's lines.
import { TOL, boxCenter, cellCenter, cellOf, inside, normBox } from "./geometry.mjs";
import { GRID_CELLS } from "./prompts.mjs";

export function parseReply(text) {
  const cleaned = String(text ?? "").replace(/```(json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) };
  } catch {
    return { ok: false, value: null };
  }
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const similarity = (got, expected) => Math.max(0, 1 - levenshtein(got, expected) / Math.max(expected.length, 1));

/** Frame-normalised point of a reply, or null when the reply has no numeric point. */
export function pointOf(v) {
  return typeof v.x === "number" && typeof v.y === "number" ? [v.x, v.y] : null;
}

/** A point to zoom on: the numeric point, else the centre of a valid grid cell. */
export function replyPoint(v) {
  if (pointOf(v)) return pointOf(v);
  return GRID_CELLS.includes(v.grid) ? cellCenter(v.grid) : null;
}

export function scoreGuide(parsed, expected, native) {
  const v = parsed.value ?? {};
  const refused = norm(v.label) === "";
  const labelOk = !refused && (norm(v.label).includes(norm(expected.label)) || norm(expected.label).includes(norm(v.label)));
  const box = normBox(expected.box_px, native);
  const point = pointOf(v);
  const expectedGrid = cellOf(...boxCenter(box));
  return {
    formatOk: parsed.ok && (refused || "label" in v),
    refused,
    labelOk,
    hasPoint: point !== null,
    strict: point !== null && inside(point, box, 0),
    tolerant: point !== null && inside(point, box, TOL),
    gridOk: v.grid === expectedGrid,
    wrongElement: !refused && !labelOk,
  };
}

export function scoreRead(parsed, expectedText) {
  const got = norm(parsed.value?.text);
  const want = norm(expectedText);
  return { formatOk: parsed.ok && typeof parsed.value?.text === "string", exact: got === want, similarity: similarity(got, want) };
}

export function scoreLines(parsed, expectedText) {
  const lines = Array.isArray(parsed.value?.lines) ? parsed.value.lines : null;
  const got = norm(lines ? lines.join(" ") : "");
  const want = norm(expectedText);
  return { formatOk: parsed.ok && lines !== null, contains: got.includes(want), similarity: similarity(got, want) };
}
