import { CALENDAR_GATE_TABLE } from "./calendarGate";
import { evaluateTurn } from "./evaluate";

const FACT = "The user's cat is named Leopoldo and lives in Torino";

function run(
  input: Record<string, unknown>,
) {
  return evaluateTurn({ toolName: "calendar_agenda", input }, CALENDAR_GATE_TABLE);
}

describe("CALENDAR_GATE_TABLE", () => {
  test("empty or malformed range is not gated (schema + executor)", () => {
    const empty = run({ fromISO: "", toISO: "", lastUserMessage: "agenda" });
    expect(empty.blocked).toBe(false);

    const missing = run({ lastUserMessage: "today" });
    expect(missing.blocked).toBe(false);

    const garbage = run({
      fromISO: "not-a-date",
      toISO: "2026-08-26T00:00:00.000Z",
    });
    expect(garbage.blocked).toBe(false);

    const inverted = run({
      fromISO: "2026-08-26T00:00:00.000Z",
      toISO: "2026-08-25T00:00:00.000Z",
    });
    expect(inverted.blocked).toBe(false);
  });

  test("valid range passes", () => {
    const d = run({
      fromISO: "2026-08-25T00:00:00.000Z",
      toISO: "2026-08-26T00:00:00.000Z",
      lastUserMessage: "what's on today",
    });
    expect(d.blocked).toBe(false);
    expect(d.warned).toBe(false);
    expect(d.ruleId).toBe("");
  });

  test("private text in any string field is contained", () => {
    const inMessage = run({
      fromISO: "2026-08-25T00:00:00.000Z",
      toISO: "2026-08-26T00:00:00.000Z",
      lastUserMessage: "Meet with Leopoldo at 3",
      memoryFacts: [FACT],
    });
    expect(inMessage.blocked).toBe(true);
    expect(inMessage.reason).toBe("private-data");
    expect(inMessage.ruleId).toBe("calendar-private-data");
  });
});
