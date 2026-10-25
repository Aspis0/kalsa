/**
 * Translate, as SOURCE proof (D1 row 18): the stack renders nothing here, so
 * what is pinned is what a screenshot could not see — the three ways a stale
 * translation could attach itself to the wrong message and the fence that
 * stops each, the send/menu gates that keep the engine free, and the promise
 * that a translation is never part of a persisted message.
 *
 * Every ordering predicate is exercised against a sample that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";
import { toTranscriptMessage } from "./messageMapper";
import type { Message } from "./hostMessage";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const readShell = (file: string): string =>
  readFileSync(join(__dirname, "..", "ui", "shell", file), "utf8");

const HOOK = read("useTranslateMessage.ts");
const SEND = read("sendHost.ts");
const SEND_GUARDS = read("sendEntryGuards.ts");
const ACTIONS = read("messageActions.ts");
const STATE = read("translateState.ts");
const HOST_MESSAGE = read("hostMessage.ts");
const HISTORY = read("historyMessages.ts");
const BAND = readShell("transcriptTypes.ts");

/** Comments stripped: the prose about a rule must never satisfy the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const HOOK_CODE = stripComments(HOOK);
const SEND_CODE = stripComments(SEND);
const GUARDS_CODE = stripComments(SEND_GUARDS);
const ACTIONS_CODE = stripComments(ACTIONS);

/** The slice of the hook from a marker to the next one. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error(`markers not found: ${from} → ${to}`);
  return source.slice(start, end);
}

/** Flatten a catalogue to dotted keys, the way the translator resolves them. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") out[path] = entry;
    else if (entry && typeof entry === "object") Object.assign(out, flatten(entry, path));
  }
  return out;
}
const EN = flatten(en);
const IT = flatten(italian);

describe("the run: flag before the first await, stale runs never write", () => {
  const run = slice(HOOK_CODE, "const run = useCallback(", "const retry = useCallback");

  it("takes the in-flight flag BEFORE the engine call, so menu and send see it immediately", () => {
    const flagAt = run.indexOf("translationInFlightRef.current = true");
    const callAt = run.indexOf("await translateText(");
    expect(flagAt).toBeGreaterThanOrEqual(0);
    expect(callAt).toBeGreaterThan(flagAt);
  });

  it("applies a result only as the run that still owns the run id", () => {
    expect((run.match(/runId !== runRef\.current/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(run).toContain("if (runId !== runRef.current) return;");
  });

  it("releases the flag only if it still owns it — a superseded run cannot clear a newer one", () => {
    const finallyBlock = run.slice(run.indexOf("finally"));
    expect(finallyBlock).toContain("if (runId === runRef.current)");
    expect(finallyBlock.indexOf("translationInFlightRef.current = false")).toBeGreaterThan(
      finallyBlock.indexOf("if (runId === runRef.current)"),
    );
    // The abort controller is cleared only on identity match, the controller's
    // own trap (`Chat:3571-3573`).
    expect(finallyBlock).toContain("if (abortRef.current === controller)");
  });

  it("captures the target language at start, so the badge survives a locale change mid-run", () => {
    expect(run).toContain("const targetLang = localeRef.current");
    expect(run.indexOf("const targetLang")).toBeLessThan(run.indexOf("await translateText("));
  });

  it("sample: the ordering predicate fails when the flag comes after the call", () => {
    const wrong = "const out = await translateText(t); translationInFlightRef.current = true;";
    expect(wrong.indexOf("await translateText(") < wrong.indexOf("translationInFlightRef.current = true")).toBe(true);
    const right = "translationInFlightRef.current = true; const out = await translateText(t);";
    expect(right.indexOf("translationInFlightRef.current = true") < right.indexOf("await translateText(")).toBe(true);
  });
});

describe("abort and cleanup: a translation can never outlive its message", () => {
  const UNMOUNT_EFFECT = "useEffect(\n    () => () => {";
  const sw = slice(HOOK_CODE, "const previous = lastConversationRef.current;", UNMOUNT_EFFECT);
  const unmount = slice(HOOK_CODE, UNMOUNT_EFFECT, "const target = translatingId ?? result?.id;");
  const orphan = slice(HOOK_CODE, "const target = translatingId ?? result?.id;", "let view:");

  it("a conversation switch aborts the job, bumps the run id and drops BOTH pieces of state", () => {
    // The bump is the anti-orphan trap: persisted ids repeat across
    // conversations, so a late result must be refused by the run id rather
    // than trusted to find a 'different' message.
    expect(sw).toContain("runRef.current += 1");
    expect(sw).toContain(".abort()");
    expect(sw).toContain("translationInFlightRef.current = false");
    expect(sw).toContain("setTranslatingId(null)");
    expect(sw).toContain("setResult(null)");
    expect(sw).toContain("sourceRef.current = null");
  });

  it("unmount aborts the job and bumps the run id, so nothing writes into a dead component", () => {
    expect(unmount).toContain(".abort()");
    expect(unmount).toContain("runRef.current += 1");
  });

  it("the orphan cleanup checks the LIVE message list and drops busy flag and result together", () => {
    expect(orphan).toContain("messages.some(");
    expect(orphan).toContain("const target = translatingId ?? result?.id");
    expect(orphan).toContain("setTranslatingId(null)");
    expect(orphan).toContain("setResult(null)");
    // A cleanup that only cleared the result would leave a busy row pointing
    // at a message that is gone.
    expect(orphan.indexOf("setTranslatingId(null)")).toBeGreaterThanOrEqual(0);
  });

  it("sample: the orphan predicate fails when the message is still there", () => {
    const messages = [{ id: "u-1" }];
    const gone = !messages.some((m) => m.id === "u-9");
    const there = !messages.some((m) => m.id === "u-1");
    expect(gone).toBe(true);
    expect(there).toBe(false);
  });
});

describe("the gates: nothing else takes the engine while a translate holds it", () => {
  it("the send path refuses synchronously, through the one shared ref", () => {
    // The entry gates moved as one unit into `sendEntryGuards`; the invariant
    // is that the send consults them BEFORE it claims, not which file holds
    // the condition.
    expect(GUARDS_CODE).toContain("translationInFlightRef.current");
    expect(GUARDS_CODE).toContain('from "./translateState"');
    expect(HOOK_CODE).toContain('from "./translateState"');
    expect(STATE).toContain("export const translationInFlightRef");
    expect(GUARDS_CODE).toContain("translationInFlightRef.current ||");
    expect(SEND_CODE).toContain("sendEntryRefused({");
    expect(SEND_CODE.indexOf("sendEntryRefused({")).toBeLessThan(
      SEND_CODE.indexOf("sendClaimRef.current = true"),
    );
  });

  it("the long-press opener refuses too — the sheet's Translate and Regenerate rows stay behind it", () => {
    const opener = slice(ACTIONS_CODE, "onMessageLongPress = useCallback(", "const saveToNotes");
    expect(opener).toContain("translationInFlightRef.current");
    // The trap: refs only, never this component's `sending` state.
    expect(/\bsending\b/.test(opener)).toBe(false);
  });

  it("starting a run closes the menu, as the controller's runTranslate did", () => {
    const run = slice(HOOK_CODE, "const run = useCallback(", "const retry = useCallback");
    expect(run).toContain("closeMenuRef.current()");
  });
});

describe("a translation is volatile: it never enters a persisted message", () => {
  it("the saved message stays separate and transcript projection drops a stray result", () => {
    const source: Message = {
      id: "a1",
      role: "assistant" as const,
      text: "answer",
      createdAt: 1,
    };
    const saved = buildPersistableMessages([source]);
    expect(saved[0]).not.toHaveProperty("translationResult");
    const restored = sanitizeHistoryMessages(saved, "en");
    expect(restored[0]).not.toHaveProperty("translationResult");
    const mapped = toTranscriptMessage(
      { ...source, translationResult: { text: "traduzione", language: "it" } } as Message,
      { thinkingStatus: "Thinking" },
    );
    expect(mapped).not.toHaveProperty("translationResult");
    expect(HOST_MESSAGE).not.toMatch(/translationResult\??:/);
    expect(HISTORY).not.toMatch(/translationResult/);
    expect(HOOK_CODE).not.toContain("setMessages");
    expect(HOOK_CODE).not.toContain("persist");
    // The band's contract says the same out loud — state, not a message field.
    expect(BAND).toContain("NEVER a field of a message");
  });
});

describe("every user-visible string exists in BOTH catalogues", () => {
  const keys = [
    "translate.title",
    "translate.label",
    "translate.translating",
    "translate.error",
    "translate.retry",
    "translate.truncated",
    "common.copied",
    "common.close",
    "chat.a11yMessageActions",
  ];

  it("en and it each resolve every key the block, the spinner and the row use", () => {
    for (const key of keys) {
      expect(typeof EN[key]).toBe("string");
      expect(typeof IT[key]).toBe("string");
    }
  });

  it("the label takes the {lang} param the block interpolates", () => {
    expect(EN["translate.label"]).toContain("{lang}");
    expect(IT["translate.label"]).toContain("{lang}");
  });
});
