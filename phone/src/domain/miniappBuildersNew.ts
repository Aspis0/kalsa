// Builders for the `create_miniapp` templates the first group does not cover:
// reading_quiz (N questions) and checklist.
//
// Each builder validates its slots strictly and returns `null` on bad input so
// the executor can surface an error instead of rendering a broken miniapp. The
// produced blocks use block types the renderer already supports
// (quiz / checklist).
//
// Field shapes match the renderer exactly (see
// src/ui/AskAssistantMiniappRenderer.tsx):
//   - quiz      → one quiz block per question, read by QuizBlockView
//   - checklist → block.items[] {id, title}, read by ChecklistBlockView

import {
  asString,
  asStringCapped,
  asStringArrayCapped,
  envelope,
  isPlainObject,
  isUnsafeId,
  MAX_ID_CHARS,
  safeAnswerIndex,
  type Slots,
} from "./miniappBuilderCommon";
import type { AskAssistantMiniapp } from "./askAssistant";
import type { MiniappTemplateId } from "./miniappTemplates";

const MAX_QUIZ_QUESTIONS = 8;
const MAX_STEPS = 12;

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
 * checklist → a single `checklist` block of tickable `{id, title}` items.
 *
 * Accepts `steps: string[]` OR `items: Array<string | {id?, title, body?}>`
 * (1..12 entries). The id keys the ticked state, so it must be stable for
 * the life of the stored envelope: a provided id is kept, everything else
 * mints `item-N` — missing, duplicate, unsafe (`__proto__`…) or over-cap ids
 * included, since two items answering to the same key would tick together.
 * `body` is promoted to the title and dropped: nothing reads a hidden field
 * the renderer never draws.
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

  const items: Record<string, unknown>[] = [];
  const taken = new Set<string>();
  let minted = 0;
  for (const entry of raw) {
    // Plain-string steps are capped too (F-5): an oversized step rejects the
    // whole build rather than emitting a title the 64 KiB guard might keep.
    let title: string | null;
    let given: string | null = null;
    if (typeof entry === "string") {
      title = asStringCapped(entry);
    } else if (isPlainObject(entry)) {
      title = asStringCapped(entry.title) ?? asStringCapped(entry.body);
      given = asString(entry.id);
    } else {
      title = null;
    }
    if (!title) return null;
    let id = given !== null && given.length <= MAX_ID_CHARS && !isUnsafeId(given) ? given : null;
    while (!id || taken.has(id)) id = `item-${(minted += 1)}`;
    taken.add(id);
    items.push({ id, title });
  }

  return envelope(
    "checklist",
    asString(slots.title) ?? "Checklist",
    [{ type: "checklist", title: asString(slots.title), items }],
  );
}

/**
 * Dispatch a template id + slots to the matching builder, or null when the
 * template is unknown or its slots fail validation.
 */
export function buildC6c(
  templateId: string,
  slots: unknown,
): AskAssistantMiniapp | null {
  const safeSlots: Slots = isPlainObject(slots) ? (slots as Slots) : {};

  let built: AskAssistantMiniapp | null;
  switch (templateId as MiniappTemplateId) {
    case "reading_quiz":
      built = buildNQuestionQuiz(safeSlots);
      break;
    case "checklist":
      built = buildChecklist(safeSlots);
      break;
    default:
      return null;
  }
  return built;
}