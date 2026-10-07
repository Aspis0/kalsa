/**
 * reading_quiz → one `quiz` block per question, 1..8 questions. Each question
 * is validated like the former single-question quiz (question, 2..4 options,
 * an optional in-range answerIndex, optional explanation).
 */

import { asString, asStringArrayCapped, asStringCapped, envelope, isPlainObject, safeAnswerIndex } from "./slots";
import type { Miniapp } from "./types";

const MAX_QUIZ_QUESTIONS = 8;

export function buildNQuestionQuiz(slots: Record<string, unknown>): Miniapp | null {
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

  return envelope("reading_quiz", asString(slots.title) ?? "", blocks);
}
