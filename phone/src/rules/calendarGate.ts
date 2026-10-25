/**
 * Structural gate for calendar_agenda. No text-similarity: date ranges are
 * not queries. Range presence is the tool schema (required fromISO/toISO);
 * private tokens in any string field are contained (block).
 */

import { containsPrivateData } from "./entityContainment.js";
import type { RuleTable } from "./evaluate";

function asFacts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const facts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") facts.push(item);
  }
  return facts;
}

function stringFields(input: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) out.push(value);
  }
  return out;
}

export const CALENDAR_GATE_TABLE: RuleTable = {
  rules: [
    {
      id: "calendar-private-data",
      priority: 10,
      condition: (input) => {
        const facts = asFacts(input.memoryFacts);
        if (facts.length === 0) return false;
        for (const text of stringFields(input)) {
          for (const fact of facts) {
            const trimmed = fact.trim();
            if (!trimmed) continue;
            if (containsPrivateData(text, trimmed)) return true;
          }
        }
        return false;
      },
      action: { kind: "block", reason: "private-data" },
    },
  ],
};
