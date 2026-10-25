/**
 * `miniapp_v1` soft parse / normalize — the phone's `normalizeMiniapp` from
 * `src/domain/askAssistant.js`, with the bounds it enforces.
 *
 * Tolerant by design: missing optional fields get safe defaults; unknown
 * block types pass through (the renderer draws nothing for them).
 * answerIndex is NEVER defaulted to 0: invalid/missing → null (grading
 * disabled).
 */

import type { Miniapp } from "./types";

const MAX_MINIAPP_BLOCKS = 24;
const MAX_MINIAPP_ACTIONS = 24;
const MAX_QUIZ_OPTIONS = 4;
const MAX_STRING = 2000;
const MAX_TITLE = 200;
const MAX_KIND = 100;
const MAX_QUESTION = 500;
const MAX_OPTION = 200;
const MAX_EXPLANATION = 1000;
/** Hard cap on serialized block size (unknown / oversized → { type: "unknown" }). */
const MAX_BLOCK_JSON_BYTES = 64 * 1024;

function clipString(value: unknown, max = MAX_STRING, fallback = ""): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * True only for an explicit integer addressing a real option
 * (0..optionCount-1). Missing/NaN/out-of-range → null (no grading).
 */
function parseAnswerIndex(raw: unknown, optionCount: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  // Reject non-integer strings like "1.5" / "01" / "1e0" — require exact integer form.
  if (typeof raw === "string" && !/^\s*-?\d+\s*$/.test(raw)) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= optionCount) return null;
  return n;
}

/**
 * Normalize a quiz block.
 * Real options only — never invent synthetic "Option N" pads (a person could
 * pick a fake answer). answerIndex is null when missing/invalid so the UI
 * disables grading instead of falsely marking option 0 as correct.
 */
function normalizeQuizBlock(block: Record<string, unknown>): Record<string, unknown> {
  const rawOptions = Array.isArray(block.options) ? block.options : [];
  const options = rawOptions
    .slice(0, MAX_QUIZ_OPTIONS)
    .map((entry, index) => clipString(entry, MAX_OPTION, `Option ${index + 1}`));
  const answerIndex = parseAnswerIndex(block.answerIndex, options.length);
  const question = clipString(block.question ?? block.title, MAX_QUESTION, "Question");
  const explanation = clipString(block.explanation, MAX_EXPLANATION, "");
  const title = clipString(block.title, MAX_TITLE, "");
  return {
    type: "quiz",
    question,
    options,
    answerIndex,
    ...(explanation ? { explanation } : {}),
    ...(title ? { title } : {}),
  };
}

/** Soft-normalize one block. Oversized / non-objects become { type: "unknown" }. */
export function normalizeMiniappBlock(block: unknown): Record<string, unknown> {
  if (!isPlainObject(block)) return { type: "unknown" };
  // Cap unknown/any block payload size so history/render cannot hang on huge blobs.
  try {
    const serialized = JSON.stringify(block);
    if (typeof serialized === "string" && serialized.length > MAX_BLOCK_JSON_BYTES) {
      return { type: "unknown" };
    }
  } catch {
    return { type: "unknown" };
  }
  const type = clipString(block.type, 64, "unknown");
  if (type === "quiz") return normalizeQuizBlock(block);
  // Apply common string caps even to unknown types (title/question/option/explanation).
  const out: Record<string, unknown> = { ...block, type };
  if ("title" in out) out.title = clipString(out.title, MAX_TITLE, "");
  if ("question" in out) out.question = clipString(out.question, MAX_QUESTION, "");
  if ("explanation" in out) out.explanation = clipString(out.explanation, MAX_EXPLANATION, "");
  if (Array.isArray(out.options)) {
    out.options = out.options
      .slice(0, MAX_QUIZ_OPTIONS)
      .map((entry, index) => clipString(entry, MAX_OPTION, `Option ${index + 1}`));
  }
  return out;
}

/**
 * Normalize a miniapp object into miniapp_v1 shape, or null if unusable.
 * Accepts schema "miniapp_v1" | "aspis_miniapp_v1", or kind+title+blocks
 * without schema.
 */
export function normalizeMiniapp(raw: unknown): Miniapp | null {
  if (!isPlainObject(raw)) return null;
  const hasSchema = raw.schema === "miniapp_v1" || raw.schema === "aspis_miniapp_v1";
  const hasEnvelope =
    typeof raw.kind === "string" &&
    typeof raw.title === "string" &&
    Array.isArray(raw.blocks);
  if (!hasSchema && !hasEnvelope) return null;
  if (!hasEnvelope) return null;

  const blocks = (raw.blocks as unknown[])
    .slice(0, MAX_MINIAPP_BLOCKS)
    .map(normalizeMiniappBlock);

  const miniapp: Miniapp = {
    schema: "miniapp_v1",
    kind: clipString(raw.kind, MAX_KIND, "miniapp"),
    // An empty title is the model having given none: the view supplies the
    // localized name, so no default word is persisted as data.
    title: clipString(raw.title, MAX_TITLE, ""),
    blocks,
  };

  if (Array.isArray(raw.actions)) {
    miniapp.actions = raw.actions.slice(0, MAX_MINIAPP_ACTIONS) as Array<Record<string, unknown>>;
  }
  if (isPlainObject(raw.computed)) miniapp.computed = raw.computed;
  if (isPlainObject(raw.state)) {
    miniapp.state = raw.state;
    // The widgets' own state is bounded by their shapes (an item count, a
    // field count); a stored blob that has grown past the block guard would
    // grow the stored message without limit, so it is dropped here and the
    // widgets start clean rather than the whole envelope degrading.
    try {
      if (JSON.stringify(miniapp).length > MAX_BLOCK_JSON_BYTES) delete miniapp.state;
    } catch {
      delete miniapp.state;
    }
  }
  if (isPlainObject(raw.navigation)) miniapp.navigation = raw.navigation;
  if (isPlainObject(raw.interaction)) miniapp.interaction = raw.interaction;

  return miniapp;
}
