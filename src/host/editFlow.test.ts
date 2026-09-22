/**
 * Edit-then-resend (D1 row 17), split by topic from the menu's own tests:
 * `planEdit`'s truncate as behaviour, and the save's FENCE as source — that
 * it reuses the regenerate's handoff instead of growing a second truncate,
 * that the busy guard runs before anything is mutated, and that the edited
 * badge crosses mapper → band → both catalogues.
 *
 * Every predicate is exercised against a sample that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import type { Message } from "./hostMessage";
import { planEdit, planRegenerate } from "./regenPlan";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const readShell = (file: string): string =>
  readFileSync(join(__dirname, "..", "ui", "shell", file), "utf8");

const EDIT = read("useEditMessage.ts");
const RESEND = read("truncateAndResend.ts");
const ACTIONS = read("messageActions.ts");
const SEND = read("sendHost.ts");
const MAPPER = read("messageMapper.ts");
const TURNS = readShell("TranscriptTurns.tsx");

/** Comments stripped: the prose about a rule must never satisfy the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const EDIT_CODE = stripComments(EDIT);
const RESEND_CODE = stripComments(RESEND);
const ACTIONS_CODE = stripComments(ACTIONS);
const SEND_CODE = stripComments(SEND);
const MAPPER_CODE = stripComments(MAPPER);
const TURNS_CODE = stripComments(TURNS);

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

function user(id: string, text: string): Message {
  return { id, role: "user", text, createdAt: 1 };
}
function assistant(id: string, text: string): Message {
  return { id, role: "assistant", text, createdAt: 2 };
}

describe("planEdit: what an edit truncates — the same rule as a regenerate", () => {
  const thread = [
    user("u1", "first question"),
    assistant("a1", "first answer"),
    user("u2", "second question"),
    assistant("a2", "second answer"),
  ];

  it("keeps everything before the target user turn, drops the turn and everything after, and re-sends the EDITED text", () => {
    const plan = planEdit(thread, "u2", "  second question, fixed  ");
    expect(plan).not.toBeNull();
    expect(plan!.userId).toBe("u2");
    expect(plan!.text).toBe("second question, fixed"); // trimmed once, here
    expect(plan!.base.map((m) => m.id)).toEqual(["u1", "a1"]);
    // …the same drop `planRegenerate` makes: one rule, two anchors.
    const regen = planRegenerate(thread, "a2");
    expect(regen!.base.map((m) => m.id)).toEqual(plan!.base.map((m) => m.id));
  });

  it("editing an EARLIER turn truncates everything after it — the harder case", () => {
    const plan = planEdit(thread, "u1", "reworded first");
    expect(plan).not.toBeNull();
    expect(plan!.base).toEqual([]);
    expect(plan!.text).toBe("reworded first");
  });

  it("kept messages keep their identity (the write guard's id set depends on it)", () => {
    const plan = planEdit(thread, "u2", "new")!;
    expect(plan.base[0]).toBe(thread[0]);
    expect(plan.base[1]).toBe(thread[1]);
  });

  it("refuses honestly, before any truncate: unknown id, an answer as the target, empty text", () => {
    expect(planEdit(thread, "nope", "text")).toBeNull();
    // The role check: only a user bubble anchors an edit, so a mis-targeted
    // id can never truncate history from the answer's side.
    expect(planEdit(thread, "a2", "text")).toBeNull();
    expect(planEdit(thread, "u2", "   \n ")).toBeNull();
  });

  it("sample: the plan is not vacuous — a full base would mean no drop at all", () => {
    const noDrop = planEdit([user("u1", "only")], "u1", "changed")!;
    expect(noDrop.base).toEqual([]);
    expect(noDrop.base).not.toHaveLength(thread.length);
  });
});

describe("the save's fence: ONE handoff, shared with regenerate", () => {
  it("the edit save checks (refs only), plans, then delegates — it never writes history itself", () => {
    expect(EDIT_CODE).toContain("regenInFlightRef.current");
    expect(EDIT_CODE).toContain("sendClaimRef.current");
    expect(EDIT_CODE).toContain("historyLoadedRef.current");
    expect(EDIT_CODE).toContain("planEdit(");
    expect(EDIT_CODE).toContain("truncateAndResend(");
    expect(EDIT_CODE).not.toContain("setMessages(() =>");
    expect(EDIT_CODE).not.toContain("armDeclaredShrink");
  });

  it("regenerate delegates to the SAME handoff — there is no second truncate to drift", () => {
    expect(ACTIONS_CODE).toContain("truncateAndResend(");
    expect(ACTIONS_CODE).not.toContain("armDeclaredShrink");
    // The declared shrink exists in exactly one place among these files.
    expect(RESEND_CODE).toContain("history.historyGuard.armDeclaredShrink(plan.base)");
    expect(
      [ACTIONS_CODE, EDIT_CODE, SEND_CODE].filter((code) => code.includes("armDeclaredShrink")),
    ).toEqual([]);
  });

  it("the guard runs before the plan, and every refusal speaks a shipped key", () => {
    const order = ["regenInFlightRef.current", "planEdit(", "truncateAndResend("].map((needle) => {
      const at = EDIT_CODE.indexOf(needle);
      expect([needle, at >= 0]).toEqual([needle, true]);
      return at;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(EDIT_CODE).toContain('"chat.regenBusy"');
    expect(EDIT_CODE).toContain('"chat.editEmpty"');
    expect(RESEND_CODE).toContain('"chat.regenFailed"');
  });

  it("the modal closes only when the claim took (the helper reports the rollback as false)", () => {
    expect(EDIT_CODE).toContain("if (ok) setEditing(null)");
    expect(RESEND_CODE).toContain("return false");
    expect(RESEND_CODE).toContain("return true");
  });

  it("sample: two implementations of the truncate would trip the drift check", () => {
    const drifted = "base.slice(0, i); armDeclaredShrink(base);";
    expect(drifted).toContain("armDeclaredShrink");
    expect([drifted].filter((code) => code.includes("armDeclaredShrink"))).toHaveLength(1);
  });
});

describe("the edited bubble: stamped at creation, drawn as the badge", () => {
  it("both append sites stamp `edited: true` on the re-sent user message", () => {
    const stamps = SEND_CODE.match(/\.\.\.\(opts\?\.edited \? \{ edited: true \} : \{\}\)/g) ?? [];
    expect(stamps).toHaveLength(2);
    expect(SEND_CODE).toContain("opts?: { edited?: boolean }");
  });

  it("the save asks for the stamp; regenerate does not (its bubble must stay unbadged)", () => {
    expect(EDIT_CODE).toContain("{ edited: true }");
    const regen = ACTIONS_CODE.slice(
      ACTIONS_CODE.indexOf("const regenerate = useCallback("),
      ACTIONS_CODE.indexOf("const onMenuRow"),
    );
    expect(regen).toContain("truncateAndResend(");
    expect(regen).not.toContain("edited: true");
  });

  it("the badge crosses the mapper onto a USER bubble only, and the band draws the shipped word", () => {
    expect(MAPPER_CODE).toContain("mapped.edited = true");
    // …and only on the else-arm of the assistant branch, so an answer can
    // never draw it.
    expect(MAPPER_CODE).toContain("} else if (message.edited === true)");
    expect(TURNS_CODE).toContain("transcript.edited.");
    expect(TURNS_CODE).toContain('t("chat.edit")');
    // The field already round-trips through the history path — no new field.
    expect(read("historyMessages.ts")).toContain("record.edited === true");
  });

  it("every user-visible string exists in BOTH catalogues", () => {
    for (const key of ["chat.edit", "chat.editEmpty", "common.save", "common.cancel"]) {
      expect(typeof EN[key]).toBe("string");
      expect(typeof IT[key]).toBe("string");
    }
  });
});
