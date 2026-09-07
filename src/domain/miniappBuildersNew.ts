// Builders for the C6c templates added in this session:
// reading_quiz (N questions), kpi_strip, checklist, pros_cons.
//
// Each builder validates its slots strictly and returns `null` on bad input so
// the executor can surface an error instead of rendering a broken miniapp. The
// produced blocks only ever use block types the renderer already supports
// (quiz / metric_strip / timeline / data_table), so no new UI is required.
//
// Field shapes match the renderer exactly (see
// src/ui/AskAssistantMiniappRenderer.tsx):
//   - metric_strip  → block.metrics[] read by getMetricRows/getMetricValue
//   - timeline      → block.steps[] / block.items[] read by TimelineBlockView
//   - data_table    → block.columns[] + block.rows[] read by normalizeTable

import {
  asString,
  asStringCapped,
  asStringArrayCapped,
  envelope,
  isPlainObject,
  safeAnswerIndex,
} from "./miniappBuilders";
import type { AskAssistantMiniapp } from "./askAssistant";
import type { MiniappTemplateId } from "./miniappTemplates";

type Slots = Record<string, unknown>;

const MAX_QUIZ_QUESTIONS = 8;
const MAX_METRICS = 8;
const MAX_STEPS = 12;
const MAX_ROWS = 50;

/** Column labels for the pros_cons data_table. `key` is the stable field used
 *  to look up row values; `label` is the localized header shown in the UI. */
export type ColumnLabels = { pro: string; con: string };

/** English defaults; the executor overrides with locale labels (F-4). */
const DEFAULT_COLUMN_LABELS: ColumnLabels = { pro: "Pro", con: "Con" };

/**
 * reading_quiz → one `quiz` block per question.
 *
 * Requires `questions.length` in 1..8 (reject 0 or >8). Each item is validated
 * exactly like the former single-question quiz (question, 2..4 options, an
 * optional in-range answerIndex, optional explanation), and the builder emits
 * one quiz block per question — no invented multi-question block type.
 */
export function buildNQuestionQuiz(slots: Slots): AskAssistantMiniapp | null {
  const rawQuestions = slots.questions;
  if (!Array.isArray(rawQuestions)) return null;
  if (rawQuestions.length < 1 || rawQuestions.length > MAX_QUIZ_QUESTIONS) {
    return null;
  }

  const blocks: Array<Record<string, unknown>> = [];
  for (const item of rawQuestions) {
    if (!isPlainObject(item)) return null;

    const question = asStringCapped(item.question);
    if (!question) return null;

    const options = asStringArrayCapped(item.options);
    // Cap to 2..4 options. More than 4 is rejected so any safe answerIndex
    // (0..length-1) always addresses a kept option.
    if (!options || options.length < 2 || options.length > 4) return null;

    const block: Record<string, unknown> = {
      type: "quiz",
      question,
      options,
    };
    const answerIndex = safeAnswerIndex(item.answerIndex, options.length);
    if (answerIndex !== undefined) block.answerIndex = answerIndex;
    const explanation = asString(item.explanation);
    if (explanation) block.explanation = explanation;
    blocks.push(block);
  }

  return envelope("reading_quiz", asString(slots.title) ?? "Quiz", blocks);
}

/**
 * kpi_strip → a single `metric_strip` block.
 *
 * Requires 1..8 metrics; each metric needs a non-empty label and a value
 * (string or number). `unit` and `tone` are optional and passed through.
 */
export function buildKpiStrip(slots: Slots): AskAssistantMiniapp | null {
  const rawMetrics = slots.metrics;
  if (!Array.isArray(rawMetrics)) return null;
  if (rawMetrics.length < 1 || rawMetrics.length > MAX_METRICS) return null;

  const metrics: Record<string, unknown>[] = [];
  for (const metric of rawMetrics) {
    if (!isPlainObject(metric)) return null;
    const label = asStringCapped(metric.label);
    if (!label) return null;
    const value = metric.value;
    if (
      value === undefined ||
      value === null ||
      (typeof value !== "string" && typeof value !== "number")
    ) {
      return null;
    }
    const entry: Record<string, unknown> = { label, value };
    const unit = asString(metric.unit);
    if (unit) entry.unit = unit;
    const tone = asString(metric.tone);
    if (tone) entry.tone = tone;
    metrics.push(entry);
  }

  const block: Record<string, unknown> = { type: "metric_strip", metrics };
  const title = asString(slots.title);
  if (title) block.title = title;
  return envelope("kpi_strip", title ?? "KPIs", [block]);
}

