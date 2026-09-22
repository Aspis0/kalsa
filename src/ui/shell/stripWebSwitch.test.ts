/**
 * The strip's Web permission switch (D1 row 5 / §2.9), as source: the strip's
 * JSX cannot be rendered here (DESIGN.md, "proof regime"), and the three facts
 * a diff would hide are all textual — the control is a real 48 dp box (the old
 * one was 36×22 on `hitSlop`, `AppShell:6926-6959`, which this project forbids),
 * it carries the controller's own switch role, name and both hints from the
 * shipped catalogue, and the geometry beside it budgets THREE icon buttons.
 *
 * BEFORE the export row left for the drawer this read FOUR buttons and pinned
 * `… - 4*full - 4*STRIP_GAP`, because the switch had joined the strip and
 * squeezed the pill to 97 dp (a 14 dp text column — no legible model name, the
 * dots a vision pass saw were both lines' ellipses). The strip contract changed
 * by decision, not by drift: export moved to the drawer (`HostDrawer.tsx`),
 * three buttons give the pill 154 dp (`shellGeometry.ts`, pinned on its side by
 * `shellGeometry.test.ts`). Everything else in this file is unchanged: the
 * switch itself, its 48 dp box, its hints, both catalogues.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { en } from "../../i18n/en";
import { it as italian } from "../../i18n/it";

const SHELL_SOURCE = readFileSync(join(__dirname, "Shell.tsx"), "utf8");
const GEOMETRY_SOURCE = readFileSync(join(__dirname, "shellGeometry.ts"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CODE = stripComments(SHELL_SOURCE);

describe("the switch itself", () => {
  it("is a switch node with the checked state and the controller's name", () => {
    expect(CODE).toContain('testID="shell.strip.web"');
    expect(CODE).toContain('accessibilityRole="switch"');
    expect(CODE).toContain("accessibilityState={{ checked: webEnabled }}");
    expect(CODE).toContain('accessibilityLabel={t("common.web")}');
  });

  it("carries BOTH hints the controller shipped (AppShell:6935-6940)", () => {
    expect(CODE).toContain('t("common.webOnHint")');
    expect(CODE).toContain('t("common.webOffHint")');
    expect(CODE).toMatch(/accessibilityHint=\{webEnabled \? t\("common\.webOnHint"\) : t\("common\.webOffHint"\)\}/);
  });

  it("is a real 48 dp box — the styles.iconButton the geometry floors at 48", () => {
    expect(CODE).toMatch(/style=\{\[\s*styles\.iconButton,/);
    // No forbidden escape hatch anywhere in the shell's strip.
    expect(CODE).not.toContain("hitSlop");
  });

  it("shows its state while off with the controller's own line-through (AppShell:6952)", () => {
    expect(CODE).toMatch(/textDecorationLine: webEnabled \? "none" : "line-through"/);
  });

  it("is drawn in BOTH catalogues: common.web and the two hints exist, non-empty", () => {
    for (const [name, catalog] of [
      ["en", en],
      ["it", italian],
    ] as const) {
      const strings = [catalog.common.web, catalog.common.webOnHint, catalog.common.webOffHint];
      for (const value of strings) {
        expect([name, typeof value === "string" && value.length > 0]).toEqual([name, true]);
      }
    }
    // The hints really are two different sentences, so the off-state hint is
    // not the on-state hint wearing the same words.
    expect(en.common.webOnHint).not.toBe(en.common.webOffHint);
    expect(italian.common.webOnHint).not.toBe(italian.common.webOffHint);
  });
});

describe("the geometry beside it: three icon buttons, one pill", () => {
  it("budgets the strip with THREE 48 dp controls and three gaps (was four)", () => {
    // BEFORE (Web switch on the strip, export in the strip):
    //   `width - 2 * STRIP_SIDE_PADDING - 4 * full - 4 * STRIP_GAP` = 97 dp pill.
    // AFTER export moved to the drawer the strip holds menu, Web, new chat:
    expect(GEOMETRY_SOURCE).toMatch(/width - 2 \* STRIP_SIDE_PADDING - 3 \* full - 3 \* STRIP_GAP/);
    // The sentence IS the comment documenting the contract change; it must
    // name all three controls and the reason export is not one of them.
    expect(GEOMETRY_SOURCE).toContain("THREE icon buttons (menu, Web,");
    expect(GEOMETRY_SOURCE).toContain("Export moved to the");
    // The old four-button formula must be gone, or both budgets exist at once.
    expect(GEOMETRY_SOURCE).not.toMatch(/4 \* full - 4 \* STRIP_GAP/);
  });

  it("the shell hands the switch the host's persisted flag, not a local copy", () => {
    const surface = stripComments(
      readFileSync(join(__dirname, "..", "..", "host", "HostChatSurface.tsx"), "utf8"),
    );
    expect(surface).toContain("webEnabled={flags.webToolsEnabled}");
    expect(surface).toContain("onWebPress={flags.toggleWebTools}");
  });
});

describe("the samples: the guards can fail", () => {
  it("a stripped comment does not carry a match", () => {
    expect(stripComments("// accessibilityRole=\"switch\"")).not.toContain("accessibilityRole");
    // …but the same text in code does.
    expect(CODE).toContain('accessibilityRole="switch"');
  });
});
