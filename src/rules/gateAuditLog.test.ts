jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

import {
  appendGateAudit,
  clearGateAudit,
  GATE_AUDIT_CAP,
  readGateAudit,
  type GateAuditRecord,
} from "./gateAuditLog";

const QUERY = "SECRET_QUERY_XYZ_LEOPOLDO";
const FACT = "The user's cat is named Leopoldo and lives in Torino";

function rec(i: number): GateAuditRecord {
  return {
    turnId: `t${i}`,
    toolName: "web_search",
    ruleId: i % 2 === 0 ? "echo-of-context" : "none",
    action: i % 2 === 0 ? "block" : "none",
    outcome: i % 2 === 0 ? "blocked" : "passed",
  };
}

describe("gateAuditLog", () => {
  beforeEach(async () => {
    await clearGateAudit();
  });

  test("rotates at cap, keeping the newest entries", async () => {
    for (let i = 0; i < GATE_AUDIT_CAP + 3; i += 1) {
      await appendGateAudit(rec(i));
    }
    const all = await readGateAudit();
    expect(all.length).toBe(GATE_AUDIT_CAP);
    expect(all[0]?.turnId).toBe(`t${3}`);
    expect(all[all.length - 1]?.turnId).toBe(`t${GATE_AUDIT_CAP + 2}`);
  });

  test("serialized entries contain no fact or query strings", async () => {
    await appendGateAudit({
      turnId: "turn-1",
      toolName: "web_search",
      ruleId: "echo-of-memory-fact",
      action: "block",
      outcome: "blocked",
    });
    await appendGateAudit({
      toolName: "calendar_agenda",
      ruleId: "calendar-private-data",
      action: "block",
      outcome: "blocked",
    });
    const raw = JSON.stringify(await readGateAudit());
    expect(raw).not.toContain(QUERY);
    expect(raw).not.toContain(FACT);
    expect(raw).not.toContain("Leopoldo");
    const parsed = JSON.parse(raw) as GateAuditRecord[];
    for (const row of parsed) {
      expect(Object.keys(row).sort()).toEqual(
        expect.arrayContaining(["toolName", "ruleId", "action", "outcome"]),
      );
    }
  });
});
