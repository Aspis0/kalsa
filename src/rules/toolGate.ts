/**
 * Built-in tool-call gate. Literal table — Kalsa has no rules.json.
 * Three block rules only: echo of last user message, echo of a memory fact,
 * empty query.
 *
 * echo-of-context: INVERTED comparison — blocks when the search query is
 * UNRELATED to the user's last message (low similarity). A legitimate search
 * paraphrases what the user asked → high similarity → passes. A spurious
 * search is about something else → low similarity → blocked.
 *
 * Two thresholds via a structural signal (question-mark punctuation, not a
 * wordlist): questions ending with "?" or "？" are explicit search requests
 * so use a low threshold; other message forms use a higher threshold.
 *
 * Abstains (does not block) when the comparison is not meaningful:
 * - empty query or empty user message
 * - user message too short (< ECHO_MIN_USER_MSG_LENGTH chars): every query
 *   scores low against it, so the comparison is not reliable
 * - query too short (< ECHO_MIN_QUERY_LENGTH chars): too few 3-grams for
 *   a meaningful cosine
 */

import type { RuleTable } from "./evaluate";
import { cosine, ngramVec } from "./ngramSim";
import { containsPrivateData } from "./entityContainment";

/** High threshold: non-question user messages. */
export const ECHO_SIMILARITY_THRESHOLD = 0.40;
/** Low threshold: question user messages (ending with ? or ?). */
const ECHO_QUESTION_THRESHOLD = 0.15;
/** Minimum user-message length (chars) for the comparison to be meaningful. */
const ECHO_MIN_USER_MSG_LENGTH = 15;
/** Minimum query length (chars) for the comparison to be meaningful. */
const ECHO_MIN_QUERY_LENGTH = 3;
/** Question-mark codepoints across scripts (structural signal, not a wordlist). */
const QUESTION_MARK_RE = /[?\uFF1F]$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFacts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const facts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") facts.push(item);
  }
  return facts;
}

function echoSim(a: string, b: string): number {
  return cosine(ngramVec(a), ngramVec(b));
}

export const TOOL_GATE_TABLE: RuleTable = {
  rules: [
    {
      id: "echo-of-context",
      priority: 20,
      condition: (input) => {
        const query = asString(input.query).trim();
        const last = asString(input.lastUserMessage).trim();
        // Abstain when either side is empty or too short for a meaningful
        // comparison. Failing open is correct: this rule was shown to cost
        // the user a working feature 100% of the time.
        if (!query || !last) return false;
        if (last.length < ECHO_MIN_USER_MSG_LENGTH) return false;
        if (query.length < ECHO_MIN_QUERY_LENGTH) return false;
        const threshold = QUESTION_MARK_RE.test(last)
          ? ECHO_QUESTION_THRESHOLD
          : ECHO_SIMILARITY_THRESHOLD;
        return echoSim(query, last) < threshold;
      },
      action: { kind: "block", reason: "echo-of-context" },
    },
    {
      id: "echo-of-memory-fact",
      priority: 10,
      condition: (input) => {
        const query = asString(input.query).trim();
        if (!query) return false;
        for (const fact of asFacts(input.memoryFacts)) {
          const trimmed = fact.trim();
          if (!trimmed) continue;
          if (containsPrivateData(query, trimmed)) return true;
        }
        return false;
      },
      action: { kind: "block", reason: "echo-of-memory-fact" },
    },
    {
      id: "empty-query",
      priority: 30,
      condition: (input) => asString(input.query).trim() === "",
      action: { kind: "block", reason: "empty-query" },
    },
  ],
};
