/**
 * The menu's pure halves, checked where they live: which rows a message gets
 * (`messageMenuRows`) and what a regenerate drops (`planRegenerate`).
 *
 * The two proofs here are the ones a rendered tree could not give:
 *
 * 1. **Honest rows**: an action that cannot run is ABSENT. Translate and edit
 *    do not appear at all (deferred with their systems), read-aloud never had
 *    a sheet row, regenerate only appears where the controller's own
 *    `canRegen` allows it, Copy only where `sheetCopyVisible` does — and every
 *    label key resolves in BOTH catalogues, so a row cannot ship with an
 *    English-only word.
 * 2. **The truncate**: regenerate keeps everything BEFORE the target user
 *    turn and drops that turn, the answer being replaced, and everything after
 *    it — the controller's `Chat:3411-3421`, pinned so a future "helpful"
 *    change (keeping later turns, keeping the old answer) fails here.
 */
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import type { Message } from "./hostMessage";
import { messageMenuCaption, messageMenuRows } from "./messageMenuRows";
import { planRegenerate } from "./regenPlan";

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

const ids = (rows: ReturnType<typeof messageMenuRows>) => rows.map((row) => row.id);

describe("which rows a message gets — present only if it can run", () => {
  it("a user bubble idle: copy, notes, cancel — and NO regenerate (canRegen says assistant only)", () => {
    expect(ids(messageMenuRows("user", "hello", false))).toEqual(["copy", "notes", "cancel"]);
  });

  it("an answer idle: copy, notes, regenerate, cancel — the controller's order", () => {
    expect(ids(messageMenuRows("assistant", "hi", false))).toEqual([
      "copy",
      "notes",
      "regenerate",
      "cancel",
    ]);
  });

  it("regenerate is absent mid-turn, not present and inert", () => {
    expect(ids(messageMenuRows("assistant", "hi", true))).toEqual(["copy", "notes", "cancel"]);
    expect(ids(messageMenuRows("user", "hi", true))).toEqual(["copy", "notes", "cancel"]);
  });

  it("copy is absent without copyable text — the controller's sheetCopyVisible gate", () => {
    expect(ids(messageMenuRows("assistant", "", false))).toEqual([
      "notes",
      "regenerate",
      "cancel",
    ]);
    expect(ids(messageMenuRows("user", "   \n ", false))).toEqual(["notes", "cancel"]);
  });

  it("translate and edit never appear in any state — deferred, not inert", () => {
    for (const role of ["user", "assistant"] as const) {
      for (const sending of [false, true]) {
        expect(ids(messageMenuRows(role, "text", sending))).not.toContain("translate");
        expect(ids(messageMenuRows(role, "text", sending))).not.toContain("edit");
      }
    }
  });

  it("testIDs: the controller's two names kept, the two he never gave a name given one, all unique", () => {
    const rows = messageMenuRows("assistant", "text", false);
    expect(rows.find((row) => row.id === "copy")!.testID).toBe("message-action-copy");
    expect(rows.find((row) => row.id === "regenerate")!.testID).toBe("message-action-regen");
    const testIDs = rows.map((row) => row.testID);
    expect(new Set(testIDs).size).toBe(testIDs.length);
    for (const row of rows) expect(row.testID).toMatch(/^message-action-/);
  });
});

describe("every string the menu shows exists in BOTH catalogues", () => {
  it("all row label keys resolve, en and it", () => {
    const keys = new Set<string>();
    for (const role of ["user", "assistant"] as const) {
      for (const row of messageMenuRows(role, "text", false)) keys.add(row.labelKey);
    }
    expect(keys.size).toBeGreaterThanOrEqual(4);
    for (const key of keys) {
      expect([key, EN[key]]).toEqual([key, expect.any(String)]);
      expect([key, IT[key]]).toEqual([key, expect.any(String)]);
    }
  });

  it("the caption's two lines resolve in both — and the idle one is the honest hint, not the controller's translate-promising one", () => {
    expect(messageMenuCaption(false)).toBe("chat.a11yMessageActions");
    expect(messageMenuCaption(true)).toBe("common.copied");
    for (const key of [messageMenuCaption(false), messageMenuCaption(true)]) {
      expect(typeof EN[key]).toBe("string");
      expect(typeof IT[key]).toBe("string");
    }
    // The hint this build ships names only actions that exist:
    expect(EN["chat.a11yMessageActions"]).not.toMatch(/translate/i);
    expect(EN["chat.a11yLongPress"]).toMatch(/translate/i); // the old one did
  });
});

describe("planRegenerate: what a regenerate replaces", () => {
  const thread = [
    user("u1", "first question"),
    assistant("a1", "first answer"),
    user("u2", "second question"),
    assistant("a2", "second answer"),
  ];

  it("regenerating the LAST answer keeps everything before its user turn and drops both of them", () => {
    const plan = planRegenerate(thread, "a2");
    expect(plan).not.toBeNull();
    expect(plan!.assistantId).toBe("a2");
    expect(plan!.userId).toBe("u2");
    expect(plan!.text).toBe("second question");
    // The drop: the target user turn AND the answer being replaced AND
    // anything after — the controller's `slice(0, idx)`, pinned.
    expect(plan!.base.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("regenerating an EARLIER answer truncates everything after it — the same rule, the harder case", () => {
    const plan = planRegenerate(thread, "a1");
    expect(plan).not.toBeNull();
    expect(plan!.userId).toBe("u1");
    expect(plan!.base).toEqual([]);
  });

  it("kept messages keep their identity (the write guard's id set depends on it)", () => {
    const plan = planRegenerate(thread, "a2")!;
    expect(plan.base[0]).toBe(thread[0]);
    expect(plan.base[1]).toBe(thread[1]);
  });

  it("refuses honestly, before any truncate: unknown id, no anchor, no user turn, empty text", () => {
    expect(planRegenerate(thread, "nope")).toBeNull();
    // A user id as the anchor: the controller's canRegen gate keeps this
    // unreachable, and the plan refuses anyway rather than truncating from
    // the wrong side.
    expect(planRegenerate(thread, "u2")).toBeNull();
    expect(planRegenerate([assistant("a1", "orphan")], "a1")).toBeNull();
    // No user turn BEFORE the anchor (the anchor is first).
    expect(planRegenerate([assistant("a1", "x"), user("u1", "y")], "a1")).toBeNull();
    // Text `send()` would refuse — decided before the truncate, not after.
    expect(
      planRegenerate([user("u1", "   "), assistant("a1", "answer")], "a1"),
    ).toBeNull();
  });
});
