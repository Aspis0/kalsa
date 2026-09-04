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

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/tmp/",
  cacheDirectory: "/tmp/",
}));

import { getStrings } from "../i18n";
import { clearGateAudit, readGateAudit } from "./gateAuditLog";
import {
  applyWarnToResult,
  prependWarnNote,
  runToolGate,
} from "./runToolGate";

const QUERY = "SECRET_QUERY_XYZ_LEOPOLDO";
const FACT = "The user's cat is named Leopoldo and lives in Torino";

describe("runToolGate", () => {
  beforeEach(async () => {
    await clearGateAudit();
  });

  test("flag off: web_search still gated, calendar exempt, no audit writes", async () => {
    const blocked = await runToolGate({
      toolName: "web_search",
      args: { query: QUERY },
      lastUserMessage: "hello there how are you doing today?",
      memoryFacts: [FACT],
      toolhelpOn: false,
      locale: "en",
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.text).toBe(getStrings("en").errors.webSearchPrivacyBlocked);

    const cal = await runToolGate({
      toolName: "calendar_agenda",
      args: { fromISO: "", toISO: "" },
      lastUserMessage: QUERY,
      memoryFacts: [FACT],
      toolhelpOn: false,
      locale: "en",
    });
    expect(cal.blocked).toBe(false);
    expect(await readGateAudit()).toEqual([]);
  });

  test("flag on: calendar private-data blocked and audit has no user content", async () => {
    const cal = await runToolGate({
      toolName: "calendar_agenda",
      args: {
        fromISO: "2026-08-25T00:00:00.000Z",
        toISO: "2026-08-26T00:00:00.000Z",
      },
      lastUserMessage: "Meet with Leopoldo at 3",
      memoryFacts: [FACT],
      toolhelpOn: true,
      locale: "en",
      turnId: "turn-9",
    });
    expect(cal.blocked).toBe(true);
    expect(cal.text).toBe(getStrings("en").errors.toolPrivacyBlocked);

    const log = await readGateAudit();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({
      turnId: "turn-9",
      toolName: "calendar_agenda",
      ruleId: "calendar-private-data",
      action: "block",
      outcome: "blocked",
    });
    const raw = JSON.stringify(log);
    expect(raw).not.toContain(QUERY);
    expect(raw).not.toContain(FACT);
    expect(raw).not.toContain("Leopoldo");
  });

  test("unregistered tool is exempt and writes no audit even when flag on", async () => {
    const r = await runToolGate({
      toolName: "miniapp_quiz",
      args: { prompt: QUERY },
      lastUserMessage: QUERY,
      memoryFacts: [FACT],
      toolhelpOn: true,
      locale: "en",
    });
    expect(r.blocked).toBe(false);
    expect(r.warnNote).toBeUndefined();
    expect(await readGateAudit()).toEqual([]);
  });

  test("blocks a bare card number without injected memory facts", async () => {
    const result = await runToolGate({
      toolName: "web_search",
      args: { query: "4111111111111111" },
      lastUserMessage: "What is the weather today?",
      memoryFacts: [],
      toolhelpOn: false,
      locale: "en",
    });

    expect(result.blocked).toBe(true);
    expect(result.decision?.ruleId).toBe("sensitive-pattern-in-query");
    expect(result.decision?.reason).toBe("sensitive-pattern-in-query");
  });

  test("warn prepends the localized note without blocking the result", () => {
    const note = getStrings("en").results.toolWarnedPrivacy;
    const result = { text: "agenda-ok", kind: "calendar_agenda" as const };
    const out = applyWarnToResult(result, note);
    expect(out.text.startsWith(note)).toBe(true);
    expect(out.text).toContain("agenda-ok");
    expect(out.kind).toBe("calendar_agenda");
    expect(prependWarnNote("body", note)).toBe(`${note}\n\nbody`);
  });
});
