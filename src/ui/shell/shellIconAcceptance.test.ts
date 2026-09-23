/** Source acceptance for nude glyphs and their real touch targets. */
import { readFileSync } from "fs";
import { join } from "path";

const readShell = (name: string) => readFileSync(join(__dirname, name), "utf8");
const STRIP = readShell("ShellStrip.tsx");
const COMPOSER = readShell("ShellComposer.tsx");
const STYLES = readShell("shellStyles.ts");
const ATTACH = readShell("AttachSheet.tsx");
const MESSAGE_MENU = readShell("MessageMenu.tsx");
const TRANSCRIPT_CHIPS = readShell("TranscriptChips.tsx");
const TRANSCRIPT_PARTS = readShell("TranscriptParts.tsx");
const MINIAPP = readShell("MiniappCard.tsx");
const DRAWER = readFileSync(join(__dirname, "..", "..", "theme", "components", "DrawerContent.tsx"), "utf8");

describe("shell glyph paint and touch targets", () => {
  it("keeps the strip menu glyph nude in a 48 dp target", () => {
    expect(STRIP).toContain('<Menu size={20}');
    expect(STRIP).toMatch(/width: 48,[\s\S]*?height: 48,[\s\S]*?justifyContent: "center"/);
    expect(STRIP).not.toMatch(/backgroundColor: colors\.surface[^}]*Menu/);
  });

  it("gives attach and mic their full boxes while leaving the glyphs unpainted", () => {
    expect(STYLES).toMatch(/fieldIcon: \{[\s\S]*?height: MIN_TOUCH_TARGET[\s\S]*?width: MIN_TOUCH_TARGET/);
    expect(COMPOSER).toContain('<Plus size={20}');
    expect(COMPOSER).toContain('<Mic size={20}');
    expect(COMPOSER).not.toMatch(/fieldIcon:[\s\S]*?backgroundColor:/);
  });

  it("reserves the filled 40 dp circle for the send action", () => {
    expect(STYLES).toMatch(/sendCircle: \{[\s\S]*?height: 40[\s\S]*?width: 40/);
    expect(COMPOSER).toContain('<View style={[styles.sendCircle, { backgroundColor:');
    expect(COMPOSER).toContain('<ArrowUp size={18}');
  });

  it("uses bare 20 dp glyphs in 48 dp attachment rows", () => {
    expect(ATTACH).toContain('minHeight: 48');
    expect(ATTACH).toContain('<Camera size={20}');
    expect(ATTACH).toContain('<BookOpen size={20}');
    expect(ATTACH).not.toMatch(/borderRadius:[\s\S]{0,80}backgroundColor:[\s\S]{0,80}ICONS/);
  });

  it("uses the same bare glyph size inside full-height message rows", () => {
    expect(MESSAGE_MENU).toContain('minHeight: MIN_TOUCH_TARGET');
    expect(MESSAGE_MENU.match(/size=\{20\}/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps transcript actions as text and glyphs inside real boxes", () => {
    expect(TRANSCRIPT_PARTS).toMatch(/actionChipBox: \{[\s\S]*?minHeight: MIN_TOUCH_TARGET[\s\S]*?minWidth: MIN_TOUCH_TARGET/);
    expect(TRANSCRIPT_PARTS).toMatch(/actionChip: \{[\s\S]*?flexDirection: "row"[\s\S]*?gap: spacing\.xxs[\s\S]*?justifyContent: "center"[\s\S]*?\n      \}/);
    expect(TRANSCRIPT_CHIPS).toContain('<Copy size={18}');
    expect(TRANSCRIPT_CHIPS).toContain('<Volume2 size={18}');
  });

  it("keeps the menu search clear glyph nude in a 48 dp box", () => {
    expect(DRAWER).toContain('style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}');
    expect(DRAWER).toContain('<X size={18} color={colors.ink3} />');
  });

  it("keeps drawer back inside its 48 dp target", () => {
    expect(DRAWER).toContain('width: 48,');
    expect(DRAWER).toContain('height: 48,');
    expect(DRAWER).toContain('<ChevronLeft size={20}');
  });

  it("keeps mini-app open as a 48 dp action with a nude chevron", () => {
    expect(MINIAPP).toContain('minHeight: MIN_TOUCH_TARGET');
    expect(MINIAPP).toContain('minWidth: MIN_TOUCH_TARGET');
    expect(MINIAPP).toContain('<ChevronRight size={16}');
    expect(MINIAPP).not.toMatch(/openBox:[\s\S]*?backgroundColor:/);
  });

  it("keeps menu destination glyphs unboxed in their full-width rows", () => {
    expect(DRAWER).toContain('minHeight: 56');
    expect(DRAWER).toContain('<Icon color={colors.accent} size={20} strokeWidth={1.75} />');
    const rowStart = DRAWER.indexOf('testID={`drawer.item.${id}`}');
    const rowEnd = DRAWER.indexOf('</Pressable>', rowStart);
    expect(rowStart).toBeGreaterThanOrEqual(0);
    expect(DRAWER.slice(rowStart, rowEnd)).not.toContain('<View');
  });
});
