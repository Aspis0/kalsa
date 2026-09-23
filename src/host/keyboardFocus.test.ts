/** Keyboard dismissal and focus through the v2 menu and its composer actions. */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
const DRAWER = read("HostDrawer.tsx");
const DRAWER_CONTENT = read("../theme/components/DrawerContent.tsx");
const MENU = read("../theme/components/Drawer.tsx");
const SURFACE = read("HostChatSurface.tsx");
const SHELL = read("../ui/shell/Shell.tsx");
const COMPOSER = read("../ui/shell/ShellComposer.tsx");
const ATTACH_SHEET = read("HostAttachSheet.tsx");
const OVERLAYS = read("HostChatSurfaceOverlays.tsx");
const CHAT = read("../screens/AiChatPage.tsx");

/** Comments removed, so a comment mentioning a call cannot satisfy a check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the v2 menu dismiss path", () => {
  const code = stripComments(DRAWER);

  it("dismisses the keyboard before closing and clearing the search", () => {
    const dismiss = code.indexOf("Keyboard.dismiss()");
    const close = code.indexOf("setOpen(false)");
    const clear = code.indexOf("clearChatSearch()");
    expect(dismiss).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(dismiss);
    expect(clear).toBeGreaterThan(close);
  });

  it("has an announced header close action and a platform BACK route", () => {
    expect(DRAWER_CONTENT).toContain('testID="drawer.close"');
    expect(DRAWER_CONTENT).toContain('accessibilityLabel={t("common.close")}');
    expect(stripComments(MENU)).toContain("onRequestClose={onClose}");
    expect(stripComments(DRAWER_CONTENT)).not.toContain("onPersonaPress");
  });
});

describe("the controller's two focus paths — and no phantom third", () => {
  it("the attach sheet opens templates; choosing one fills the draft then focuses the field", () => {
    expect(ATTACH_SHEET).toContain('action: "templates"');
    expect(SURFACE).toContain('if (action === "templates")');
    expect(SURFACE).toContain("setQuickSheetVisible(true)");
    expect(OVERLAYS).toMatch(/<QuickActionSheet[\s\S]*?visible=\{props\.quickSheetVisible\}/);
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
