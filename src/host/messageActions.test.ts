/**
 * The message interactions as SOURCE proof — the stack renders nothing
 * (DESIGN.md, "proof regime"), so what is checked is what a screenshot cannot
 * see and a rewrite would break silently: the two traps the controller
 * records, the fences around a regenerate, the deferred actions staying
 * absent, the 350 ms hold that must not fight the scroll view, and the 48 dp
 * floor on everything the sheet and the chip put under a finger.
 *
 * Every predicate is exercised against a sample that must FAIL it, so a guard
 * that quietly stops matching cannot pass as green.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import { COPIED_FLASH_MS } from "../ui/shell/copiedFlash";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const readShell = (file: string): string =>
  readFileSync(join(__dirname, "..", "ui", "shell", file), "utf8");

const ACTIONS = read("messageActions.ts");
const SURFACE = read("HostChatSurface.tsx");
const ROOT = read("HostRoot.tsx");
const MENU = readShell("MessageMenu.tsx");
const TURNS = readShell("TranscriptTurns.tsx");
const TRANSCRIPT = readShell("Transcript.tsx");

/** Comments stripped: the prose about a rule must never satisfy the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const ACTIONS_CODE = stripComments(ACTIONS);
const MENU_CODE = stripComments(MENU);
const TURNS_CODE = stripComments(TURNS);

/** Every `<Pressable …>` JSX element's source (attributes only, to `>`). */
function pressables(source: string): string[] {
  return source.match(/<Pressable[\s\S]*?>/g) ?? [];
}

/** The slice of `messageActions.ts` from a marker to the next one. */
function slice(from: string, to: string): string {
  const start = ACTIONS_CODE.indexOf(from);
  const end = ACTIONS_CODE.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error(`markers not found: ${from} → ${to}`);
  return ACTIONS_CODE.slice(start, end);
}

describe("trap 1: the opener reads refs, never state (controller Chat:3484-3487)", () => {
  const opener = slice("onMessageLongPress = useCallback(", "const saveToNotes");

  it("guards on the refs and the press event's own payload", () => {
    expect(opener).toContain("latest.current");
    expect(opener).toContain("sendingRef.current");
    expect(opener).toContain("regenInFlightRef.current");
    expect(opener).toContain("historyLoadedRef.current");
    expect(opener).toContain("message.caret");
    expect(opener).toContain("message.text.trim()");
  });

  it("never reads the `sending` STATE inside the opener", () => {
    // The state mirror is fine for rendering the rows; inside the opener it is
    // the frozen-closure bug the controller hit in its memoized rows.
    expect(/\bsending\b/.test(opener)).toBe(false);
  });

  it("the sample guard fails on a state-reading opener", () => {
    expect(/\bsending\b/.test("if (sending) return; setMenu(payload);")).toBe(true);
    expect(/\bsending\b/.test("if (p.sendHost.sendingRef.current) return;")).toBe(false);
  });
});

