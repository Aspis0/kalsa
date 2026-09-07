/** Structural privacy gate for web_fetch network inputs. */

import type { RuleTable } from "./evaluate";
import { containsSensitivePattern } from "./sensitivePatternGate";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const WEB_FETCH_GATE_TABLE: RuleTable = {
  rules: [
    {
      id: "sensitive-pattern-in-url",
      priority: 26,
      condition: (input) => containsSensitivePattern(asString(input.url)),
      action: { kind: "block", reason: "sensitive-pattern-in-url" },
    },
    {
      id: "sensitive-pattern-in-query",
      priority: 25,
      condition: (input) => containsSensitivePattern(asString(input.query)),
      action: { kind: "block", reason: "sensitive-pattern-in-query" },
    },
  ],
};
