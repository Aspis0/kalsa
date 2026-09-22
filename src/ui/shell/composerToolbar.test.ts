/**
 * The composer toolbar (D1 rows 13/14) as source plus its one geometry number,
 * because this stack cannot render it (DESIGN.md, "proof regime"). What a
 * screenshot cannot see and a regression would break silently: every finger
 * target is the real 48 dp row (never `hitSlop`), every node carries a testID
 * and an accessible name, the chips follow the controller's role split
 * (switch + checked for the toggles, button + selected for the document), and
 * the document chip is the §2.7 stub — it reports the hold rather than arming
 * nothing.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { COMPOSER_TOOLBAR_HEIGHT, MIN_TOUCH_TARGET } from "./shellGeometry";

const SOURCE = readFileSync(join(__dirname, "ComposerToolbar.tsx"), "utf8");
const SURFACE = readFileSync(
  join(__dirname, "..", "..", "host", "HostChatSurface.tsx"),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);
const SURFACE_CODE = stripComments(SURFACE);

describe("the row is a real box, not a slop (project rule)", () => {
  it("is exactly the 48 dp the geometry declares, on the row and on every chip", () => {
    expect(COMPOSER_TOOLBAR_HEIGHT).toBe(MIN_TOUCH_TARGET);
    expect(COMPOSER_TOOLBAR_HEIGHT).toBeGreaterThanOrEqual(48);
    // Both boxes in the file — the ✦ target and the chip's wrapper — take
    // their size from the constant, so the floor is one number, not two.
    expect(CODE.match(/COMPOSER_TOOLBAR_HEIGHT/g)!.length).toBeGreaterThanOrEqual(3);
    expect(CODE).not.toContain("hitSlop");
  });

  it("paints the pill small inside the box (the source-chip split), not a 48 dp blob", () => {
    // The inner View carries the paint (padding + border); the Pressable
    // carries the height. A 28-ish paint in a 48 box is the doctrine.
    expect(CODE).toMatch(/paddingVertical: 5/);
    expect(CODE).toMatch(/height: COMPOSER_TOOLBAR_HEIGHT,\s*justifyContent: "center"/);
  });
});

describe("every interactive node: testID + accessible name", () => {
  it("four controls, four testIDs", () => {
    for (const id of [
      "shell.composer.templates",
      "shell.composer.research",
      "shell.composer.document",
      "shell.composer.notes",
    ]) {
      expect(CODE).toContain(`testID="${id}"`);
    }
  });

  it("every Pressable declaration binds an accessibilityLabel", () => {
    const pressables = CODE.match(/<Pressable/g)?.length ?? 0;
    const labels = CODE.match(/accessibilityLabel=/g)?.length ?? 0;
    // The Chip component supplies its label from a prop; the ✦ binds inline.
    expect(pressables).toBeGreaterThan(0);
    expect(labels).toBeGreaterThanOrEqual(pressables);
    expect(CODE).toContain("accessibilityLabel={a11yLabel}");
  });

  it("keeps the controller's role split: toggles are switches with checked state", () => {
    expect(CODE).toContain('accessibilityRole={toggle ? "switch" : "button"}');
    expect(CODE).toMatch(/checked: active, disabled/);
    expect(CODE).toMatch(/selected: active, disabled/);
    // Research carries the active-specific name the controller used (Chat:4200).
    expect(CODE).toContain('t("chat.deepResearchActive")');
  });
});

describe("the labels are the controller's catalogue keys, in both locales", () => {
  it("uses the shipped keys — no new string was invented for this row", () => {
    for (const key of [
      't("chat.a11yTemplates")',
      't("chat.deepResearch")',
      't("chat.deepResearchActive")',
      't("chat.libraryDocument")',
      't("notes.title")',
    ]) {
      expect(CODE).toContain(key);
    }
  });
});

describe("the machine gates the chips, and the document chip says why (§2.7)", () => {
  it("disabled rides into every chip, decided by the host's face", () => {
    expect(CODE).toMatch(/disabled=\{disabled\}/);
    expect(SURFACE_CODE).toMatch(/disabled: view\.composer\.face !== "send"/);
  });

  it("the document chip presses into a notice, never into an arm", () => {
    expect(CODE).toMatch(/onPress=\{props\.onDocumentPress\}/);
    // The host maps it to the attach stub's own reason — a chip that does
    // something the build can honour: telling the user why it cannot arm.
    expect(SURFACE_CODE).toMatch(
      /onDocumentPress: \(\) => showNoticeKey\("shell\.notice\.attach"\)/,
    );
    // It is not a toggle pretending to hold state.
    expect(CODE).toMatch(/active=\{false\}\s*\n\s*disabled=\{disabled\}\s*\n\s*toggle=\{false\}/);
  });
});

describe("the samples: these patterns are not vacuous", () => {
  it("each guard fails on a sample that lacks the shape", () => {
    expect("hitSlop".match(/hitSlop/)).not.toBeNull();
    expect('<Pressable testID="x">'.match(/accessibilityLabel=/g)).toBeNull();
    expect(stripComments("// disabled: view.composer.face")).not.toContain("disabled:");
  });
});