/**
 * checklist → a single `timeline` block.
 *
 * Accepts `steps: string[]` OR `items: Array<string | {title, body?}>` and
 * normalizes them to the timeline renderer shape (1..12 entries). String
 * entries become {title}; object entries use `title` when present, otherwise
 * `body` is promoted to the visible title — the renderer only shows title,
 * so no unused `body` field is ever emitted.
 */
export function buildChecklist(slots: Slots): AskAssistantMiniapp | null {
  const rawSteps = slots.steps;
  const rawItems = slots.items;
  const raw = Array.isArray(rawSteps)
    ? rawSteps
    : Array.isArray(rawItems)
      ? rawItems
      : undefined;

  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STEPS) {
    return null;
  }

  const steps: Record<string, unknown>[] = [];
  for (const entry of raw) {
    // Plain-string steps are capped too (F-5): an oversized step rejects the
    // whole build rather than emitting a title the 64 KiB guard might keep.
    const title = asStringCapped(entry);
    if (title) {
      steps.push({ title });
      continue;
    }
    if (!isPlainObject(entry)) return null;
    // TimelineBlockView only renders title/label/time, so never store a `body`
    // field the UI ignores: promote `body` to the visible title only when no
    // title is given, then drop it.
    const stepTitle = asStringCapped(entry.title) ?? asStringCapped(entry.body);
    if (!stepTitle) return null;
    steps.push({ title: stepTitle });
  }

  return envelope(
    "checklist",
    asString(slots.title) ?? "Checklist",
    [{ type: "timeline", title: asString(slots.title), steps }],
  );
}

/**
 * pros_cons → a `data_table` with one row per pro/con pair. Requires >=1 row
 * with at least one non-empty pro/con. Column `key` stays the stable "pro"/"con"
 * used to look up row values; `label` is localized (F-4).
 */
export function buildProsCons(
  slots: Slots,
  labels: ColumnLabels = DEFAULT_COLUMN_LABELS,
): AskAssistantMiniapp | null {
  const rawRows = slots.rows;
  if (!Array.isArray(rawRows)) return null;

  const rows: Record<string, string>[] = [];
  for (const raw of rawRows) {
    if (!isPlainObject(raw)) return null;
    const pro = asStringCapped(raw.pro);
    const con = asStringCapped(raw.con);
    if (!pro && !con) continue; // skip empty rows
    rows.push({ pro: pro ?? "", con: con ?? "" });
  }
  if (rows.length < 1) return null;

  return envelope(
    "pros_cons",
    asString(slots.title) ?? "Pros & Cons",
    [
      {
        type: "data_table",
        columns: [
          { key: "pro", label: labels.pro },
          { key: "con", label: labels.con },
        ],
        rows: rows.slice(0, MAX_ROWS),
      },
    ],
  );
}

/**
 * Dispatch a C6c template id + slots to the matching builder, or null when the
 * template is unknown or its slots fail validation. `labels` localizes the
 * pros_cons column headers (ignored by the other builders).
 */
export function buildC6c(
  templateId: string,
  slots: unknown,
  labels?: ColumnLabels,
): AskAssistantMiniapp | null {
  const safeSlots: Slots = isPlainObject(slots) ? (slots as Slots) : {};

  let built: AskAssistantMiniapp | null;
  switch (templateId as MiniappTemplateId) {
    case "reading_quiz":
      built = buildNQuestionQuiz(safeSlots);
      break;
    case "kpi_strip":
      built = buildKpiStrip(safeSlots);
      break;
    case "checklist":
      built = buildChecklist(safeSlots);
      break;
    case "pros_cons":
      built = buildProsCons(safeSlots, labels);
      break;
    default:
      return null;
  }
  return built;
}