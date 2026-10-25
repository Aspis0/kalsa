/**
 * Built-in tool-call gate. Literal table — Kalsa has no rules.json.
 * Three block rules: sensitive query patterns, echo of a memory fact, and
 * empty query.
 */

import type { RuleTable } from "./evaluate";
import { containsPrivateData } from "./entityContainment.js";
import { containsSensitivePattern } from "./sensitivePatternGate";

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

export const TOOL_GATE_TABLE: RuleTable = {
  rules: [
    {
      id: "sensitive-pattern-in-query",
      // evaluateTurn sorts descending; keep this above echo-of-memory-fact so
      // the dedicated sensitive-pattern reason wins when both rules fire.
      priority: 25,
      condition: (input) => containsSensitivePattern(asString(input.query)),
      action: { kind: "block", reason: "sensitive-pattern-in-query" },
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
