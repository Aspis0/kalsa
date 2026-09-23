/** Strip acceptance: one nude menu glyph and one model pill, without old rows. */
import { readFileSync } from "fs";
import { join } from "path";
import { STRIP_HEIGHT, STRIP_PILL_HEIGHT, MIN_TOUCH_TARGET } from "./shellGeometry";

const strip = readFileSync(join(__dirname, "ShellStrip.tsx"), "utf8");
const shell = readFileSync(join(__dirname, "Shell.tsx"), "utf8");
const sheet = readFileSync(join(__dirname, "ModelPillSheet.tsx"), "utf8");

describe("the strip's two controls", () => {
  it("exposes the menu and model pill as named 48 dp targets", () => {
    expect(strip).toContain('testID="shell.strip.menu"');
    expect(strip).toContain('testID="shell.strip.model"');
    expect(strip.match(/width: 48/g)?.length).toBeGreaterThan(0);
    expect(strip).toContain('accessibilityLabel={t("shell.a11y.menu")}');
    expect(strip).toContain('accessibilityRole="button"');
    expect(MIN_TOUCH_TARGET).toBe(48);
  });

  it("paints the model pill at 44 dp inside the 48 dp touch box", () => {
    expect(STRIP_PILL_HEIGHT).toBe(44);
    expect(strip).toContain("height: STRIP_PILL_HEIGHT");
    expect(strip).toMatch(/height: 48,[\s\S]*?flex: 1/);
  });

  it("stays 56 dp tall and uses a nude menu icon", () => {
    expect(STRIP_HEIGHT).toBe(56);
    expect(strip).toContain("height: STRIP_HEIGHT");
    expect(strip).toContain("<Menu size={20}");
    expect(strip).not.toMatch(/backgroundColor: colors\.surface[^}]*Menu/);
  });

  it("shows a device glyph and the short local or server label", () => {
    expect(strip).toContain("Smartphone");
    expect(strip).toContain("Monitor");
    expect(strip).toContain('"Locale"');
    expect(strip).toContain('"Kalsa Brain"');
  });

  it("does not draw a brand mark, new-chat action or web switch in the strip", () => {
    expect(strip).not.toContain("Plus");
    expect(strip).not.toContain("Globe");
    expect(strip).not.toContain("Brand");
    expect(strip).not.toContain("shell.strip.newChat");
    expect(strip).not.toContain("shell.strip.web");
  });

  it("puts readiness rows and battery guidance inside the pill's sheet", () => {
    expect(strip).toContain("<ModelPillSheet");
    expect(sheet).toContain("<ModelBar");
    expect(sheet).toContain('testID="shell.modelSheet"');
    expect(shell).not.toContain("<ModelBar");
    expect(shell).not.toContain("shell.notice");
  });

  it("opens the status sheet from the pill instead of starting a model action", () => {
    expect(strip).toMatch(/onPress=\{\(\) => setSheetVisible\(true\)\}/);
    expect(strip).toContain("onRetryPress={onModelAction}");
  });

  it("does not add a fourth strip band or overflow the three-band shell", () => {
    expect(shell).toContain("<ShellStrip");
    expect(shell).not.toContain("<ComposerToolbar");
    expect(shell).not.toContain("shell.strip.web");
  });
});

describe("test guard samples", () => {
  it("fails when an old switch or new-chat row returns", () => {
    expect('<Pressable testID="shell.strip.web">'.includes("shell.strip.web")).toBe(true);
    expect(strip).not.toContain("shell.strip.web");
    expect(strip).not.toContain("shell.strip.newChat");
  });
});
