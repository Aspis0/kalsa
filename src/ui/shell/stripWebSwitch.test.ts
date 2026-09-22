/**
 * The strip's Web permission switch (D1 row 5 / §2.9), as source: the strip's
 * JSX cannot be rendered here (DESIGN.md, "proof regime"), and the three facts
 * a diff would hide are all textual — the control is a real 48 dp box (the old
 * one was 36×22 on `hitSlop`, `AppShell:6926-6959`, which this project forbids),
 * it carries the controller's own switch role, name and both hints from the
 * shipped catalogue, and the geometry beside it now budgets FOUR icon buttons
 * (the pill's 154 dp became 97 dp when the switch joined — the contract change
 * `shellGeometry.test.ts` pins on its side).
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

describe("the geometry beside it: four icon buttons, one pill", () => {
  it("budgets the strip with FOUR 48 dp controls and four gaps (was three)", () => {
    expect(GEOMETRY_SOURCE).toMatch(/width - 2 \* STRIP_SIDE_PADDING - 4 \* full - 4 \* STRIP_GAP/);
    // The four the formula counts: menu, Web, export, new chat — asserted on
    // the raw source because the sentence IS the comment documenting the
    // contract change (three buttons / 154 dp was the old one).
    expect(GEOMETRY_SOURCE).toContain("FOUR icon buttons (menu, Web,");
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
