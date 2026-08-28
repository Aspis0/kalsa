import { evaluateTurn, type RuleTable } from "./evaluate";

const WARN_TABLE: RuleTable = {
  rules: [
    {
      id: "always-warn",
      priority: 5,
      condition: () => true,
      action: { kind: "warn" },
    },
  ],
};

const WARN_AND_BLOCK: RuleTable = {
  rules: [
    {
      id: "always-warn",
      priority: 5,
      condition: () => true,
      action: { kind: "warn" },
    },
    {
      id: "always-block",
      priority: 10,
      condition: () => true,
      action: { kind: "block", reason: "nope" },
    },
  ],
};

describe("evaluateTurn warn action", () => {
  test("warn does not block", () => {
    const d = evaluateTurn({ toolName: "t", input: { q: "x" } }, WARN_TABLE);
    expect(d.blocked).toBe(false);
    expect(d.warned).toBe(true);
    expect(d.ruleId).toBe("always-warn");
    expect(d.appliedRewrites).toEqual([]);
  });

  test("block still wins over warn", () => {
    const d = evaluateTurn({ toolName: "t", input: {} }, WARN_AND_BLOCK);
    expect(d.blocked).toBe(true);
    expect(d.warned).toBe(false);
    expect(d.reason).toBe("nope");
    expect(d.ruleId).toBe("always-block");
  });
});
