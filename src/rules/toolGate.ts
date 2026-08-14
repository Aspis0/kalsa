/**
 * Built-in tool-call gate. Literal table — Kalsa has no rules.json.
 * Three block rules only: echo of last user message, echo of a memory fact,
 * empty query. Threshold chosen from harness similarities (see scripts/rulesCoreHarness.mjs).
 */

import type { RuleTable } from "./evaluate";
import { cosine, ngramVec } from "./ngramSim";
import { containsPrivateData } from "./entityContainment";

/** Separates every harness block case from every allow case. */
export const ECHO_SIMILARITY_THRESHOLD = 0.18;

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
        if (!query || !last) return false;
        return echoSim(query, last) >= ECHO_SIMILARITY_THRESHOLD;
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
