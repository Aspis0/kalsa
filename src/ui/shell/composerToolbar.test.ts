/** Source proof for the v2 single-capsule composer and its sheet actions. */
import { readFileSync } from "fs";
import { join } from "path";

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");
const SHELL = read("Shell.tsx");
const FIELD = read("ShellComposer.tsx");
const STYLES = read("shellStyles.ts");
const SHEET = readFileSync(join(__dirname, "AttachSheet.tsx"), "utf8");
const HOST_SHEET = readFileSync(join(__dirname, "..", "..", "host", "HostAttachSheet.tsx"), "utf8");

describe("the mounted composer is one capsule", () => {
  it("has one 56 dp field with the v2 line, pill radius and floating elevation", () => {
    expect(FIELD).toContain('testID="shell.composer"');
    expect(STYLES).toContain("height: COMPOSER_FIELD_HEIGHT");
    expect(STYLES).toContain("borderColor: colors.line");
    expect(STYLES).toContain("borderRadius: radius.pill");
    expect(STYLES).toContain("...e2");
  });

  it("uses nude attach and mic controls around a 40 dp filled send circle", () => {
    expect(FIELD).toContain('<Plus size={20}');
    expect(FIELD).toContain('<Mic size={20}');
    expect(STYLES).toContain("height: 40");
    expect(STYLES).toContain("width: 40");
    expect(STYLES).toContain("borderRadius: 20");
    expect(SHELL).not.toMatch(/ComposerToolbar|COMPOSER_TOOLBAR_HEIGHT/);
  });

  it("keeps templates, research and notes inside the attachment sheet", () => {
    for (const id of ["shell.attach.templates", "shell.attach.research", "shell.attach.notes"]) {
      expect(HOST_SHEET).toContain(id);
    }
    expect(HOST_SHEET).toContain('role: "switch"');
    expect(SHEET).toContain('accessibilityRole={row.role ?? "button"}');
    expect(SHEET).toContain("checked: row.selected");
  });
});
