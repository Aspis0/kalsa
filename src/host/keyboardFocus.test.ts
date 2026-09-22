/**
 * The keyboard/focus remainder (PARITY-STATUS gap 9 / rows 45-46): the
 * persona row drops the keyboard like the controller, and the controller's
 * two focus paths exist here — tap-the-field, template-chosen. Everything is
 * a source pin: this stack cannot render, so the wiring IS the artifact.
 */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const DRAWER = read("HostDrawer.tsx");
const SURFACE = read("HostChatSurface.tsx");
const SHELL = read("../ui/shell/Shell.tsx");
const COMPOSER = read("../ui/shell/ShellComposer.tsx");
const APP = readFileSync(join(__dirname, "..", "app", "AppShell.tsx"), "utf8");
const CHAT = read("../screens/AiChatPage.tsx");

/** Comments removed, so a comment mentioning a call cannot satisfy a check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the persona row: the controller's one dismiss line (App:7104)", () => {
  const code = stripComments(DRAWER);
  const start = code.indexOf("onPersonaPress={");
  const persona = start >= 0 ? code.slice(start, code.indexOf("/>", start)) : "";

  it("the row exists and dismisses the keyboard BEFORE the drawer closes", () => {
    expect(persona.length).toBeGreaterThan(0);
    const dismiss = persona.indexOf("Keyboard.dismiss()");
    const close = persona.indexOf("setOpen(false)");
    expect(dismiss).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(dismiss);
  });

  it("the controller does the same, in the same order", () => {
    const startApp = APP.indexOf("onPersonaPress={() => {");
    expect(startApp).toBeGreaterThan(0);
    const block = APP.slice(startApp, startApp + 240);
    const dismiss = block.indexOf("Keyboard.dismiss();");
    expect(dismiss).toBeGreaterThanOrEqual(0);
    expect(dismiss).toBeLessThan(block.indexOf("setDrawerOpen(false);"));
  });
});

describe("the controller's two focus paths — and no phantom third", () => {
  it("template chosen → the draft fills, then the field focuses (Chat:3636-3637)", () => {
    const code = stripComments(SURFACE);
    const start = code.indexOf("onChooseTemplate={(template)");
    expect(start).toBeGreaterThan(0);
    const block = code.slice(start, code.indexOf("/>", start));
    const fill = block.indexOf("onDraftChange(t(template.promptKey))");
    const focus = block.indexOf("fieldRef.current?.focus()");
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(focus).toBeGreaterThan(fill);
  });

  it("the focus handle reaches the field through the shell, node and all", () => {
    expect(stripComments(SURFACE)).toContain("fieldRef={fieldRef}");
    expect(stripComments(SHELL)).toContain("fieldRef={fieldRef}");
    const composer = stripComments(COMPOSER);
    expect(composer).toContain("onPress={() => inputRef.current?.focus()}");
    expect(composer).toContain("fieldRef.current = node");
  });

  it("the wrapped field keeps its testID and accessible name; no hitSlop", () => {
    expect(COMPOSER).toContain('testID="shell.composer.field"');
    expect(COMPOSER).toContain('testID="shell.composer.fieldArea"');
    // The file's own header names hitSlop to forbid it — comments stripped,
    // so the prose cannot satisfy (or fail) the check.
    expect(stripComments(COMPOSER)).not.toContain("hitSlop");
  });

  it("the controller has exactly these two focus sites — this build's scope", () => {
    const sites = CHAT.match(/inputRef\.current\?\.focus\(\)/g) ?? [];
    expect(sites).toHaveLength(2);
  });
});