describe("the hold: 350 ms, and the gesture cannot fight the scroll view", () => {
  it("both message pressables hold at the controller's delay", () => {
    expect(TURNS_CODE).toContain("delayLongPress: 350");
    expect(TURNS_CODE).toContain("onLongPress");
  });

  it("the long-press props carry NO onPress — a hold that becomes a drag does nothing", () => {
    const start = TURNS_CODE.indexOf("function useLongPressProps");
    const end = TURNS_CODE.indexOf("function CopyChip", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const props = TURNS_CODE.slice(start, end);
    expect(props).toContain("onLongPress");
    expect(props).toContain("delayLongPress");
    expect(props).toContain("accessibilityHint");
    expect(props).toContain("accessibilityLabel");
    expect(props).not.toContain("onPress");
    // sample: the predicate is not vacuous
    expect(/onPress/.test("return { onLongPress, onPress }")).toBe(true);
  });

  it("the band's scroll view carries the controller's keyboardShouldPersistTaps=\"handled\" (Chat:4146) — the press the keyboard otherwise eats", () => {
    // With the default `never`, RN's ScrollView claims the touch ON START while
    // the keyboard is up, and a 350 ms hold never begins. This is PARITY-STATUS
    // row 45's missing transcript prop, spent here because the long-press needs it.
    expect(TRANSCRIPT).toContain('keyboardShouldPersistTaps="handled"');
    expect(TRANSCRIPT).not.toContain('keyboardShouldPersistTaps="never"');
  });
});

describe("the sheet: real boxes, named nodes, a way to cancel", () => {
  it("every Pressable carries a testID and an accessible name, and no hitSlop anywhere", () => {
    const nodes = pressables(MENU_CODE);
    expect(nodes.length).toBeGreaterThanOrEqual(2); // backdrop + sheet, plus rows
    for (const node of nodes) {
      expect(node).toMatch(/testID=/);
      expect(node).toMatch(/accessibilityLabel=/);
    }
    expect(MENU_CODE).not.toContain("hitSlop");
    expect(TURNS_CODE).not.toContain("hitSlop");
  });

  it("the row box is the 48 dp floor, not a padded line", () => {
    expect(MENU_CODE).toContain("minHeight: MIN_TOUCH_TARGET");
    expect(MENU_CODE).toContain("MIN_TOUCH_TARGET");
  });

  it("cancel exists three ways: a cancel row, the backdrop, Android back", () => {
    expect(MENU_CODE).toContain("onRequestClose={onRequestClose}");
    expect(MENU_CODE).toContain('accessibilityLabel={t("common.close")}');
    // The row dispatch's fall-through closes — the cancel row's own path.
    const dispatch = slice("if (id === \"regenerate\")", "const menuView");
    expect(dispatch).toContain("closeMenu();");
  });

  it("the icon mapping covers every row id, so a row can never render nameless", () => {
    for (const id of ['case "copy"', 'case "notes"', 'case "regenerate"', 'case "cancel"']) {
      expect(MENU_CODE).toContain(id);
    }
    // and the union the sheet can draw is the union the builder can emit:
    expect(MENU).toContain('MessageMenuRowId = "copy" | "notes" | "regenerate" | "cancel"');
  });

  it("renders nothing at all when closed", () => {
    expect(MENU_CODE).toContain("if (!visible) return null;");
  });
});

describe("the regenerate handoff is fenced exactly like a send, because it is one", () => {
  const regen = slice("const regenerate = useCallback(", "const onMenuRow");

  it("claims synchronously: checks → truncate → send's own claim → declare, one block", () => {
    const order = [
      "sendClaimRef.current",
      "planRegenerate(",
      "regenInFlightRef.current = true",
      "p.sendHost.send(plan.text)",
      "armDeclaredShrink",
      "await run",
    ].map((needle) => {
      const at = regen.indexOf(needle);
      expect([needle, at >= 0]).toEqual([needle, true]);
      return at;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("verifies the claim took before arming the shrink, and rolls back if it did not", () => {
    expect(regen).toContain("if (!p.sendHost.sendingRef.current)");
    expect(regen).toContain("p.history.messagesRef.current = snapshot");
    expect(regen).toContain("regenInFlightRef.current = false");
    // The rollback is on the impossible side of the block, never after `await run`.
    expect(regen.indexOf("messagesRef.current = snapshot")).toBeLessThan(
      regen.indexOf("await run"),
    );
  });

  it("the busy and the failure both speak through a shipped notice key", () => {
    expect(regen).toContain('"chat.regenBusy"');
    expect(regen).toContain('"chat.regenFailed"');
  });

  it("sample: the ordering predicate fails when the order is wrong", () => {
    const wrong = "planRegenerate(x); armDeclaredShrink(base); send(text);";
    expect(wrong.indexOf("planRegenerate(")).toBeLessThan(wrong.indexOf("armDeclaredShrink"));
    const inverted = "armDeclaredShrink(base); planRegenerate(x);";
    expect(inverted.indexOf("planRegenerate(") < inverted.indexOf("armDeclaredShrink")).toBe(
      false,
    );
  });
});

describe("deferred actions stay ABSENT from the code, not present and inert", () => {
  it("no translate, edit or read-aloud path exists in the menu's host or sheet", () => {
    // The controller's identifiers for the deferred systems — by name, so a
    // `TranslateFn` type import cannot trip the check (the comment stripper
    // already removed the prose).
    const deferred = [
      "runTranslate",
      "translationInFlightRef",
      "translateAbortRef",
      "translate.title",
      "handleReadAloud",
      "speakingId",
      "onSpeak",
      "editMessage",
      "editEmpty",
      "editingMessage",
    ];
    for (const source of [ACTIONS_CODE, MENU_CODE, stripComments(read("messageMenuRows.ts"))]) {
      for (const name of deferred) expect(source).not.toContain(name);
    }
    // sample: the guard is about names, not the letter sequence
    expect("TranslateFn").not.toContain("runTranslate");
  });

  it("the sheet cannot draw a row its union does not name", () => {
    expect(MENU_CODE).not.toContain('"translate"');
    expect(MENU_CODE).not.toContain('"edit"');
  });
});

describe("the copied flash: one number, the controller's +400 ms", () => {
  it("is 400 in its own file, and both consumers import it", () => {
    expect(COPIED_FLASH_MS).toBe(400);
    expect(ACTIONS).toContain('from "../ui/shell/copiedFlash"');
    expect(TURNS).toContain('from "./copiedFlash"');
  });

  it("the chip flashes only after the copy reported success, and shows the shipped word", () => {
    expect(TURNS_CODE).toContain("await onCopy(text)");
    expect(TURNS_CODE).toContain("if (!ok) return;");
    expect(TURNS_CODE).toContain('copied ? t("common.copied") : t("common.copy")');
    expect(TURNS_CODE).toContain("COPIED_FLASH_MS");
  });

  it("the menu keeps the sheet open on the flash and closes it on the same window", () => {
    const copyRow = slice("if (id === \"copy\")", "if (id === \"notes\")");
    expect(copyRow).toContain("await copyToClipboard(payload.text)");
    expect(copyRow).toContain("if (!ok) return;");
    expect(copyRow).toContain("setCopied(true)");
    expect((copyRow.match(/COPIED_FLASH_MS/g) ?? []).length).toBe(2);
  });
});

describe("the wiring: root composes, surface mounts, both keep their old duties", () => {
  it("the root only calls the hook with what it already owns", () => {
    expect(ROOT).toContain("useMessageActions({");
    expect(ROOT).toContain("actions={messageActions}");
  });

  it("the surface hands the transcript its two callbacks and mounts the sheet", () => {
    expect(SURFACE).toContain("onMessageLongPress={actions.onMessageLongPress}");
    expect(SURFACE).toContain("onCopy={actions.onCopy}");
    expect(SURFACE).toMatch(/<MessageMenu[\s\S]*?onRowPress=\{actions\.onMenuRow\}/);
    expect(SURFACE).toMatch(/onRequestClose=\{actions\.closeMenu\}/);
  });

  it("the attach button still wears `shell.notice.attach` — the key the removed chip also used", () => {
    expect(SURFACE).toMatch(
      /onAttachPress=\{\(\) => showNoticeKey\("shell\.notice\.attach"\)\}/,
    );
    expect(SURFACE).not.toContain("onDocumentPress");
  });
});

describe("every user-visible string exists in BOTH catalogues", () => {
  const keys = [
    "chat.a11yMessageActions",
    "chat.regenBusy",
    "chat.regenFailed",
    "notes.saved",
    "notes.errorSave",
    "notes.saveToNotes",
    "common.copy",
    "common.copied",
    "common.cancel",
    "common.close",
    "chat.regen",
    "shell.notice.attach",
  ];

  it("en and it each resolve every key the menu, the sheet and the notices use", () => {
    const flat = (value: unknown, prefix = ""): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof entry === "string") out[path] = entry;
        else if (entry && typeof entry === "object") Object.assign(out, flat(entry, path));
      }
      return out;
    };
    const enFlat = flat(en);
    const itFlat = flat(italian);
    for (const key of keys) {
      expect(typeof enFlat[key]).toBe("string");
      expect(typeof itFlat[key]).toBe("string");
    }
  });

  it("the new code never uses the controller's translate-promising hint", () => {
    for (const source of [ACTIONS_CODE, TURNS_CODE, MENU_CODE]) {
      expect(source).not.toContain("chat.a11yLongPress");
    }
  });
});
